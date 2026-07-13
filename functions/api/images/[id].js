const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const fail = (message, status = 400) => json({ success: false, error: { message } }, status);
const imageId = (v) => Number.isSafeInteger(Number(v)) && Number(v) > 0 ? Number(v) : null;
const fields = `id,article_id,image_url,source,article_url,candidate_type,content_type,width,height,size_bytes,sha256,perceptual_hash,duplicate_of,exclude_reason,rights_status,rights_confirmed,approved_for_use,sort_order,crop_percent,crop_pixels,processing_status,processing_error,original_r2_key,processed_r2_key,created_at`;

export async function onRequestPut({ request, env, params }) {
  const id = imageId(params.id); if (!id) return fail("올바른 이미지 id가 아닙니다.");
  let body; try { body = await request.json(); } catch { return fail("올바른 JSON 요청이 아닙니다."); }
  const action = body?.action;
  const existing = await env.DB.prepare(`SELECT ai.*,a.source_type,a.generated_thumbnail_url FROM article_images ai
    JOIN articles a ON a.id=ai.article_id WHERE ai.id=?`).bind(id).first();
  if (!existing) return fail("이미지를 찾을 수 없습니다.", 404);
  const generatedThumbnail = existing.image_url === existing.generated_thumbnail_url;
  if (action === "approve" && body.rights_confirmed !== true && !generatedThumbnail) return fail("권한 확인 체크와 승인 동작이 모두 필요합니다.", 422);
  if (!new Set(["approve", "reject", "review_required"]).has(action)) return fail("지원하지 않는 이미지 동작입니다.");
  const status = action === "approve" ? "approved" : action === "reject" ? "rejected" : "review_required";
  const approved = action === "approve" ? 1 : 0;
  const row = await env.DB.prepare(`UPDATE article_images SET rights_status=?,rights_confirmed=?,approved_for_use=?,processing_status=CASE WHEN ?=1 AND processed_r2_key IS NULL THEN 'ready' ELSE processing_status END,exclude_reason=CASE WHEN ?='reject' THEN COALESCE(?, '관리자 거절') ELSE exclude_reason END WHERE id=? RETURNING ${fields}`).bind(status, body.rights_confirmed === true || generatedThumbnail ? 1 : 0, approved, approved, action, String(body.reason || "").slice(0,500) || null, id).first();
  if (generatedThumbnail) await env.DB.prepare("UPDATE articles SET thumbnail_approved=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(approved, existing.article_id).run();
  return row ? json({ success: true, data: { image: row } }) : fail("이미지를 찾을 수 없습니다.", 404);
}
export function onRequest(context) { return context.request.method === "PUT" ? onRequestPut(context) : fail("PUT 요청만 허용됩니다.", 405); }
