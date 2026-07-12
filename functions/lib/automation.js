export const DEFAULT_SETTINGS = Object.freeze({
  id: 1,
  enabled: false,
  mode: "draft",
  interval_minutes: 30,
  daily_limit: 3,
  start_time: "09:00",
  end_time: "22:00",
  timezone: "Asia/Seoul",
  last_run_at: null,
  next_run_at: null,
  approved_draft_id: null,
});

export const ALLOWED_INTERVALS = new Set([10, 30, 60, 120, 180, 360]);
export const ALLOWED_MODES = new Set(["draft", "review", "publish"]);
export const MAX_DAILY_LIMIT = 30;
export const LOCK_NAME = "automation-run";
export const LOCK_TTL_MS = 20 * 60 * 1000;

export const json = (data, status = 200, headers = {}) => Response.json(data, {
  status,
  headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers },
});

export const failure = (message, status = 500, headers) =>
  json({ success: false, error: { message } }, status, headers);

export const normalizeSettings = (row) => ({
  ...DEFAULT_SETTINGS,
  ...row,
  id: 1,
  enabled: Boolean(row?.enabled),
  interval_minutes: Number(row?.interval_minutes ?? DEFAULT_SETTINGS.interval_minutes),
  daily_limit: Number(row?.daily_limit ?? DEFAULT_SETTINGS.daily_limit),
});

export const ensureSettings = async (env) => {
  await env.DB.prepare(`INSERT OR IGNORE INTO automation_settings
    (id, enabled, mode, interval_minutes, daily_limit, start_time, end_time, timezone)
    VALUES (1, 0, 'draft', 30, 3, '09:00', '22:00', 'Asia/Seoul')`).run();
  return normalizeSettings(await env.DB.prepare(
    "SELECT * FROM automation_settings WHERE id = ? LIMIT 1",
  ).bind(1).first());
};

export const findCurrentApprovedDraft = async (env, draftId) => {
  const id = Number(draftId);
  if (!Number.isSafeInteger(id) || id < 1) return null;
  return env.DB.prepare(`SELECT id,draft_version,approved_draft_version,approval_status,approved_at
    FROM drafts WHERE id=? AND approval_status='approved' AND approved_at IS NOT NULL
    AND approved_draft_version=draft_version LIMIT 1`).bind(id).first();
};

export const isTime = (value) => typeof value === "string"
  && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);

export const seoulDayBounds = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  const start = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00+09:00`);
  return { start: start.toISOString(), end: new Date(start.getTime() + 86400000).toISOString() };
};

const seoulDateKey = (date) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
}).format(date);

const atSeoulTime = (day, time) => new Date(`${day}T${time}:00+09:00`);

export const isWithinSeoulWindow = (settings, date = new Date()) => {
  const day = seoulDateKey(date);
  const start = atSeoulTime(day, settings.start_time);
  let end = atSeoulTime(day, settings.end_time);
  if (settings.start_time === settings.end_time) return true;
  if (end <= start) {
    if (date < start) return date >= new Date(start.getTime() - 86400000)
      && date <= end;
    end = new Date(end.getTime() + 86400000);
  }
  return date >= start && date <= end;
};

export const nextRunAt = (settings, from = new Date()) => {
  if (!settings.enabled) return null;
  const interval = settings.interval_minutes * 60000;
  let candidate = settings.last_run_at
    ? new Date(new Date(settings.last_run_at).getTime() + interval)
    : new Date(from.getTime() + interval);
  if (Number.isNaN(candidate.getTime()) || candidate < from) candidate = new Date(from.getTime() + interval);

  const day = seoulDateKey(candidate);
  const start = atSeoulTime(day, settings.start_time);
  let end = atSeoulTime(day, settings.end_time);
  if (settings.start_time === settings.end_time) return candidate.toISOString();
  if (end <= start) {
    const localMinutes = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(candidate).replace(":", ""));
    const endMinutes = Number(settings.end_time.replace(":", ""));
    const startMinutes = Number(settings.start_time.replace(":", ""));
    if (localMinutes > endMinutes && localMinutes < startMinutes) candidate = start;
  } else if (candidate < start) candidate = start;
  else if (candidate > end) candidate = new Date(start.getTime() + 86400000);
  return candidate.toISOString();
};

export const acquireRunLock = async (env, ownerId, now = new Date()) => {
  const expiresAt = new Date(now.getTime() + LOCK_TTL_MS).toISOString();
  await env.DB.prepare("DELETE FROM automation_locks WHERE lock_name = ? AND expires_at <= ?")
    .bind(LOCK_NAME, now.toISOString()).run();
  const result = await env.DB.prepare(`INSERT OR IGNORE INTO automation_locks
    (lock_name, owner_id, acquired_at, expires_at) VALUES (?, ?, ?, ?)`)
    .bind(LOCK_NAME, ownerId, now.toISOString(), expiresAt).run();
  return Boolean(result.meta?.changes);
};

export const releaseRunLock = async (env, ownerId) => env.DB.prepare(
  "DELETE FROM automation_locks WHERE lock_name = ? AND owner_id = ?",
).bind(LOCK_NAME, ownerId).run();
