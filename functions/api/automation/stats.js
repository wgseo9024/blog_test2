import { ensureSettings, failure, json, seoulDayBounds } from "../../lib/automation.js";

export async function onRequestGet({ env }) {
  try {
    const settings = await ensureSettings(env);
    const { start, end } = seoulDayBounds();
    const [articles, drafts, publishing] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS count FROM articles WHERE created_at >= datetime(?) AND created_at < datetime(?)")
        .bind(start, end).first(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM drafts WHERE created_at >= datetime(?) AND created_at < datetime(?)")
        .bind(start, end).first(),
      env.DB.prepare(`SELECT COUNT(*) AS count FROM publish_logs
        WHERE created_at >= datetime(?) AND created_at < datetime(?) AND action IN ('queued', 'published')`)
        .bind(start, end).first(),
    ]);
    return json({ success: true, data: {
      articles_today: Number(articles?.count || 0),
      drafts_today: Number(drafts?.count || 0),
      queued_or_published_today: Number(publishing?.count || 0),
      next_run_at: settings.next_run_at,
    } });
  } catch (error) {
    console.error("Automation stats error", error);
    return failure("자동화 통계를 불러오지 못했습니다.");
  }
}

export function onRequest(context) {
  if (context.request.method !== "GET") return failure("GET 요청만 허용됩니다.", 405, { Allow: "GET" });
  return onRequestGet(context);
}
