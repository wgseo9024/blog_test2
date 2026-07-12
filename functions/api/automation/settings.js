import {
  ALLOWED_INTERVALS, ALLOWED_MODES, ensureSettings, failure, findCurrentApprovedDraft, isTime, json, nextRunAt,
} from "../../lib/automation.js";

export async function onRequestGet({ env }) {
  try {
    return json({ success: true, data: { settings: await ensureSettings(env) } });
  } catch (error) {
    console.error("Automation settings read error", error);
    return failure("자동화 설정을 불러오지 못했습니다.");
  }
}

export async function onRequestPut({ request, env }) {
  let input;
  try { input = await request.json(); } catch { return failure("올바른 JSON 요청이 아닙니다.", 400); }
  const enabled = input?.enabled;
  const mode = input?.mode;
  const interval = Number(input?.interval_minutes);
  const dailyLimit = Number(input?.daily_limit);
  const startTime = input?.start_time;
  const endTime = input?.end_time;
  const approvedDraftId = input?.approved_draft_id === null || input?.approved_draft_id === undefined ? null : Number(input.approved_draft_id);
  if (typeof enabled !== "boolean") return failure("enabled는 true 또는 false여야 합니다.", 400);
  if (!ALLOWED_MODES.has(mode)) return failure("올바른 자동화 방식을 선택해 주세요.", 400);
  if (!ALLOWED_INTERVALS.has(interval)) return failure("허용된 실행 간격을 선택해 주세요.", 400);
  if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 30) {
    return failure("하루 최대 처리량은 1개 이상 30개 이하여야 합니다.", 400);
  }
  if (!isTime(startTime) || !isTime(endTime)) return failure("시작·종료 시간을 올바르게 입력해 주세요.", 400);

  try {
    const current = await ensureSettings(env);
    const selectedApprovalId = enabled ? (approvedDraftId || Number(current.approved_draft_id)) : (approvedDraftId || current.approved_draft_id || null);
    if (enabled && !await findCurrentApprovedDraft(env, selectedApprovalId)) return failure("현재 버전이 승인된 초안을 선택해야 자동화를 시작할 수 있습니다.", 409);
    const calculatedNextRun = nextRunAt({
      ...current, enabled, mode, interval_minutes: interval, daily_limit: dailyLimit,
      start_time: startTime, end_time: endTime,
    });
    await env.DB.prepare(`UPDATE automation_settings SET enabled = ?, mode = ?, interval_minutes = ?,
      daily_limit = ?, start_time = ?, end_time = ?, timezone = 'Asia/Seoul', next_run_at = ?,
      approved_draft_id=?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(
        enabled ? 1 : 0, mode, interval, dailyLimit, startTime, endTime, calculatedNextRun, selectedApprovalId, 1,
      ).run();
    return json({ success: true, data: { settings: await ensureSettings(env) } });
  } catch (error) {
    console.error("Automation settings update error", error);
    return failure("자동화 설정을 저장하지 못했습니다.");
  }
}

export function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  if (context.request.method === "PUT") return onRequestPut(context);
  return failure("허용되지 않은 요청 방식입니다.", 405, { Allow: "GET, PUT" });
}
