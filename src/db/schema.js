// Схема описана дважды, потому что типы автоинкремента и времени
// в SQLite и PostgreSQL несовместимы. Остальные запросы приложения общие.

export const postgresSchema = `
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT NOT NULL,
  username_key  TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name  TEXT,
  bio           TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS entries (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ref         TEXT NOT NULL,
  media_type  TEXT NOT NULL DEFAULT 'movie',
  title       TEXT NOT NULL,
  original_title TEXT,
  year        INTEGER,
  poster_url  TEXT,
  overview    TEXT,
  genres      TEXT,
  runtime     INTEGER,
  imdb_id     TEXT,
  tmdb_id     INTEGER,
  status      TEXT NOT NULL DEFAULT 'watched',
  rating      INTEGER,
  review      TEXT,
  favorite    BOOLEAN NOT NULL DEFAULT FALSE,
  watched_on  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, ref)
);

CREATE INDEX IF NOT EXISTS entries_user_status_idx ON entries (user_id, status);
`;

export const sqliteSchema = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL,
  username_key  TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name  TEXT,
  bio           TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ref         TEXT NOT NULL,
  media_type  TEXT NOT NULL DEFAULT 'movie',
  title       TEXT NOT NULL,
  original_title TEXT,
  year        INTEGER,
  poster_url  TEXT,
  overview    TEXT,
  genres      TEXT,
  runtime     INTEGER,
  imdb_id     TEXT,
  tmdb_id     INTEGER,
  status      TEXT NOT NULL DEFAULT 'watched',
  rating      INTEGER,
  review      TEXT,
  favorite    INTEGER NOT NULL DEFAULT 0,
  watched_on  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (user_id, ref)
);

CREATE INDEX IF NOT EXISTS entries_user_status_idx ON entries (user_id, status);
`;
