-- Accounts, sessions, verified runs, boards and counters for the online API.

CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  guest       INTEGER NOT NULL DEFAULT 1,
  email       TEXT UNIQUE,
  google_sub  TEXT UNIQUE,
  profile     TEXT NOT NULL,
  rev         INTEGER NOT NULL DEFAULT 0,  -- bumped on every profile write (optimistic lock)
  created_at  INTEGER NOT NULL
);

CREATE TABLE sessions (
  hash        TEXT PRIMARY KEY,            -- SHA-256 hex of the sid cookie
  user_id     TEXT NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL,
  agent       TEXT NOT NULL DEFAULT ''
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE login_tokens (
  hash        TEXT PRIMARY KEY,            -- SHA-256 hex of the emailed token
  email       TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  used        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX login_tokens_email ON login_tokens(email);

CREATE TABLE runs (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  status       TEXT NOT NULL,              -- started queued verified rejected unverified deferred
  cfg          TEXT NOT NULL,              -- JSON {difficulty, mode, length, modifiers}
  seed         INTEGER NOT NULL,
  build        TEXT NOT NULL,
  board_key    TEXT NOT NULL,
  weekly       INTEGER NOT NULL DEFAULT 0,
  iat          INTEGER NOT NULL,           -- ticket issue time (ms)
  claim        TEXT,
  log_ticks    INTEGER,
  submitted_at INTEGER,
  attempts     INTEGER NOT NULL DEFAULT 0,
  error        TEXT,
  err_tick     INTEGER,
  result       TEXT,
  run_state    TEXT,                       -- profile runState, so a longer log adds only the difference
  log_pruned   INTEGER NOT NULL DEFAULT 0, -- the R2 log was deleted after the retention period
  log_ver      INTEGER NOT NULL DEFAULT 0, -- accepted submissions so far; names the R2 object
  ip_key       TEXT,                       -- hashed client address (IPv4 or IPv6 /64) of the last submission
  charged      REAL NOT NULL DEFAULT 0,    -- estimated verification CPU ms charged to this run
  cmds_hash    TEXT                        -- SHA-256 of the command list, to spot copied weekly logs
);
CREATE INDEX runs_user ON runs(user_id, iat);
CREATE INDEX runs_status ON runs(status, submitted_at);
CREATE INDEX runs_weekly_cmds ON runs(board_key, cmds_hash);

CREATE TABLE board (
  key      TEXT NOT NULL,
  user_id  TEXT NOT NULL REFERENCES users(id),
  score    INTEGER NOT NULL,
  level    INTEGER NOT NULL,
  waves    INTEGER NOT NULL,
  outcome  TEXT NOT NULL,
  at       INTEGER NOT NULL,
  run_id   TEXT NOT NULL,                  -- the run holding the entry; its log is kept
  PRIMARY KEY (key, user_id)
);
CREATE INDEX board_rank ON board(key, score DESC);

CREATE TABLE rate (
  k  TEXT NOT NULL,                        -- hashed bucket name
  w  INTEGER NOT NULL,                     -- window number
  n  INTEGER NOT NULL,
  PRIMARY KEY (k, w)
);

CREATE TABLE usage (
  month     TEXT PRIMARY KEY,              -- YYYY-MM (UTC)
  cpu_ms    REAL NOT NULL DEFAULT 0,
  verified  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE share (
  month   TEXT NOT NULL,
  k       TEXT NOT NULL,                   -- u:<user id> or i:<hashed address>
  cpu_ms  REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (month, k)
);

CREATE TABLE usage_daily (
  day     TEXT PRIMARY KEY,                -- YYYY-MM-DD (UTC)
  emails  INTEGER NOT NULL DEFAULT 0
);
