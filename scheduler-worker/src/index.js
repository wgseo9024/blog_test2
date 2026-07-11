const FIVE_MINUTES_MS = 5 * 60 * 1000;
const SEOUL_TIME_ZONE = "Asia/Seoul";

const seoulMinutes = (date) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SEOUL_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return Number(values.hour) * 60 + Number(values.minute);
};

const clockMinutes = (value) => {
  const match = /^(\d{2}):(\d{2})$/.exec(value || "");
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
};

const isWithinWindow = (now, startTime, endTime) => {
  const current = seoulMinutes(now);
  const start = clockMinutes(startTime);
  const end = clockMinutes(endTime);
  if (start === null || end === null) throw new Error("Invalid automation time window");
  if (start === end) return true;
  return start < end ? current >= start && current <= end : current >= start || current <= end;
};

const retryAt = (now) => new Date(now.getTime() + FIVE_MINUTES_MS).toISOString();

const scheduleRetry = async (env, now) => {
  await env.DB.prepare(`UPDATE automation_settings
    SET next_run_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`)
    .bind(retryAt(now)).run();
};

export default {
  async scheduled(_controller, env) {
    const now = new Date();
    try {
      const settings = await env.DB.prepare(
        "SELECT enabled, interval_minutes, start_time, end_time, last_run_at, next_run_at FROM automation_settings WHERE id = 1",
      ).first();

      if (!settings) throw new Error("automation_settings id=1 was not found");
      if (!Boolean(settings.enabled)) return;
      if (!isWithinWindow(now, settings.start_time, settings.end_time)) return;

      if (settings.next_run_at) {
        const nextRun = new Date(settings.next_run_at);
        if (Number.isNaN(nextRun.getTime())) throw new Error("Invalid next_run_at value");
        if (nextRun > now) return;
      }

      if (!env.PAGES_BASE_URL) throw new Error("PAGES_BASE_URL is not configured");
      if (!env.AUTOMATION_TOKEN) throw new Error("AUTOMATION_TOKEN is not configured");

      const response = await fetch(new URL("/api/automation/run", env.PAGES_BASE_URL), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.AUTOMATION_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ force: false }),
      });

      let result = null;
      try { result = await response.json(); } catch { /* HTTP status still determines failure. */ }
      if (!response.ok || result?.success === false) {
        throw new Error(`Pages automation API failed with HTTP ${response.status}`);
      }

      const interval = Number(settings.interval_minutes);
      if (!Number.isFinite(interval) || interval <= 0) throw new Error("Invalid interval_minutes value");
      const nextRunAt = new Date(now.getTime() + interval * 60 * 1000).toISOString();
      await env.DB.prepare(`UPDATE automation_settings
        SET last_run_at = ?, next_run_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`)
        .bind(now.toISOString(), nextRunAt).run();
    } catch (error) {
      console.error("Scheduled automation failed", error);
      try {
        await scheduleRetry(env, now);
      } catch (retryError) {
        console.error("Failed to schedule automation retry", retryError);
      }
    }
  },
};
