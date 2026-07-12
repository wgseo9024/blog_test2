import { publisherAuthorized } from "../../lib/auth.js";
const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function onRequestPost({ request, env }) {
  if (!publisherAuthorized(request, env)) return json({ success: false, error: { message: "발행 결과 기록 권한이 없습니다." } }, env.PUBLISHER_TOKEN ? 401 : 503);
  let body; try { body = await request.json(); } catch { return json({ success: false, error: { message: "올바른 JSON 요청이 아닙니다." } }, 400); }
  const draftId = Number(body?.draft_id); const lease = String(body?.lease_token || "");
  const outcome = body?.result; const message = String(body?.message || "").slice(0, 1000);
  if (!Number.isSafeInteger(draftId) || !lease || !["published", "failed", "released", "login_required", "retry", "image_pending"].includes(outcome)) {
    return json({ success: false, error: { message: "초안 id, lease, 결과 값을 확인해 주세요." } }, 400);
  }
  const status = ["released", "login_required", "retry"].includes(outcome) ? "queued" : outcome;
  const changed = await env.DB.prepare(`UPDATE drafts SET status = ?, lease_token = NULL, lease_expires_at = NULL,
    published_at = CASE WHEN ? = 'published' THEN CURRENT_TIMESTAMP ELSE published_at END,
    publish_error = CASE WHEN ? IN ('failed','login_required','retry','image_pending') THEN ? ELSE NULL END,
    result_url = COALESCE(?, result_url), updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND lease_token = ?`).bind(status, outcome, outcome, message || null, String(body?.result_url || "").slice(0,2000) || null, draftId, lease).run();
  if (!changed.meta?.changes) return json({ success: false, error: { message: "유효한 발행 lease를 찾을 수 없습니다." } }, 409);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO draft_publish_events (draft_id, result, message) VALUES (?, ?, ?)").bind(draftId, ["login_required", "retry", "image_pending"].includes(outcome) ? "released" : outcome, message || null),
    env.DB.prepare("INSERT INTO publish_logs (draft_id, action, message) VALUES (?, ?, ?)").bind(draftId, ["released","login_required","retry"].includes(outcome) ? "queued" : outcome, message || null),
  ]);
  return json({ success: true, data: { draft_id: draftId, status } });
}
export function onRequest(context) {
  if (context.request.method !== "POST") return json({ success: false, error: { message: "POST 요청만 허용됩니다." } }, 405);
  return onRequestPost(context);
}
