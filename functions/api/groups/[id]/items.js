const json = (data, status = 200, headers = {}) => Response.json(data, { status,
  headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers } });
const failure = (message, status = 400) => json({ success: false, error: { message } }, status);
const id = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;

export async function onRequestDelete({ request, env, params }) {
  const groupId = id(params.id);
  let body;
  try { body = await request.json(); } catch { return failure("올바른 JSON 요청이 아닙니다."); }
  const articleId = id(body?.article_id);
  if (!groupId || !articleId) return failure("그룹과 기사 id를 확인해 주세요.");
  const item = await env.DB.prepare("SELECT 1 FROM article_group_items WHERE group_id = ? AND article_id = ?")
    .bind(groupId, articleId).first();
  if (!item) return failure("그룹에서 기사를 찾을 수 없습니다.", 404);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM article_group_items WHERE group_id = ? AND article_id = ?").bind(groupId, articleId),
    env.DB.prepare("UPDATE articles SET status = 'new', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(articleId),
  ]);
  return json({ success: true, data: { group_id: groupId, article_id: articleId, detached: true } });
}

export async function onRequestPatch({ request, env, params }) {
  const fromGroupId = id(params.id);
  let body;
  try { body = await request.json(); } catch { return failure("올바른 JSON 요청이 아닙니다."); }
  const articleId = id(body?.article_id); const targetGroupId = id(body?.target_group_id);
  if (!fromGroupId || !articleId || !targetGroupId || fromGroupId === targetGroupId) {
    return failure("이동할 기사와 대상 그룹을 확인해 주세요.");
  }
  const target = await env.DB.prepare("SELECT id FROM article_groups WHERE id = ?").bind(targetGroupId).first();
  if (!target) return failure("대상 그룹을 찾을 수 없습니다.", 404);
  const changed = await env.DB.prepare(`UPDATE article_group_items SET group_id = ?
    WHERE group_id = ? AND article_id = ?`).bind(targetGroupId, fromGroupId, articleId).run();
  if (!changed.meta?.changes) return failure("이동할 기사를 찾을 수 없습니다.", 404);
  return json({ success: true, data: { article_id: articleId, from_group_id: fromGroupId, target_group_id: targetGroupId } });
}

export function onRequest(context) {
  if (context.request.method === "DELETE") return onRequestDelete(context);
  if (context.request.method === "PATCH") return onRequestPatch(context);
  return failure("PATCH 또는 DELETE 요청만 허용됩니다.", 405);
}
