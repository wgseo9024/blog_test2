import { renderDraft, validateWriterOutput } from "../../lib/draft-validation.js";

const json = (data, status = 200, headers = {}) => Response.json(data, {
  status,
  headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers },
});
const failure = (message, status, headers) => json({ success: false, error: { message } }, status, headers);
const validId = (value) => {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};
const clean = (value, maxLength) => typeof value === "string" ? value.trim().slice(0, maxLength) : "";
const ALLOWED_STATUSES = new Set(["draft", "review", "queued", "published", "failed"]);
const ALLOWED_IMAGE_MODES = new Set(["none", "candidate", "generate"]);
const parseDraft = (draft) => {
  try { return { ...draft, tags: JSON.parse(draft.tags_json || draft.tags || "[]"), bodyBlocks: JSON.parse(draft.body_blocks_json || "[]"), validationIssues: JSON.parse(draft.validation_issues_json || "[]"), draftStatus:draft.approval_status,approvedAt:draft.approved_at,approvedDraftVersion:draft.approved_draft_version,updatedAt:draft.updated_at,selectedCoverImage:draft.selected_cover_image_id,selectedContentImages:JSON.parse(draft.selected_content_image_ids_json||"[]") }; }
  catch { return { ...draft, tags: [] }; }
};

const findDraft = (env, id) => env.DB.prepare(`SELECT * FROM drafts WHERE id = ? LIMIT 1`).bind(id).first();

export async function onRequestGet({ env, params }) {
  const id = validId(params.id);
  if (!id) return failure("올바른 초안 id가 아닙니다.", 400);
  try {
    const draft = await findDraft(env, id);
    return draft ? json({ success: true, data: { draft: parseDraft(draft) } }) : failure("초안을 찾을 수 없습니다.", 404);
  } catch (error) {
    console.error("Draft detail error", error);
    return failure("초안을 불러오지 못했습니다.", 500);
  }
}

