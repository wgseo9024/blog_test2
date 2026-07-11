const json = (data, status = 200, headers = {}) => Response.json(data, {
  status,
  headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers },
});

const failure = (message, status, headers) =>
  json({ success: false, error: { message } }, status, headers);

const validId = (value) => {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

export async function onRequestGet({ env, params }) {
  const id = validId(params.id);
  if (!id) return failure("올바른 그룹 id가 아닙니다.", 400);

  try {
    const group = await env.DB.prepare(
      "SELECT id, representative_title, created_at FROM article_groups WHERE id = ? LIMIT 1",
    ).bind(id).first();
    if (!group) return failure("이슈 그룹을 찾을 수 없습니다.", 404);

    const { results } = await env.DB.prepare(`SELECT a.id, a.title, a.source, a.url,
      a.summary, a.published_at, i.similarity_score
      FROM article_group_items i
      JOIN articles a ON a.id = i.article_id
      WHERE i.group_id = ?
      ORDER BY COALESCE(a.published_at, a.created_at) DESC, a.id DESC`).bind(id).all();

    return json({ success: true, data: { group: { ...group, articles: results || [] } } });
  } catch (error) {
    console.error("Group detail error", error);
    return failure("이슈 그룹을 불러오지 못했습니다.", 500);
  }
}

export function onRequest(context) {
  if (context.request.method !== "GET") {
    return failure("GET 요청만 허용됩니다.", 405, { Allow: "GET" });
  }
  return onRequestGet(context);
}
