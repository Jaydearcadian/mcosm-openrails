-- OpenRails D1 Database SQL Schema
-- Initialize using: npx wrangler d1 execute openrails_stream_db --local --file=schema.sql
-- For production: npx wrangler d1 execute openrails_stream_db --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS plays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_event_id TEXT,
  paycard_id TEXT NOT NULL,
  artist_mbid TEXT NOT NULL,
  artist_wallet TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  settled INTEGER DEFAULT 0,
  settlement_attempts INTEGER DEFAULT 0,
  last_error TEXT,
  updated_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_plays_settled ON plays(settled);
CREATE INDEX IF NOT EXISTS idx_plays_paycard_id ON plays(paycard_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_plays_source_event_id ON plays(source_event_id) WHERE source_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_plays_pending_attempts ON plays(settled, settlement_attempts);

CREATE TABLE IF NOT EXISTS playback_sessions (
  session_id TEXT PRIMARY KEY,
  paycard_id TEXT NOT NULL UNIQUE,
  listener_address TEXT NOT NULL,
  artist_mbid TEXT NOT NULL,
  artist_wallet TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('funded', 'active', 'stopped', 'settled', 'failed')),
  budget_base_units TEXT NOT NULL,
  velocity_per_second TEXT NOT NULL,
  accrued_base_units TEXT NOT NULL DEFAULT '0',
  started_at INTEGER,
  last_heartbeat_at INTEGER,
  stopped_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_playback_sessions_status ON playback_sessions(status);
CREATE INDEX IF NOT EXISTS idx_playback_sessions_listener ON playback_sessions(listener_address, updated_at);
CREATE INDEX IF NOT EXISTS idx_playback_sessions_artist ON playback_sessions(artist_mbid, updated_at);
