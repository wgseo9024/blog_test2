UPDATE automation_settings
SET enabled = 0, next_run_at = NULL, updated_at = CURRENT_TIMESTAMP
WHERE approved_draft_id IS NULL;
