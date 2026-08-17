CREATE TABLE IF NOT EXISTS incident_counters (
  incident_type TEXT NOT NULL,
  incident_year INTEGER NOT NULL,
  current_value INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (incident_type, incident_year)
);

CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_number TEXT NOT NULL UNIQUE,
  incident_type TEXT NOT NULL CHECK (incident_type IN ('stop', 'speed', 'workshop', 'fuel')),
  equipment_code TEXT NOT NULL,
  project_name TEXT,
  location_name TEXT,
  details TEXT,
  stop_duration TEXT,
  recorded_speed REAL,
  speed_limit REAL,
  workshop_name TEXT,
  entry_reason TEXT,
  fuel_before REAL,
  fuel_after REAL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'closed')),
  observer_name TEXT,
  observer_email TEXT,
  reported_at TEXT NOT NULL,
  message_text TEXT NOT NULL,
  closed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_incidents_reported_at ON incidents(reported_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_type_reported_at ON incidents(incident_type, reported_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_status_reported_at ON incidents(status, reported_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_equipment ON incidents(equipment_code);

PRAGMA optimize;
