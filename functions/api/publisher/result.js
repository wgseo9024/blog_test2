import { publisherAuthorized } from "../../lib/auth.js";
const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function onRequestPost({ request, env }) {
  if (!publisherAuthorized(request, env)) return json({ success: false, error: { message: "발행 결과 기록 권한이 없습니다." } }, env.PUBLISHER_TOKEN ? 401 : 503);
  let body; try { body = await request.json(); } catch { return json({ success: false, error: { message: "올바른 JSON 요청이 아닙니다." } }, 400); }
  const draftId = Number(body?.draft_id); const lease = String(body?.lease_token || ""); const outcome = body?.result;
  if (!Number.isSafeInteger(draftId) || !lease || !["saved","completed","published","login_required","failed","retry"].includes(outcome)) {
    return json({ success: false, error: { message: "초안 id, lease, 결과 값을 확인해 주세요." } }, 400);
  }
  const finalStatus = outcome === "published" || outcome === "completed" ? "completed" : outcome;
  const jobStatus = outcome === "retry" ? "queued" : finalStatus;
  const message = String(body?.message || "").slice(0, 1000);
  const resultUrl = String(body?.result_url || "").slice(0, 2000) || null;
  const changed = await env.DB.prepare(`UPDATE publish_jobs SET status=?,claim_token=NULL,lease_expires_at=NULL,
    naver_draft_url=COALESCE(?,naver_draft_url),completed_at=CASE WHEN ? IN ('saved','completed') THEN CURRENT_TIMESTAMP ELSE completed_at END,
    error_message=CASE WHEN ? IN ('failed','login_required') THEN ? ELSE NULL END,updated_at=CURRENT_TIMESTAMP
    WHERE draft_id=? AND claim_token=? AND status='processing'`)
    .bind(jobStatus, resultUrl, jobStatus, jobStatus, message || null, draftId, lease).run();
  if (!changed.meta?.changes) return json({ success: false, error: { message: "유효한 processing 작업을 찾을 수 없습니다." } }, 409);
  await env.DB.batch([
    env.DB.prepare(`UPDATE drafts SET status=?,lease_token=NULL,lease_expires_at=NULL,result_url=COALESCE(?,result_url),
      published_at=CASE WHEN ?='completed' THEN CURRENT_TIMESTAMP ELSE published_at END,
      publish_error=CASE WHEN ? IN ('failed','login_required') THEN ? ELSE NULL END,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(jobStatus, resultUrl, jobStatus, jobStatus, message || null, draftId),
    env.DB.prepare("INSERT INTO publish_logs (draft_id,action,message) VALUES (?,?,?)").bind(draftId, jobStatus, message || null),
  ]);
  return json({ success: true, data: { draft_id: draftId, status: jobStatus, naver_draft_url: resultUrl } });
}
export function onRequest(context) { return context.request.method === "POST" ? onRequestPost(context) : json({ success: false, error: { message: "POST 요청만 허용됩니다." } }, 405); }
