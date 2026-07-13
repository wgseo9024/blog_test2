import { validateWriterOutput } from "../../../lib/draft-validation.js";

const reply = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const fail = (message, status = 400) => reply({ success: false, error: { message } }, status);
const parse = (value) => { try { return JSON.parse(value || "[]"); } catch { return []; } };

export async function onRequestPost({ env, params }) {
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id < 1) return fail("올바른 초안 id가 아닙니다.");
  const draft = await env.DB.prepare("SELECT * FROM drafts WHERE id=?").bind(id).first();
  if (!draft) return fail("초안을 찾을 수 없습니다.", 404);
  if (await env.DB.prepare("SELECT id FROM publish_jobs WHERE draft_id=? AND status='processing' LIMIT 1").bind(id).first()) {
    return fail("로컬 Publisher가 처리 중인 초안은 다시 승인할 수 없습니다.", 409);
  }
  const validation = validateWriterOutput({ bodyBlocks: parse(draft.body_blocks_json), tags: parse(draft.tags_json || draft.tags) });
  if (!validation.valid) return fail("글쓰기 검증을 통과한 초안만 승인할 수 있습니다.", 422);
  const nate = await env.DB.prepare(`SELECT a.id,a.thumbnail_status,a.thumbnail_approved
    FROM article_group_items gi JOIN articles a ON a.id=gi.article_id
    WHERE gi.group_id=? AND a.source_type='nate_entertainment_ranking' LIMIT 1`).bind(draft.article_group_id).first();
  if (nate && (nate.thumbnail_status !== "completed" || !Boolean(nate.thumbnail_approved))) {
    return fail("완료된 홈판 이미지를 먼저 승인해야 초안을 승인할 수 있습니다.", 422);
  }
  const selected = [draft.selected_cover_image_id, ...parse(draft.selected_content_image_ids_json)].filter(Boolean).map(Number);
  if (!selected.length || !draft.selected_cover_image_id) return fail("사용할 홈판 이미지를 먼저 선택하고 승인해 주세요.", 422);
  if (selected.length) {
    const placeholders = selected.map(() => "?").join(",");
    const row = await env.DB.prepare(`SELECT COUNT(DISTINCT ai.id) count,
      SUM(CASE WHEN ai.approved_for_use=1 AND ai.rights_status='approved' AND ai.processed_r2_key IS NOT NULL THEN 1 ELSE 0 END) approved_count FROM article_images ai
      JOIN article_group_items gi ON gi.article_id=ai.article_id
      WHERE gi.group_id=? AND ai.id IN (${placeholders})`).bind(draft.article_group_id, ...selected).first();
    if (Number(row?.count || 0) !== new Set(selected).size) return fail("선택 이미지가 초안의 기사 그룹에 속하지 않습니다.", 422);
    if (Number(row?.approved_count || 0) !== new Set(selected).size) return fail("선택한 이미지를 모두 승인하고 저장 처리를 완료해 주세요.", 422);
  }
  const saved = await env.DB.prepare(`UPDATE drafts SET approval_status='approved', approved_at=CURRENT_TIMESTAMP,
    approved_draft_version=draft_version, status='queued', updated_at=CURRENT_TIMESTAMP WHERE id=? RETURNING *`).bind(id).first();
  await env.DB.prepare("UPDATE publish_jobs SET status='failed',error_message='새 승인 버전으로 대체됨',updated_at=CURRENT_TIMESTAMP WHERE draft_id=? AND status='queued' AND idempotency_key<>?")
    .bind(id, `draft:${id}:version:${saved.draft_version}`).run();
  await env.DB.prepare(`INSERT INTO publish_jobs (draft_id,idempotency_key,status)
    VALUES (?,?,'queued') ON CONFLICT(idempotency_key) DO NOTHING`)
    .bind(id, `draft:${id}:version:${saved.draft_version}`).run();
  return reply({ success: true, data: { draft: { ...saved, draftStatus: saved.approval_status, approvedAt: saved.approved_at,
    approvedDraftVersion: saved.approved_draft_version, updatedAt: saved.updated_at,
    selectedCoverImage: saved.selected_cover_image_id, selectedContentImages: parse(saved.selected_content_image_ids_json) } } });
}

export function onRequest(context) {
  return context.request.method === "POST" ? onRequestPost(context) : fail("POST 요청만 허용됩니다.", 405);
}
