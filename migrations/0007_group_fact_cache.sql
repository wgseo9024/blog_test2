CREATE TABLE IF NOT EXISTS group_fact_cache (
  group_id INTEGER PRIMARY KEY,
  content_signature TEXT NOT NULL,
  facts_json TEXT NOT NULL,
  model TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES article_groups(id)
);

