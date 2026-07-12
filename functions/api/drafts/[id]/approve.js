import { validateWriterOutput } from "../../../lib/draft-validation.js";

const reply = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const fail = (message, status = 400) => reply({ success: false, error: { message } }, status);
const parse = (value) => { try { return JSON.parse(value || "[]"); } catch { return []; } };

export async function onRequestPost({ env, params }) {
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id < 1) return fail("올바른 초안 id가 아닙니다.");
  const draft = await env.DB.prepare("SELECT * FROM drafts WHERE id=?").bind(id).first();
  if (!draft) return fail("초안을 찾을 수 없습니다.", 404);
  const validation = validateWriterOutput({ bodyBlocks: parse(draft.body_blocks_json), tags: parse(draft.tags_json || draft.tags) });
  if (!validation.valid) return fail("글쓰기 검증을 통과한 초안만 승인할 수 있습니다.", 422);
  const selected = [draft.selected_cover_image_id, ...parse(draft.selected_content_image_ids_json)].filter(Boolean).map(Number);
  if (selected.length) {
    const placeholders = selected.map(() => "?").join(",");
    const row = await env.DB.prepare(`SELECT COUNT(DISTINCT ai.id) count FROM article_images ai
      JOIN article_group_items gi ON gi.article_id=ai.article_id
      WHERE gi.group_id=? AND ai.id IN (${placeholders})`).bind(draft.article_group_id, ...selected).first();
    if (Number(row?.count || 0) !== new Set(selected).size) return fail("선택 이미지가 초안의 기사 그룹에 속하지 않습니다.", 422);
  }
  const saved = await env.DB.prepare(`UPDATE drafts SET approval_status='approved', approved_at=CURRENT_TIMESTAMP,
    approved_draft_version=draft_version, status='queued', updated_at=CURRENT_TIMESTAMP WHERE id=? RETURNING *`).bind(id).first();
  return reply({ success: true, data: { draft: { ...saved, draftStatus: saved.approval_status, approvedAt: saved.approved_at,
    approvedDraftVersion: saved.approved_draft_version, updatedAt: saved.updated_at,
    selectedCoverImage: saved.selected_cover_image_id, selectedContentImages: parse(saved.selected_content_image_ids_json) } } });
}

export function onRequest(context) {
  return context.request.method === "POST" ? onRequestPost(context) : fail("POST 요청만 허용됩니다.", 405);
}

