ALTER TABLE articles ADD COLUMN source_type TEXT;
ALTER TABLE articles ADD COLUMN nate_rank INTEGER;
ALTER TABLE articles ADD COLUMN previous_nate_rank INTEGER;
ALTER TABLE articles ADD COLUMN best_nate_rank INTEGER;
ALTER TABLE articles ADD COLUMN rank_change INTEGER;
ALTER TABLE articles ADD COLUMN nate_article_id TEXT;
ALTER TABLE articles ADD COLUMN normalized_article_url TEXT;
ALTER TABLE articles ADD COLUMN canonical_url TEXT;
ALTER TABLE articles ADD COLUMN original_publisher_url TEXT;
ALTER TABLE articles ADD COLUMN ranking_date TEXT;
ALTER TABLE articles ADD COLUMN ranking_first_seen_at TEXT;
ALTER TABLE articles ADD COLUMN ranking_last_seen_at TEXT;
ALTER TABLE articles ADD COLUMN representative_image_url TEXT;
ALTER TABLE articles ADD COLUMN generated_thumbnail_url TEXT;
ALTER TABLE articles ADD COLUMN thumbnail_r2_key TEXT;
ALTER TABLE articles ADD COLUMN thumbnail_hooks_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE articles ADD COLUMN thumbnail_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE articles ADD COLUMN thumbnail_approved INTEGER NOT NULL DEFAULT 0;
ALTER TABLE articles ADD COLUMN scrape_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE articles ADD COLUMN draft_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE articles ADD COLUMN title_hash TEXT;
ALTER TABLE articles ADD COLUMN reporter TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_nate_article_id
ON articles(nate_article_id) WHERE nate_article_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_normalized_url
ON articles(normalized_article_url) WHERE normalized_article_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_articles_title_hash ON articles(title_hash);

CREATE TABLE IF NOT EXISTS article_rank_history (
  id TEXT PRIMARY KEY,
  article_id INTEGER NOT NULL,
  rank INTEGER NOT NULL CHECK(rank BETWEEN 1 AND 10),
  ranking_date TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  FOREIGN KEY(article_id) REFERENCES articles(id)
);
CREATE INDEX IF NOT EXISTS idx_rank_history_article ON article_rank_history(article_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS nate_collection_runs (
  id TEXT PRIMARY KEY,
  ranking_date TEXT NOT NULL,
  ranking_url TEXT NOT NULL,
  checked_count INTEGER NOT NULL DEFAULT 0,
  new_article_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL CHECK(status IN ('running','completed','failed')),
  error_message TEXT
);
