-- Accounts (via auth.aranlucas.workers.dev), app sessions, houses, members, invites.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  auth_sub TEXT NOT NULL UNIQUE,
  email TEXT,
  name TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE auth_requests (
  state TEXT PRIMARY KEY,
  verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  return_to TEXT,
  native_challenge TEXT,
  expires_at INTEGER NOT NULL
);

CREATE TABLE native_codes (
  code_hash TEXT PRIMARY KEY,
  session_token TEXT NOT NULL,
  challenge TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE houses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE members (
  house_id TEXT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (house_id, user_id)
);
CREATE INDEX members_user ON members(user_id);

CREATE TABLE invites (
  token_hash TEXT PRIMARY KEY,
  house_id TEXT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  accepted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  accepted_at INTEGER,
  revoked_at INTEGER
);
CREATE INDEX invites_house ON invites(house_id);

-- Legacy house for boxes packed before accounts existed; claimed with the old household key.
INSERT INTO houses (id, name, created_at) VALUES ('HOME0000', 'Home', CAST(unixepoch('subsecond') * 1000 AS INTEGER));

-- Rebuild boxes with house_id and per-house numbering. Children are rebuilt too and old
-- tables are dropped children-first, so no ON DELETE CASCADE fires on existing rows.
CREATE TABLE boxes_new (
  id TEXT PRIMARY KEY,
  house_id TEXT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  room TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'packed' CHECK (status IN ('packed', 'unpacked')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (house_id, number)
);
CREATE TABLE items_new (
  id TEXT PRIMARY KEY,
  box_id TEXT NOT NULL REFERENCES boxes_new(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  quantity INTEGER,
  source TEXT NOT NULL CHECK (source IN ('ai', 'manual')),
  position INTEGER NOT NULL
);
CREATE TABLE photos_new (
  id TEXT PRIMARY KEY,
  box_id TEXT NOT NULL REFERENCES boxes_new(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

INSERT INTO boxes_new (id, house_id, number, title, room, notes, status, created_at, updated_at)
  SELECT id, 'HOME0000', number, title, room, notes, status, created_at, updated_at FROM boxes;
INSERT INTO items_new (id, box_id, name, quantity, source, position)
  SELECT id, box_id, name, quantity, source, position FROM items;
INSERT INTO photos_new (id, box_id, r2_key, created_at)
  SELECT id, box_id, r2_key, created_at FROM photos;

DROP TABLE photos;
DROP TABLE items;
DROP TABLE boxes;

ALTER TABLE boxes_new RENAME TO boxes;
ALTER TABLE items_new RENAME TO items;
ALTER TABLE photos_new RENAME TO photos;

CREATE INDEX boxes_house ON boxes(house_id, number);
CREATE INDEX items_box ON items(box_id, position);
CREATE INDEX photos_box ON photos(box_id, created_at);
