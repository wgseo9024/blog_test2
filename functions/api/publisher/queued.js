import { publisherAuthorized } from "../../lib/auth.js";
const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function onRequestGet({ request, env }) {
  if (!env.PUBLISHER_TOKEN) return json({ success: false, error: { message: "발행 프로그램 인증이 설정되지 않았습니다." } }, 503);
  if (!publisherAuthorized(request, env)) return json({ success: false, error: { message: "발행 대기열 조회 권한이 없습니다." } }, 401);
  const { results } = await env.DB.prepare(`SELECT id, article_group_id, title, content, tags, status, image_mode,
    body_blocks_json,tags_json,rendered_content,validation_status,validation_issues_json,
    created_at, updated_at FROM drafts WHERE status = 'queued'
    AND (lease_expires_at IS NULL OR lease_expires_at <= ?) ORDER BY created_at, id LIMIT 30`)
    .bind(new Date().toISOString()).all();
  return json({ success: true, data: { drafts: (results || []).map((draft) => ({ ...draft,
    tags: (() => { try { return JSON.parse(draft.tags); } catch { return []; } })(),
    bodyBlocks: (() => { try { return JSON.parse(draft.body_blocks_json||"[]"); } catch { return []; } })(),
    validationIssues: (() => { try { return JSON.parse(draft.validation_issues_json||"[]"); } catch { return []; } })() })) } });
}
export function onRequest(context) {
  if (context.request.method !== "GET") return json({ success: false, error: { message: "GET 요청만 허용됩니다." } }, 405);
  return onRequestGet(context);
}
