ALTER TABLE incidents ADD COLUMN closure_reason TEXT;
ALTER TABLE incidents ADD COLUMN closed_by_name TEXT;
ALTER TABLE incidents ADD COLUMN closed_by_email TEXT;
ALTER TABLE incidents ADD COLUMN last_edited_at TEXT;
ALTER TABLE incidents ADD COLUMN last_edited_by_email TEXT;

ALTER TABLE app_users ADD COLUMN can_edit_incidents INTEGER NOT NULL DEFAULT 0
  CHECK (can_edit_incidents IN (0, 1));

UPDATE app_users
SET can_edit_incidents = 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE role = 'admin';

PRAGMA optimize;
