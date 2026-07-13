import { publisherAuthorized } from "../../lib/auth.js";
const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function onRequestPost({ request, env }) {
  if (!env.PUBLISHER_TOKEN) return json({ success: false, error: { message: "발행 프로그램 인증이 설정되지 않았습니다." } }, 503);
  if (!publisherAuthorized(request, env)) return json({ success: false, error: { message: "발행 대기열 처리 권한이 없습니다." } }, 401);
  let body; try { body = await request.json(); } catch { return json({ success: false, error: { message: "올바른 JSON 요청이 아닙니다." } }, 400); }
  const draftId = Number(body?.draft_id); const jobId = Number(body?.job_id);
  if (!Number.isSafeInteger(draftId) || draftId < 1) return json({ success: false, error: { message: "올바른 초안 id가 아닙니다." } }, 400);
  const token = crypto.randomUUID(); const now = new Date(); const expires = new Date(now.getTime() + 15 * 60000).toISOString();
  const job = await env.DB.prepare(`UPDATE publish_jobs SET status='processing',claim_token=?,claimed_at=?,lease_expires_at=?,
    attempts=attempts+1,updated_at=CURRENT_TIMESTAMP WHERE draft_id=? AND status='queued' AND (? IS NULL OR id=?) RETURNING *`)
    .bind(token, now.toISOString(), expires, draftId, Number.isSafeInteger(jobId) ? jobId : null,
      Number.isSafeInteger(jobId) ? jobId : null).first();
  if (!job) return json({ success: false, error: { message: "이미 처리됐거나 queued 상태가 아닌 작업입니다." } }, 409);
  const draft = await env.DB.prepare(`UPDATE drafts SET status='processing',lease_token=?,lease_expires_at=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND approval_status='approved' AND approved_draft_version=draft_version RETURNING *`)
    .bind(token, expires, draftId).first();
  if (!draft) {
    await env.DB.prepare("UPDATE publish_jobs SET status='failed',error_message='승인 상태 불일치',claim_token=NULL WHERE id=?").bind(job.id).run();
    return json({ success: false, error: { message: "승인된 최신 초안이 아닙니다." } }, 409);
  }
  try { draft.tags = JSON.parse(draft.tags_json || draft.tags || "[]"); } catch { draft.tags = []; }
  try { draft.body_blocks = JSON.parse(draft.body_blocks_json || "[]"); } catch { draft.body_blocks = []; }
  const images = (await env.DB.prepare(`SELECT ai.id,ai.content_type,ai.size_bytes,ai.sort_order,ai.source
    FROM article_images ai JOIN article_group_items gi ON gi.article_id=ai.article_id
    WHERE gi.group_id=? AND ai.approved_for_use=1 AND ai.rights_status='approved' AND ai.processed_r2_key IS NOT NULL
    ORDER BY CASE WHEN ai.id=? THEN 0 ELSE 1 END,ai.sort_order,ai.id LIMIT 4`)
    .bind(draft.article_group_id, draft.selected_cover_image_id || 0).all()).results || [];
  draft.images = images.map((image) => ({ ...image, download_url: `/api/publisher/images/${image.id}` }));
  return json({ success: true, data: { job_id: job.id, draft, lease_token: token, lease_expires_at: expires } });
}
export function onRequest(context) { return context.request.method === "POST" ? onRequestPost(context) : json({ success: false, error: { message: "POST 요청만 허용됩니다." } }, 405); }
