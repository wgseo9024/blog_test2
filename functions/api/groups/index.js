const json = (data, status = 200, headers = {}) => Response.json(data, {
  status,
  headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers },
});

const failure = (message, status, headers) =>
  json({ success: false, error: { message } }, status, headers);

export async function onRequestGet({ env }) {
  try {
    const { results } = await env.DB.prepare(`SELECT g.id, g.representative_title,
      COUNT(DISTINCT i.article_id) AS article_count,
      GROUP_CONCAT(DISTINCT COALESCE(a.source, '출처 없음')) AS sources,
      MAX(COALESCE(a.published_at,a.created_at)) AS latest_published_at,
      COUNT(DISTINCT ai.id) AS image_count,
      g.created_at
      FROM article_groups g
      JOIN article_group_items i ON i.group_id = g.id
      JOIN articles a ON a.id = i.article_id
      LEFT JOIN article_images ai ON ai.article_id=a.id
      GROUP BY g.id, g.representative_title, g.created_at
      HAVING COUNT(DISTINCT i.article_id) >= 1
      ORDER BY g.created_at DESC, g.id DESC
      LIMIT 100`).all();
    const groups = (results || []).map((group) => ({
      ...group,
      article_count: Number(group.article_count),
      image_count: Number(group.image_count||0),
      sources: String(group.sources || "").split(",").filter(Boolean),
    }));
    return json({ success: true, data: { groups, count: groups.length } });
  } catch (error) {
    console.error("Group list error", error);
    return failure("이슈 그룹 목록을 불러오지 못했습니다.", 500);
  }
}

export function onRequest(context) {
  if (context.request.method !== "GET") {
    return failure("GET 요청만 허용됩니다.", 405, { Allow: "GET" });
  }
  return onRequestGet(context);
}