export async function onRequestPut({ request, env, params }) {
  const id = validId(params.id);
  if (!id) return failure("올바른 초안 id가 아닙니다.", 400);
  let input;
  try { input = await request.json(); } catch { return failure("올바른 JSON 요청이 아닙니다.", 400); }

  const hasTitle = Object.prototype.hasOwnProperty.call(input || {}, "title");
  const hasContent = Object.prototype.hasOwnProperty.call(input || {}, "content");
  const hasStatus = Object.prototype.hasOwnProperty.call(input || {}, "status");
  const hasTags = Object.prototype.hasOwnProperty.call(input || {}, "tags");
  const hasImageMode = Object.prototype.hasOwnProperty.call(input || {}, "image_mode");
  const hasBlocks = Object.prototype.hasOwnProperty.call(input || {}, "bodyBlocks");
  const hasCover = Object.prototype.hasOwnProperty.call(input || {}, "selectedCoverImage");
  const hasContentImages = Object.prototype.hasOwnProperty.call(input || {}, "selectedContentImages");
  if (![hasTitle, hasContent, hasStatus, hasTags, hasImageMode,hasBlocks,hasCover,hasContentImages].some(Boolean)) {
    return failure("수정할 제목, 본문, 태그 또는 상태를 입력해 주세요.", 400);
  }
  const title = hasTitle ? clean(input.title, 500) : null;
  const content = hasContent ? clean(input.content, 20000) : null;
  const status = hasStatus ? clean(input.status, 50) : null;
  const imageMode = hasImageMode ? clean(input.image_mode, 20) : null;
  const tags = hasTags && Array.isArray(input.tags)
    ? input.tags.map((tag) => clean(tag, 100).replace(/^#+/, "")).filter(Boolean)
    : null;
  const blocks = hasBlocks && Array.isArray(input.bodyBlocks) ? input.bodyBlocks.map((v)=>clean(v,5000)) : null;
  const cover = hasCover && input.selectedCoverImage !== null ? Number(input.selectedCoverImage) : null;
  const contentImages = hasContentImages && Array.isArray(input.selectedContentImages) ? [...new Set(input.selectedContentImages.map(Number))] : null;
  if ((hasTitle && !title) || (hasContent && !content) || (hasStatus && !status) || (hasTags && !tags)) {
    return failure("제목과 본문은 비워 둘 수 없고, 태그는 배열이어야 합니다.", 400);
  }
  if (tags && tags.length > 30) return failure("태그는 최대 30개까지 저장할 수 있습니다.", 400);
  if (status && !ALLOWED_STATUSES.has(status)) return failure("올바른 상태 값이 아닙니다.", 400);
  if (imageMode && !ALLOWED_IMAGE_MODES.has(imageMode)) return failure("올바른 이미지 방식이 아닙니다.", 400);
  if ((hasCover && cover !== null && (!Number.isSafeInteger(cover)||cover<1)) || (hasContentImages && (!contentImages || contentImages.length>3 || contentImages.some((value)=>!Number.isSafeInteger(value)||value<1)))) return failure("대표 이미지는 1장, 본문 이미지는 최대 3장까지 선택할 수 있습니다.",400);

  try {
    const existing = await findDraft(env, id);
    if (!existing) return failure("초안을 찾을 수 없습니다.", 404);
    const nextTitle = hasTitle ? title : existing.title;
    const nextTags = hasTags ? tags : parseDraft(existing).tags;
    const nextBlocks = hasBlocks ? blocks : parseDraft(existing).bodyBlocks;
    if ((hasBlocks || hasTags) && !validateWriterOutput({bodyBlocks:nextBlocks,tags:nextTags}).valid) return failure("bodyBlocks 6개·각 문장 90자 이상·본문 700~800자·중복 없는 태그 10개·# 금지 조건을 확인해 주세요.",422);
    const nextContent = (hasBlocks || hasTags) ? renderDraft(nextBlocks,nextTags) : (hasContent ? content : existing.content);
    const nextStatus = hasStatus ? status : existing.status;
    const nextImageMode = hasImageMode ? imageMode : (existing.image_mode || "none");
    const nextCover = hasCover ? cover : existing.selected_cover_image_id;
    const nextContentImages = hasContentImages ? contentImages : JSON.parse(existing.selected_content_image_ids_json||"[]");
    const selected = [nextCover,...nextContentImages].filter(Boolean);
    if(selected.length){const placeholders=selected.map(()=>"?").join(",");const row=await env.DB.prepare(`SELECT COUNT(DISTINCT ai.id) count FROM article_images ai JOIN article_group_items gi ON gi.article_id=ai.article_id WHERE gi.group_id=? AND ai.id IN (${placeholders})`).bind(existing.article_group_id,...selected).first();if(Number(row?.count||0)!==new Set(selected).size)return failure("선택 이미지가 초안의 기사 그룹에 속하지 않습니다.",422);}
    const contentChanged=hasTitle||hasContent||hasTags||hasBlocks||hasCover||hasContentImages;
    if(contentChanged&&await env.DB.prepare("SELECT id FROM publish_jobs WHERE draft_id=? AND status='processing' LIMIT 1").bind(id).first())return failure("로컬 Publisher가 처리 중인 초안은 수정할 수 없습니다.",409);
    const draft = await env.DB.prepare(`UPDATE drafts SET title = ?, content = ?, tags = ?, tags_json=?, body_blocks_json=?, rendered_content=?, status = ?, image_mode = ?,
      selected_cover_image_id=?,selected_content_image_ids_json=?,draft_version=draft_version+?,approval_status=CASE WHEN ?=1 THEN 'draft' ELSE approval_status END,approved_at=CASE WHEN ?=1 THEN NULL ELSE approved_at END,approved_draft_version=CASE WHEN ?=1 THEN NULL ELSE approved_draft_version END,
      updated_at = CURRENT_TIMESTAMP WHERE id = ? RETURNING *`).bind(
        nextTitle, nextContent, JSON.stringify(nextTags),JSON.stringify(nextTags),JSON.stringify(nextBlocks),nextContent, nextStatus, nextImageMode,nextCover,JSON.stringify(nextContentImages),contentChanged?1:0,contentChanged?1:0,contentChanged?1:0,contentChanged?1:0,id,
      ).first();
    if (contentChanged) await env.DB.batch([
      env.DB.prepare("UPDATE automation_settings SET enabled=0,next_run_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE approved_draft_id=?").bind(id),
      env.DB.prepare("UPDATE publish_jobs SET status='failed',error_message='새 초안 버전으로 대체됨',updated_at=CURRENT_TIMESTAMP WHERE draft_id=? AND status='queued'").bind(id),
    ]);
    return json({ success: true, data: { draft: parseDraft(draft) } });
  } catch (error) {
    console.error("Draft update error", error);
    return failure("초안을 수정하지 못했습니다.", 500);
  }
}

export async function onRequestDelete({ env, params }) {
  const id = validId(params.id);
  if (!id) return failure("올바른 초안 id가 아닙니다.", 400);
  try {
    const existing = await findDraft(env, id);
    if (!existing) return failure("초안을 찾을 수 없습니다.", 404);
    await env.DB.prepare("DELETE FROM drafts WHERE id = ?").bind(id).run();
    return json({ success: true, data: { id, deleted: true } });
  } catch (error) {
    console.error("Draft delete error", error);
    return failure("초안을 삭제하지 못했습니다.", 500);
  }
}

export function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  if (context.request.method === "PUT") return onRequestPut(context);
  if (context.request.method === "DELETE") return onRequestDelete(context);
  return failure("허용되지 않은 요청 방식입니다.", 405, { Allow: "GET, PUT, DELETE" });
}
