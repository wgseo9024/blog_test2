import { ensureSettings, failure, json, seoulDayBounds } from "../../lib/automation.js";

export async function onRequestGet({ env }) {
  try {
    const settings = await ensureSettings(env);
    const { start, end } = seoulDayBounds();
    const [articles, drafts, publishing, groups, failed, queued, approvalWaiting, lastRun] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS count FROM articles WHERE created_at >= datetime(?) AND created_at < datetime(?)")
        .bind(start, end).first(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM drafts WHERE created_at >= datetime(?) AND created_at < datetime(?)")
        .bind(start, end).first(),
      env.DB.prepare(`SELECT COUNT(*) AS count FROM publish_logs
        WHERE created_at >= datetime(?) AND created_at < datetime(?) AND action IN ('queued', 'published')`)
        .bind(start, end).first(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM article_groups WHERE created_at >= datetime(?) AND created_at < datetime(?)").bind(start, end).first(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM drafts WHERE status = 'failed'").first(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM drafts WHERE status = 'queued'").first(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM drafts WHERE approval_status!='approved'").first(),
      env.DB.prepare("SELECT status,finished_at,error_message,collected_count,groups_created,drafts_created FROM automation_run_logs ORDER BY started_at DESC,id DESC LIMIT 1").first(),
    ]);
    return json({ success: true, data: {
      articles_today: Number(articles?.count || 0),
      drafts_today: Number(drafts?.count || 0),
      queued_or_published_today: Number(publishing?.count || 0),
      groups_today: Number(groups?.count || 0),
      failed_count: Number(failed?.count || 0),
      queued_count: Number(queued?.count || 0),
      approval_waiting_count: Number(approvalWaiting?.count || 0),
      automation_processed_today: Number(publishing?.count || 0),
      next_run_at: settings.next_run_at,
      last_run: lastRun || null,
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
