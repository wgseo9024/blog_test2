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
      a.summary, a.image_url, a.published_at, a.source_type,a.nate_rank,a.previous_nate_rank,
      a.best_nate_rank,a.rank_change,a.ranking_date,a.thumbnail_status,a.thumbnail_approved,
      a.scrape_status,a.draft_status,a.generated_thumbnail_url,i.similarity_score
      FROM article_group_items i
      JOIN articles a ON a.id = i.article_id
      WHERE i.group_id = ?
      ORDER BY COALESCE(a.published_at, a.created_at) DESC, a.id DESC`).bind(id).all();

    const articles = results || [];
    if (articles.length) {
      const placeholders = articles.map(() => "?").join(",");
      const imageRows = await env.DB.prepare(`SELECT id,article_id,image_url,source,article_url,candidate_type,
        width,height,size_bytes,sha256,perceptual_hash,duplicate_of,exclude_reason,rights_status,
        rights_confirmed,approved_for_use,sort_order,crop_percent,crop_pixels,processing_status,
        processing_error,original_r2_key,processed_r2_key
        FROM article_images WHERE article_id IN (${placeholders}) ORDER BY id`).bind(...articles.map((article) => article.id)).all();
      const images = new Map();
      for (const candidate of imageRows.results || []) {
        if (!images.has(candidate.article_id)) images.set(candidate.article_id, []);
        images.get(candidate.article_id).push(candidate);
      }
      articles.forEach((article) => { article.image_candidates = images.get(article.id) || []; });
    }
    return json({ success: true, data: { group: { ...group, articles },
      image_usage_notice: "이미지 사용권은 확인되지 않았습니다. 원 출처의 이용 조건을 확인하세요." } });
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
