import { publisherAuthorized } from "../../lib/auth.js";
const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function onRequestPost({ request, env }) {
  if (!env.PUBLISHER_TOKEN) return json({ success: false, error: { message: "발행 프로그램 인증이 설정되지 않았습니다." } }, 503);
  if (!publisherAuthorized(request, env)) return json({ success: false, error: { message: "발행 대기열 처리 권한이 없습니다." } }, 401);
  let body; try { body = await request.json(); } catch { return json({ success: false, error: { message: "올바른 JSON 요청이 아닙니다." } }, 400); }
  const draftId = Number(body?.draft_id);
  if (!Number.isSafeInteger(draftId) || draftId < 1) return json({ success: false, error: { message: "올바른 초안 id가 아닙니다." } }, 400);
  const token = crypto.randomUUID(); const now = new Date(); const expires = new Date(now.getTime() + 15 * 60000).toISOString();
  const draft = await env.DB.prepare(`UPDATE drafts SET lease_token = ?, lease_expires_at = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'queued' AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
    RETURNING id, title, content, tags, status, image_mode`).bind(token, expires, draftId, now.toISOString()).first();
  if (!draft) return json({ success: false, error: { message: "이미 다른 발행 프로그램이 처리 중이거나 대기 상태가 아닙니다." } }, 409);
  await env.DB.prepare("INSERT INTO draft_publish_events (draft_id, result, message) VALUES (?, 'leased', ?)")
    .bind(draftId, `lease expires ${expires}`).run();
  try { draft.tags = JSON.parse(draft.tags); } catch { draft.tags = []; }
  return json({ success: true, data: { draft, lease_token: token, lease_expires_at: expires } });
}
export function onRequest(context) {
  if (context.request.method !== "POST") return json({ success: false, error: { message: "POST 요청만 허용됩니다." } }, 405);
  return onRequestPost(context);
}
