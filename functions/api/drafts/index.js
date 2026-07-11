const json = (data, status = 200, headers = {}) => Response.json(data, {
  status,
  headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers },
});
const failure = (message, status, headers) => json({ success: false, error: { message } }, status, headers);

const parseDraft = (draft) => {
  try {
    return { ...draft, tags: JSON.parse(draft.tags || "[]") };
  } catch {
    return { ...draft, tags: [] };
  }
};

export async function onRequestGet({ env }) {
  try {
    const { results } = await env.DB.prepare(`SELECT id, article_group_id, title, content, tags,
      status, created_at, updated_at FROM drafts ORDER BY created_at DESC, id DESC LIMIT 100`).all();
    const drafts = (results || []).map(parseDraft);
    return json({ success: true, data: { drafts, count: drafts.length } });
  } catch (error) {
    console.error("Draft list error", error);
    return failure("초안 목록을 불러오지 못했습니다.", 500);
  }
}

export function onRequest(context) {
  if (context.request.method !== "GET") return failure("GET 요청만 허용됩니다.", 405, { Allow: "GET" });
  return onRequestGet(context);
}
