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
});

export const ALLOWED_INTERVALS = new Set([10, 30, 60, 120, 180, 360]);
export const ALLOWED_MODES = new Set(["draft", "review", "publish"]);

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

export const isTime = (value) => typeof value === "string"
  && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);

export const seoulDayBounds = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  const start = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00+09:00`);
  return { start: start.toISOString(), end: new Date(start.getTime() + 86400000).toISOString() };
};

export const nextRunAt = (settings, from = new Date()) => {
  if (!settings.enabled) return null;
  const interval = settings.interval_minutes * 60000;
  let candidate = settings.last_run_at
    ? new Date(new Date(settings.last_run_at).getTime() + interval)
    : new Date(from.getTime() + interval);
  if (Number.isNaN(candidate.getTime()) || candidate < from) candidate = new Date(from.getTime() + interval);

  const seoulDate = new Date(candidate.getTime() + 9 * 3600000);
  const day = seoulDate.toISOString().slice(0, 10);
  const start = new Date(`${day}T${settings.start_time}:00+09:00`);
  const end = new Date(`${day}T${settings.end_time}:00+09:00`);
  if (candidate < start) candidate = start;
  if (candidate > end) {
    const tomorrow = new Date(start.getTime() + 86400000);
    candidate = tomorrow;
  }
  return candidate.toISOString();
};
