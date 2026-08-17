CREATE TABLE IF NOT EXISTS app_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'monitor' CHECK (role IN ('admin', 'monitor')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_email
ON app_users(email COLLATE NOCASE);

INSERT INTO app_users (email, full_name, role, active, created_by, created_at, updated_at)
VALUES (
  'yousefabdulkarim21@gmail.com',
  'يوسف عبدالكريم',
  'admin',
  1,
  'system',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
ON CONFLICT(email) DO UPDATE SET
  role = 'admin',
  active = 1,
  updated_at = excluded.updated_at;

PRAGMA optimize;
