import { onRequestPost as collectNews } from "../news/collect.js";
import { onRequestPost as groupNews } from "../news/group.js";
import { generateGroupDraft } from "../groups/[id]/generate.js";
import { ensureSettings, failure, json, nextRunAt, seoulDayBounds } from "../../lib/automation.js";

const responseData = async (response) => {
  try { return await response.json(); } catch { return null; }
};

export async function onRequestPost({ env }) {
  const errors = [];
  let collected = 0;
  let groupsCreated = 0;
  let draftsCreated = 0;
  let settings;

  try { settings = await ensureSettings(env); } catch (error) {
    console.error("Automation run settings error", error);
    return failure("자동화 설정을 불러오지 못해 실행을 시작할 수 없습니다.");
  }

  try {
    const response = await collectNews({
      env,
      request: new Request("https://internal/api/news/collect", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      }),
    });
    const result = await responseData(response);
    if (response.ok && result?.success) collected = Number(result.data?.inserted || 0);
    else errors.push({ step: "collect", message: result?.error?.message || "뉴스 수집 실패" });
  } catch (error) {
    console.error("Automation collect step error", error);
    errors.push({ step: "collect", message: "뉴스 수집 단계에서 오류가 발생했습니다." });
  }

  try {
    const response = await groupNews({ env });
    const result = await responseData(response);
    if (response.ok && result?.success) groupsCreated = Number(result.data?.groupsCreated || 0);
    else errors.push({ step: "group", message: result?.error?.message || "기사 그룹화 실패" });
  } catch (error) {
    console.error("Automation group step error", error);
    errors.push({ step: "group", message: "기사 그룹화 단계에서 오류가 발생했습니다." });
  }

  const { start, end } = seoulDayBounds();
  let processedToday = 0;
  try {
    const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM publish_logs
      WHERE created_at >= datetime(?) AND created_at < datetime(?) AND action IN ('draft_created', 'queued', 'published')`)
      .bind(start, end).first();
    processedToday = Number(row?.count || 0);
    const allowed = Math.max(0, settings.daily_limit - processedToday);
    if (allowed > 0) {
      const { results } = await env.DB.prepare(`SELECT g.id FROM article_groups g
        WHERE NOT EXISTS (SELECT 1 FROM drafts d WHERE d.article_group_id = g.id)
        ORDER BY g.created_at DESC, g.id DESC LIMIT ?`).bind(allowed).all();
      const status = settings.mode === "publish" ? "queued" : settings.mode;
      for (const group of results || []) {
        try {
          const response = await generateGroupDraft(env, group.id, { status, preventDuplicate: true });
          const result = await responseData(response);
          if (!response.ok || !result?.success) {
            if (result?.error?.code !== "DRAFT_EXISTS") {
              errors.push({ step: "draft", group_id: group.id, message: result?.error?.message || "초안 생성 실패" });
              await env.DB.prepare(`INSERT INTO publish_logs (article_group_id, action, message)
                VALUES (?, 'failed', ?)`).bind(group.id, "초안 생성 실패").run();
            }
            continue;
          }
          const draft = result.data.draft;
          await env.DB.prepare(`INSERT INTO publish_logs (draft_id, article_group_id, action)
            VALUES (?, ?, ?)`).bind(draft.id, group.id, status === "queued" ? "queued" : "draft_created").run();
          draftsCreated += 1;
        } catch (error) {
          console.error("Automation draft step error", group.id, error);
          errors.push({ step: "draft", group_id: group.id, message: "초안 생성 중 오류가 발생했습니다." });
        }
      }
    }
  } catch (error) {
    console.error("Automation draft selection error", error);
    errors.push({ step: "draft", message: "처리할 그룹을 선택하지 못했습니다." });
  }

  const now = new Date();
  const remaining = Math.max(0, settings.daily_limit - processedToday - draftsCreated);
  try {
    const following = nextRunAt({ ...settings, last_run_at: now.toISOString() }, now);
    await env.DB.prepare(`UPDATE automation_settings SET last_run_at = ?, next_run_at = ?,
      updated_at = CURRENT_TIMESTAMP WHERE id = 1`).bind(now.toISOString(), following).run();
  } catch (error) {
    console.error("Automation run timestamp error", error);
    errors.push({ step: "schedule", message: "다음 실행 시간을 갱신하지 못했습니다." });
  }

  return json({ success: true, data: {
    collected, groups_created: groupsCreated, drafts_created: draftsCreated,
    remaining_daily_limit: remaining, errors,
  } });
}

export function onRequest(context) {
  if (context.request.method !== "POST") return failure("POST 요청만 허용됩니다.", 405, { Allow: "POST" });
  return onRequestPost(context);
}
