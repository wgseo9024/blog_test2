import { collectRssEntertainment } from "./news/collect.js";

const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function onRequestPost({ request, env }) {
  if (!env.AUTOMATION_TOKEN) return json({ success: false, error: { code: "AUTOMATION_TOKEN_MISSING", message: "수동 수집 인증이 설정되지 않았습니다." } }, 503);
  if (request.headers.get("Authorization") !== `Bearer ${env.AUTOMATION_TOKEN}`) {
    return json({ success: false, error: { code: "UNAUTHORIZED", message: "수동 수집 권한이 없습니다." } }, 401);
  }
  try {
    const data = await collectRssEntertainment(env, { generateDrafts: true });
    return json({ success: true, data });
  } catch (error) {
    return json({ success: false, error: { code: "COLLECTION_FAILED", message: String(error?.message || error) } }, 502);
  }
}
export function onRequest(context) { return context.request.method === "POST" ? onRequestPost(context) : json({ success: false, error: { message: "POST 요청만 허용됩니다." } }, 405); }
