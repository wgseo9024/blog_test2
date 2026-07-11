const json = (data, status = 200, headers = {}) =>
  Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });

const success = (data) => json({ success: true, data });
const failure = (message, status, headers) =>
  json({ success: false, error: { message } }, status, headers);

const getId = (value) => {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

export async function onRequestGet({ env, params }) {
  const id = getId(params.id);
  if (!id) return failure("올바른 기사 id가 아닙니다.", 400);

  try {
    const article = await env.DB.prepare(`SELECT id, title, url, source, summary,
      content, published_at, image_url, status, created_at, updated_at
      FROM articles WHERE id = ? LIMIT 1`)
      .bind(id)
      .first();

    if (!article) return failure("기사를 찾을 수 없습니다.", 404);
    return success({ article });
  } catch (error) {
    console.error("Article detail error", error);
    return failure("기사를 불러오지 못했습니다.", 500);
  }
}

export async function onRequestDelete({ env, params }) {
  const id = getId(params.id);
  if (!id) return failure("올바른 기사 id가 아닙니다.", 400);

  try {
    const result = await env.DB.prepare("DELETE FROM articles WHERE id = ?")
      .bind(id)
      .run();

    if (!result.meta?.changes) return failure("기사를 찾을 수 없습니다.", 404);
    return success({ id, deleted: true });
  } catch (error) {
    console.error("Article delete error", error);
    return failure("기사를 삭제하지 못했습니다.", 500);
  }
}

export function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  if (context.request.method === "DELETE") return onRequestDelete(context);
  return failure("허용되지 않은 요청 방식입니다.", 405, { Allow: "GET, DELETE" });
}
