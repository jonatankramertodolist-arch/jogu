-- Jogu's storage. Two rules hold throughout:
--
-- 1. Every table that holds athlete data carries user_id, and every query in the
--    API filters on the user resolved from the session cookie. The client never
--    sends a user id, so there is no request shape that reaches another account.
-- 2. Bodies are stored as JSON rather than spread across columns. The server
--    never reads inside them: all training maths runs in TypeScript, shared by
--    the browser and the API. Keeping the payload opaque means the data model can
--    grow, as it will when more sports arrive, without a database migration.

CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,
  google_sub   TEXT NOT NULL UNIQUE,
  email        TEXT NOT NULL,
  name         TEXT NOT NULL DEFAULT '',
  picture_url  TEXT,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

-- Login sessions, not training sessions. Only the SHA-256 of the cookie value is
-- kept, so a leaked copy of this table cannot be replayed as somebody's login.
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS auth_sessions_user ON auth_sessions(user_id);

-- The athlete's own Anthropic key, encrypted with AES-GCM against a secret that
-- lives outside the database. The ciphertext on its own is not usable, and the
-- plaintext is never sent back to a browser.
CREATE TABLE IF NOT EXISTS user_secrets (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  key_cipher TEXT NOT NULL,
  key_iv     TEXT NOT NULL,
  -- Last few characters, so the interface can show which key is connected.
  key_hint   TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Things edited deliberately, in one place at a time: profile, goal, plan,
-- settings. Newest write wins, which is what a person switching devices expects.
CREATE TABLE IF NOT EXISTS documents (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  body       TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, kind)
);

CREATE INDEX IF NOT EXISTS documents_sync ON documents(user_id, updated_at);

-- Things that change independently on different devices, so they sync per row
-- rather than as one blob: training sessions, logs, adjustments, chat. Without
-- this, logging a session on the phone would be wiped by the laptop's next save.
CREATE TABLE IF NOT EXISTS records (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  id         TEXT NOT NULL,
  body       TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  -- A tombstone, so a deletion on one device also reaches the others.
  deleted    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, kind, id)
);

CREATE INDEX IF NOT EXISTS records_sync ON records(user_id, updated_at);
