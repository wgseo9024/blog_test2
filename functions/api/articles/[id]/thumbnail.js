const fail = (message, status = 400) => Response.json({ success: false, error: { message } }, { status });
export async function onRequestGet({ env, params }) {
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id < 1) return fail("올바른 기사 id가 아닙니다.");
  const article = await env.DB.prepare("SELECT thumbnail_r2_key FROM articles WHERE id=?").bind(id).first();
  if (!article?.thumbnail_r2_key) return fail("생성된 홈판 이미지를 찾을 수 없습니다.", 404);
  const object = await env.IMAGES_BUCKET.get(article.thumbnail_r2_key);
  if (!object) return fail("R2 홈판 이미지를 찾을 수 없습니다.", 404);
  return new Response(object.body, { headers: { "Content-Type": object.httpMetadata?.contentType || "image/jpeg",
    "Content-Length": String(object.size), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
export function onRequest(context) {
  return context.request.method === "GET" ? onRequestGet(context) : fail("GET 요청만 허용됩니다.", 405);
}
