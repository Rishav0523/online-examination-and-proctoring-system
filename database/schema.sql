-- Online Examination & Proctoring System
-- Schema snapshot of migrations/0001_initial_schema.sql (2026-10-31).
-- Apply migrations with Wrangler; this file is the human-readable reference.
-- All timestamps are stored as ISO-8601 UTC strings (YYYY-MM-DDTHH:MM:SS.sssZ)
-- so that lexicographic comparisons are chronologically correct.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name      TEXT    NOT NULL,
  student_id     TEXT    UNIQUE,
  email          TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  department     TEXT    NOT NULL DEFAULT '',
  semester       TEXT    NOT NULL DEFAULT '',
  password_hash  TEXT    NOT NULL,
  role           TEXT    NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'admin')),
  is_active      INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);
CREATE INDEX IF NOT EXISTS idx_users_active ON users (is_active);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT    PRIMARY KEY,              -- SHA-256 hash of the session token
  user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  csrf_token  TEXT    NOT NULL,
  created_at  TEXT    NOT NULL,
  expires_at  TEXT    NOT NULL,
  user_agent  TEXT    NOT NULL DEFAULT '',
  ip_address  TEXT    NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS exams (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  title              TEXT    NOT NULL,
  description        TEXT    NOT NULL DEFAULT '',
  subject            TEXT    NOT NULL,
  duration           INTEGER NOT NULL CHECK (duration > 0),      -- minutes
  total_marks        INTEGER NOT NULL DEFAULT 0 CHECK (total_marks >= 0),
  passing_marks      INTEGER NOT NULL DEFAULT 0 CHECK (passing_marks >= 0),
  start_time         TEXT    NOT NULL,
  end_time           TEXT    NOT NULL,
  instructions       TEXT    NOT NULL DEFAULT '',
  status             TEXT    NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'published', 'active', 'closed')),
  results_published  INTEGER NOT NULL DEFAULT 0 CHECK (results_published IN (0, 1)),
  created_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_exams_status ON exams (status);
CREATE INDEX IF NOT EXISTS idx_exams_start ON exams (start_time);
CREATE INDEX IF NOT EXISTS idx_exams_end ON exams (end_time);

CREATE TABLE IF NOT EXISTS questions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id        INTEGER NOT NULL REFERENCES exams (id) ON DELETE CASCADE,
  question_text  TEXT    NOT NULL,
  marks          INTEGER NOT NULL DEFAULT 1 CHECK (marks > 0),
  question_order INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_questions_exam ON questions (exam_id, question_order);

CREATE TABLE IF NOT EXISTS options (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id  INTEGER NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  option_text  TEXT    NOT NULL,
  is_correct   INTEGER NOT NULL DEFAULT 0 CHECK (is_correct IN (0, 1)),
  option_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_options_question ON options (question_id);

CREATE TABLE IF NOT EXISTS exam_attempts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  exam_id         INTEGER NOT NULL REFERENCES exams (id) ON DELETE CASCADE,
  start_time      TEXT    NOT NULL,
  expires_at      TEXT    NOT NULL,
  end_time        TEXT,
  status          TEXT    NOT NULL DEFAULT 'in_progress'
                  CHECK (status IN ('in_progress', 'submitted', 'expired')),
  consent_given   INTEGER NOT NULL DEFAULT 0 CHECK (consent_given IN (0, 1)),
  last_activity_at TEXT,
  UNIQUE (user_id, exam_id)
);

CREATE INDEX IF NOT EXISTS idx_attempts_user ON exam_attempts (user_id);
CREATE INDEX IF NOT EXISTS idx_attempts_exam ON exam_attempts (exam_id);
CREATE INDEX IF NOT EXISTS idx_attempts_status ON exam_attempts (status, expires_at);

CREATE TABLE IF NOT EXISTS student_answers (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id         INTEGER NOT NULL REFERENCES exam_attempts (id) ON DELETE CASCADE,
  question_id        INTEGER NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  selected_option_id INTEGER REFERENCES options (id) ON DELETE SET NULL,
  updated_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (attempt_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_answers_attempt ON student_answers (attempt_id);

CREATE TABLE IF NOT EXISTS results (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id     INTEGER NOT NULL UNIQUE REFERENCES exam_attempts (id) ON DELETE CASCADE,
  obtained_marks REAL    NOT NULL,
  total_marks    REAL    NOT NULL,
  percentage     REAL    NOT NULL,
  status         TEXT    NOT NULL CHECK (status IN ('pass', 'fail')),
  evaluated_at   TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_results_status ON results (status);

CREATE TABLE IF NOT EXISTS proctoring_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id    INTEGER NOT NULL REFERENCES exam_attempts (id) ON DELETE CASCADE,
  event_type    TEXT    NOT NULL,
  description   TEXT    NOT NULL DEFAULT '',
  severity      TEXT    NOT NULL DEFAULT 'low' CHECK (severity IN ('low', 'medium', 'high')),
  timestamp     TEXT    NOT NULL,
  review_status TEXT    NOT NULL DEFAULT 'unreviewed'
                CHECK (review_status IN ('unreviewed', 'reviewed', 'dismissed')),
  reviewed_by   INTEGER REFERENCES users (id) ON DELETE SET NULL,
  reviewed_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_proctor_attempt ON proctoring_logs (attempt_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_proctor_review ON proctoring_logs (review_status);
CREATE INDEX IF NOT EXISTS idx_proctor_type ON proctoring_logs (event_type);
