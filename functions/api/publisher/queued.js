import { publisherAuthorized } from "../../lib/auth.js";
const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function onRequestGet({ request, env }) {
  if (!env.PUBLISHER_TOKEN) return json({ success: false, error: { message: "발행 프로그램 인증이 설정되지 않았습니다." } }, 503);
  if (!publisherAuthorized(request, env)) return json({ success: false, error: { message: "발행 대기열 조회 권한이 없습니다." } }, 401);
  const { results } = await env.DB.prepare(`SELECT j.id job_id,j.status job_status,d.id,d.article_group_id,d.title,d.content,d.tags,
    d.status,d.image_mode,d.selected_cover_image_id,d.body_blocks_json,d.tags_json,d.rendered_content,d.validation_status,
    d.validation_issues_json,d.created_at,d.updated_at
    FROM publish_jobs j JOIN drafts d ON d.id=j.draft_id
    WHERE j.status='queued' AND d.approval_status='approved' AND d.approved_draft_version=d.draft_version
    ORDER BY j.created_at,j.id LIMIT 30`).all();
  const drafts = results || [];
  await Promise.all(drafts.map(async (draft) => {
    const images = (await env.DB.prepare(`SELECT ai.id,ai.content_type,ai.size_bytes,ai.sort_order,ai.source
      FROM article_images ai JOIN article_group_items gi ON gi.article_id=ai.article_id
      WHERE gi.group_id=? AND ai.approved_for_use=1 AND ai.rights_status='approved' AND ai.processed_r2_key IS NOT NULL
      ORDER BY CASE WHEN ai.id=? THEN 0 ELSE 1 END,ai.sort_order,ai.id LIMIT 4`)
      .bind(draft.article_group_id, draft.selected_cover_image_id || 0).all()).results || [];
    draft.images = images.map((image) => ({ ...image, download_url: `/api/publisher/images/${image.id}` }));
    try { draft.tags = JSON.parse(draft.tags_json || draft.tags || "[]"); } catch { draft.tags = []; }
    try { draft.body_blocks = JSON.parse(draft.body_blocks_json || "[]"); } catch { draft.body_blocks = []; }
    try { draft.validationIssues = JSON.parse(draft.validation_issues_json || "[]"); } catch { draft.validationIssues = []; }
  }));
  return json({ success: true, data: { drafts } });
}
export function onRequest(context) { return context.request.method === "GET" ? onRequestGet(context) : json({ success: false, error: { message: "GET 요청만 허용됩니다." } }, 405); }
