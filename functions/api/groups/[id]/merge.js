const response = (body, status = 200) => Response.json(body, { status,
  headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
const validId = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;

export async function onRequestPost({ request, env, params }) {
  const targetId = validId(params.id);
  let body;
  try { body = await request.json(); } catch { return response({ success: false, error: { message: "올바른 JSON 요청이 아닙니다." } }, 400); }
  const sourceId = validId(body?.source_group_id);
  if (!targetId || !sourceId || targetId === sourceId) return response({ success: false, error: { message: "병합할 두 그룹을 확인해 주세요." } }, 400);
  const groups = await env.DB.prepare("SELECT COUNT(*) AS count FROM article_groups WHERE id IN (?, ?)").bind(targetId, sourceId).first();
  if (Number(groups?.count) !== 2) return response({ success: false, error: { message: "병합할 그룹을 찾을 수 없습니다." } }, 404);
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO article_group_items (group_id, article_id, similarity_score)
      SELECT ?, article_id, similarity_score FROM article_group_items WHERE group_id = ?`).bind(targetId, sourceId),
    env.DB.prepare("DELETE FROM article_group_items WHERE group_id = ?").bind(sourceId),
    env.DB.prepare("UPDATE drafts SET article_group_id = ? WHERE article_group_id = ?").bind(targetId, sourceId),
    env.DB.prepare("DELETE FROM article_groups WHERE id = ?").bind(sourceId),
  ]);
  return response({ success: true, data: { target_group_id: targetId, merged_group_id: sourceId } });
}

export function onRequest(context) {
  if (context.request.method !== "POST") return response({ success: false, error: { message: "POST 요청만 허용됩니다." } }, 405);
  return onRequestPost(context);
}
