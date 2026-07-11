const result = (body, status = 200) => Response.json(body, { status,
  headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
export async function onRequestGet({ env, params }) {
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id < 1) return result({ success: false, error: { message: "올바른 기사 id가 아닙니다." } }, 400);
  const { results } = await env.DB.prepare(`SELECT id, image_url, source, article_url, candidate_type,
    content_type, width, height, size_bytes, sha256, perceptual_hash, duplicate_of, exclude_reason,
    rights_status, rights_confirmed, approved_for_use, sort_order, crop_percent, crop_pixels,
    processing_status, processing_error, original_r2_key, processed_r2_key, created_at
    FROM article_images WHERE article_id = ? ORDER BY id`).bind(id).all();
  return result({ success: true, data: { images: results || [], usage_notice: "이미지 사용권은 확인되지 않았습니다. 원 출처의 허가와 이용 조건을 직접 확인하세요." } });
}
export function onRequest(context) {
  if (context.request.method !== "GET") return result({ success: false, error: { message: "GET 요청만 허용됩니다." } }, 405);
  return onRequestGet(context);
}
