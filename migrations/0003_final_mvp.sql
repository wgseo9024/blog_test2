CREATE TABLE IF NOT EXISTS automation_locks (
  lock_name TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS automation_run_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL,
  trigger_type TEXT NOT NULL DEFAULT 'scheduler',
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'partial', 'failed', 'skipped')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  collected_count INTEGER NOT NULL DEFAULT 0,
  groups_created INTEGER NOT NULL DEFAULT 0,
  drafts_created INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  details TEXT
);
CREATE INDEX IF NOT EXISTS idx_automation_runs_started ON automation_run_logs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_runs_status ON automation_run_logs(status);

CREATE TABLE IF NOT EXISTS grouping_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  similarity_threshold REAL NOT NULL DEFAULT 0.56 CHECK (similarity_threshold BETWEEN 0.1 AND 1.0),
  token_weight REAL NOT NULL DEFAULT 0.5 CHECK (token_weight BETWEEN 0 AND 1),
  entity_weight REAL NOT NULL DEFAULT 0.35 CHECK (entity_weight BETWEEN 0 AND 1),
  time_weight REAL NOT NULL DEFAULT 0.15 CHECK (time_weight BETWEEN 0 AND 1),
  max_time_gap_hours INTEGER NOT NULL DEFAULT 72 CHECK (max_time_gap_hours BETWEEN 1 AND 336),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO grouping_settings (id) VALUES (1);

ALTER TABLE articles ADD COLUMN extracted_content TEXT;
ALTER TABLE articles ADD COLUMN extraction_status TEXT;
ALTER TABLE articles ADD COLUMN extracted_at TEXT;

CREATE TABLE IF NOT EXISTS article_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL,
  image_url TEXT NOT NULL,
  source TEXT,
  article_url TEXT NOT NULL,
  candidate_type TEXT NOT NULL CHECK (candidate_type IN ('rss', 'og')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(article_id, image_url),
  FOREIGN KEY (article_id) REFERENCES articles(id)
);
CREATE INDEX IF NOT EXISTS idx_article_images_article ON article_images(article_id);

ALTER TABLE drafts ADD COLUMN image_mode TEXT NOT NULL DEFAULT 'none';
ALTER TABLE drafts ADD COLUMN lease_token TEXT;
ALTER TABLE drafts ADD COLUMN lease_expires_at TEXT;
ALTER TABLE drafts ADD COLUMN published_at TEXT;
ALTER TABLE drafts ADD COLUMN publish_error TEXT;
CREATE INDEX IF NOT EXISTS idx_drafts_queue ON drafts(status, lease_expires_at, created_at);

CREATE TABLE IF NOT EXISTS draft_publish_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id INTEGER NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('leased', 'published', 'failed', 'released')),
  message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (draft_id) REFERENCES drafts(id)
);
CREATE INDEX IF NOT EXISTS idx_draft_publish_events_draft ON draft_publish_events(draft_id, created_at DESC);
