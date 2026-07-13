ALTER TABLE articles ADD COLUMN content_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_content_hash
ON articles(content_hash) WHERE content_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS rss_collection_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL CHECK(status IN ('running','completed','partial','failed')),
  fetched_count INTEGER NOT NULL DEFAULT 0,
  new_article_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  advertisement_excluded_count INTEGER NOT NULL DEFAULT 0,
  short_content_excluded_count INTEGER NOT NULL DEFAULT 0,
  extraction_success_count INTEGER NOT NULL DEFAULT 0,
  group_count INTEGER NOT NULL DEFAULT 0,
  draft_count INTEGER NOT NULL DEFAULT 0,
  image_candidate_count INTEGER NOT NULL DEFAULT 0,
  details_json TEXT NOT NULL DEFAULT '{}',
  error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_rss_collection_runs_started ON rss_collection_runs(started_at DESC);

CREATE TABLE IF NOT EXISTS publish_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK(status IN ('queued','processing','saved','completed','login_required','failed')),
  claim_token TEXT,
  claimed_at TEXT,
  lease_expires_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  naver_draft_url TEXT,
  completed_at TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(draft_id) REFERENCES drafts(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_publish_jobs_active_draft
ON publish_jobs(draft_id) WHERE status IN ('queued','processing');
CREATE INDEX IF NOT EXISTS idx_publish_jobs_next ON publish_jobs(status, created_at, id);
