ALTER TABLE articles ADD COLUMN is_advertisement INTEGER NOT NULL DEFAULT 0;
ALTER TABLE articles ADD COLUMN advertisement_score INTEGER NOT NULL DEFAULT 0;
ALTER TABLE articles ADD COLUMN advertisement_reasons TEXT NOT NULL DEFAULT '[]';

ALTER TABLE drafts ADD COLUMN body_blocks_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE drafts ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE drafts ADD COLUMN rendered_content TEXT;
ALTER TABLE drafts ADD COLUMN source_article_ids_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE drafts ADD COLUMN generation_model TEXT;
ALTER TABLE drafts ADD COLUMN generation_status TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE drafts ADD COLUMN validation_status TEXT NOT NULL DEFAULT 'not_run';
ALTER TABLE drafts ADD COLUMN validation_issues_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE drafts ADD COLUMN result_url TEXT;

ALTER TABLE article_images ADD COLUMN content_type TEXT;
ALTER TABLE article_images ADD COLUMN width INTEGER;
ALTER TABLE article_images ADD COLUMN height INTEGER;
ALTER TABLE article_images ADD COLUMN size_bytes INTEGER;
ALTER TABLE article_images ADD COLUMN sha256 TEXT;
ALTER TABLE article_images ADD COLUMN perceptual_hash TEXT;
ALTER TABLE article_images ADD COLUMN duplicate_of INTEGER;
ALTER TABLE article_images ADD COLUMN exclude_reason TEXT;
ALTER TABLE article_images ADD COLUMN rights_status TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE article_images ADD COLUMN rights_confirmed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE article_images ADD COLUMN approved_for_use INTEGER NOT NULL DEFAULT 0;
ALTER TABLE article_images ADD COLUMN sort_order INTEGER;
ALTER TABLE article_images ADD COLUMN crop_percent REAL;
ALTER TABLE article_images ADD COLUMN crop_pixels INTEGER;
ALTER TABLE article_images ADD COLUMN processing_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE article_images ADD COLUMN processing_error TEXT;
ALTER TABLE article_images ADD COLUMN original_r2_key TEXT;
ALTER TABLE article_images ADD COLUMN processed_r2_key TEXT;

CREATE INDEX IF NOT EXISTS idx_articles_advertisement ON articles(is_advertisement, created_at);
CREATE INDEX IF NOT EXISTS idx_article_images_approval ON article_images(approved_for_use, sort_order);
CREATE INDEX IF NOT EXISTS idx_article_images_hashes ON article_images(sha256, perceptual_hash);
