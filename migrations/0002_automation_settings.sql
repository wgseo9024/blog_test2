CREATE TABLE IF NOT EXISTS automation_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  mode TEXT NOT NULL DEFAULT 'draft' CHECK (mode IN ('draft', 'review', 'publish')),
  interval_minutes INTEGER NOT NULL DEFAULT 30 CHECK (interval_minutes IN (10, 30, 60, 120, 180, 360)),
  daily_limit INTEGER NOT NULL DEFAULT 3 CHECK (daily_limit BETWEEN 1 AND 30),
  start_time TEXT NOT NULL DEFAULT '09:00',
  end_time TEXT NOT NULL DEFAULT '22:00',
  timezone TEXT NOT NULL DEFAULT 'Asia/Seoul',
  last_run_at TEXT,
  next_run_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO automation_settings
  (id, enabled, mode, interval_minutes, daily_limit, start_time, end_time, timezone)
VALUES (1, 0, 'draft', 30, 3, '09:00', '22:00', 'Asia/Seoul');

CREATE TABLE IF NOT EXISTS publish_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id INTEGER,
  article_group_id INTEGER,
  action TEXT NOT NULL CHECK (action IN ('draft_created', 'queued', 'published', 'failed')),
  message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (draft_id) REFERENCES drafts(id),
  FOREIGN KEY (article_group_id) REFERENCES article_groups(id)
);

CREATE INDEX IF NOT EXISTS idx_publish_logs_created_at ON publish_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_publish_logs_action ON publish_logs(action);
