const json = (data, status = 200, headers = {}) =>
  Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });

const success = (data, status = 200) => json({ success: true, data }, status);
const failure = (message, status, headers) =>
  json({ success: false, error: { message } }, status, headers);

const cleanText = (value, maxLength) =>
  typeof value === "string" ? value.trim().slice(0, maxLength) : "";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const status = cleanText(url.searchParams.get("status"), 100);
  const source = cleanText(url.searchParams.get("source"), 300);
  const keyword = cleanText(url.searchParams.get("keyword"), 500);
  const conditions = [];
  const values = [];

  if (status) {
    conditions.push("status = ?");
    values.push(status);
  }
  if (source) {
    conditions.push("source = ?");
    values.push(source);
  }
  if (keyword) {
    conditions.push("(title LIKE ? OR summary LIKE ? OR content LIKE ?)");
    const pattern = `%${keyword}%`;
    values.push(pattern, pattern, pattern);
  }

  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  const sql = `SELECT id, title, url, source, summary, content, published_at,
    image_url, status, created_at, updated_at
    FROM articles${where}
    ORDER BY COALESCE(published_at, created_at) DESC, id DESC
    LIMIT 100`;

  try {
    const { results } = await env.DB.prepare(sql).bind(...values).all();
    return success({ articles: results || [], count: results?.length || 0 });
  } catch (error) {
    console.error("Article list error", error);
    return failure("기사 목록을 불러오지 못했습니다.", 500);
  }
}

export async function onRequestPost({ request, env }) {
  let input;
  try {
    input = await request.json();
  } catch {
    return failure("올바른 JSON 요청이 아닙니다.", 400);
  }

  const article = {
    title: cleanText(input?.title, 500),
    url: cleanText(input?.url, 3000),
    source: cleanText(input?.source, 300),
    summary: cleanText(input?.summary, 5000),
    content: cleanText(input?.content, 50000),
    published_at: cleanText(input?.published_at, 100),
    image_url: cleanText(input?.image_url, 3000),
  };

  if (!article.title || !article.url) {
    return failure("title과 url은 필수입니다.", 400);
  }

  try {
    const existing = await env.DB.prepare("SELECT id FROM articles WHERE url = ? LIMIT 1")
      .bind(article.url)
      .first();
    if (existing) return failure("이미 저장된 URL입니다.", 409);

    const result = await env.DB.prepare(`INSERT INTO articles
      (title, url, source, summary, content, published_at, image_url)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      RETURNING id, title, url, source, summary, content, published_at,
        image_url, status, created_at, updated_at`)
      .bind(
        article.title,
        article.url,
        article.source || null,
        article.summary || null,
        article.content || null,
        article.published_at || null,
        article.image_url || null,
      )
      .first();

    return success({ article: result }, 201);
  } catch (error) {
    console.error("Article create error", error);
    if (String(error?.message).toLowerCase().includes("unique")) {
      return failure("이미 저장된 URL입니다.", 409);
    }
    return failure("기사를 저장하지 못했습니다.", 500);
  }
}

export function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  if (context.request.method === "POST") return onRequestPost(context);
  return failure("허용되지 않은 요청 방식입니다.", 405, { Allow: "GET, POST" });
}
