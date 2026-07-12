ALTER TABLE drafts ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE drafts ADD COLUMN approved_at TEXT;
ALTER TABLE drafts ADD COLUMN approved_draft_version INTEGER;
ALTER TABLE drafts ADD COLUMN draft_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE drafts ADD COLUMN selected_cover_image_id INTEGER;
ALTER TABLE drafts ADD COLUMN selected_content_image_ids_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE automation_settings ADD COLUMN approved_draft_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_drafts_approval ON drafts(approval_status, approved_at);

