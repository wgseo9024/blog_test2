const retryAt = (now) => new Date(now.getTime() + 5 * 60 * 1000).toISOString();

export default {
  async scheduled(_controller, env) {
    const now = new Date();
    const ownerId = `scheduler:${crypto.randomUUID()}`;
    try {
      if (!env.PAGES_BASE_URL) throw new Error("PAGES_BASE_URL is not configured");
      const response = await fetch(new URL("/api/news/collect", env.PAGES_BASE_URL), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      let result;
      try { result = await response.json(); } catch { result = null; }
      if (!response.ok || result?.success === false) {
        throw new Error(result?.error?.message || `Nate collection failed with HTTP ${response.status}`);
      }
      console.log("Nate entertainment ranking collection completed", result?.data);
    } catch (error) {
      console.error("Scheduled Nate collection failed", error);
      try {
        await env.DB.prepare(`INSERT INTO automation_run_logs
          (owner_id,trigger_type,status,started_at,finished_at,error_message)
          VALUES (?,'scheduler-worker','failed',?,?,?)`).bind(ownerId, now.toISOString(),
          new Date().toISOString(), String(error?.message || "Scheduler failure").slice(0, 1000)).run();
        await env.DB.prepare(`UPDATE automation_settings SET next_run_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=1`)
          .bind(retryAt(now)).run();
      } catch (logError) { console.error("Failed to record scheduler error", logError); }
    }
  },
};
