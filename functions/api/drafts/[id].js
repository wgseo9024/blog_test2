const json = (data, status = 200, headers = {}) => Response.json(data, {
  status,
  headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers },
});
const failure = (message, status, headers) => json({ success: false, error: { message } }, status, headers);
const validId = (value) => {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};
const clean = (value, maxLength) => typeof value === "string" ? value.trim().slice(0, maxLength) : "";
const parseDraft = (draft) => {
  try { return { ...draft, tags: JSON.parse(draft.tags || "[]") }; }
  catch { return { ...draft, tags: [] }; }
};

const findDraft = (env, id) => env.DB.prepare(`SELECT id, article_group_id, title, content, tags,
  status, created_at, updated_at FROM drafts WHERE id = ? LIMIT 1`).bind(id).first();

export async function onRequestGet({ env, params }) {
  const id = validId(params.id);
  if (!id) return failure("올바른 초안 id가 아닙니다.", 400);
  try {
    const draft = await findDraft(env, id);
    return draft ? json({ success: true, data: { draft: parseDraft(draft) } }) : failure("초안을 찾을 수 없습니다.", 404);
  } catch (error) {
    console.error("Draft detail error", error);
    return failure("초안을 불러오지 못했습니다.", 500);
  }
}

export async function onRequestPut({ request, env, params }) {
  const id = validId(params.id);
  if (!id) return failure("올바른 초안 id가 아닙니다.", 400);
  let input;
  try { input = await request.json(); } catch { return failure("올바른 JSON 요청이 아닙니다.", 400); }

  const hasTitle = Object.prototype.hasOwnProperty.call(input || {}, "title");
  const hasContent = Object.prototype.hasOwnProperty.call(input || {}, "content");
  const hasStatus = Object.prototype.hasOwnProperty.call(input || {}, "status");
  const hasTags = Object.prototype.hasOwnProperty.call(input || {}, "tags");
  if (![hasTitle, hasContent, hasStatus, hasTags].some(Boolean)) {
    return failure("수정할 제목, 본문, 태그 또는 상태를 입력해 주세요.", 400);
  }
  const title = hasTitle ? clean(input.title, 500) : null;
  const content = hasContent ? clean(input.content, 20000) : null;
  const status = hasStatus ? clean(input.status, 50) : null;
  const tags = hasTags && Array.isArray(input.tags)
    ? input.tags.map((tag) => clean(tag, 100).replace(/^#+/, "")).filter(Boolean)
    : null;
  if ((hasTitle && !title) || (hasContent && !content) || (hasStatus && !status) || (hasTags && !tags)) {
    return failure("제목과 본문은 비워 둘 수 없고, 태그는 배열이어야 합니다.", 400);
  }
  if (tags && tags.length > 30) return failure("태그는 최대 30개까지 저장할 수 있습니다.", 400);
  if (status && !/^[a-zA-Z0-9_-]{1,50}$/.test(status)) return failure("올바른 상태 값이 아닙니다.", 400);

  try {
    const existing = await findDraft(env, id);
    if (!existing) return failure("초안을 찾을 수 없습니다.", 404);
    const nextTitle = hasTitle ? title : existing.title;
    const nextContent = hasContent ? content : existing.content;
    const nextTags = hasTags ? tags : parseDraft(existing).tags;
    const nextStatus = hasStatus ? status : existing.status;
    const draft = await env.DB.prepare(`UPDATE drafts SET title = ?, content = ?, tags = ?, status = ?,
      updated_at = CURRENT_TIMESTAMP WHERE id = ? RETURNING id, article_group_id, title, content,
      tags, status, created_at, updated_at`).bind(
        nextTitle, nextContent, JSON.stringify(nextTags), nextStatus, id,
      ).first();
    return json({ success: true, data: { draft: parseDraft(draft) } });
  } catch (error) {
    console.error("Draft update error", error);
    return failure("초안을 수정하지 못했습니다.", 500);
  }
}

export async function onRequestDelete({ env, params }) {
  const id = validId(params.id);
  if (!id) return failure("올바른 초안 id가 아닙니다.", 400);
  try {
    const existing = await findDraft(env, id);
    if (!existing) return failure("초안을 찾을 수 없습니다.", 404);
    await env.DB.prepare("DELETE FROM drafts WHERE id = ?").bind(id).run();
    return json({ success: true, data: { id, deleted: true } });
  } catch (error) {
    console.error("Draft delete error", error);
    return failure("초안을 삭제하지 못했습니다.", 500);
  }
}

export function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  if (context.request.method === "PUT") return onRequestPut(context);
  if (context.request.method === "DELETE") return onRequestDelete(context);
  return failure("허용되지 않은 요청 방식입니다.", 405, { Allow: "GET, PUT, DELETE" });
}
