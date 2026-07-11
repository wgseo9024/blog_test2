const json = (data, status = 200, headers = {}) => Response.json(data, {
  status,
  headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers },
});
const failure = (message, status, headers) => json({ success: false, error: { message } }, status, headers);

const parseDraft = (draft) => {
  try {
    return { ...draft, tags: JSON.parse(draft.tags_json || draft.tags || "[]"),
      bodyBlocks: JSON.parse(draft.body_blocks_json || "[]"),
      validationIssues: JSON.parse(draft.validation_issues_json || "[]") };
  } catch {
    return { ...draft, tags: [] };
  }
};

export async function onRequestGet({ env, request }) {
  try {
    const status = new URL(request.url).searchParams.get("status");
    if (status && !new Set(["draft", "review", "queued", "published", "failed"]).has(status)) {
      return failure("올바른 상태 필터가 아닙니다.", 400);
    }
    const { results } = await env.DB.prepare(`SELECT id, article_group_id, title, content, tags,
      status, image_mode, publish_error, body_blocks_json,tags_json,rendered_content,
      source_article_ids_json,generation_model,generation_status,validation_status,validation_issues_json,
      created_at, updated_at FROM drafts
      ${status ? "WHERE status = ?" : ""} ORDER BY created_at DESC, id DESC LIMIT 100`)
      .bind(...(status ? [status] : [])).all();
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
