CREATE TABLE boxes (
  id TEXT PRIMARY KEY,
  number INTEGER NOT NULL UNIQUE,
  title TEXT NOT NULL,
  room TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'packed' CHECK (status IN ('packed', 'unpacked')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE items (
  id TEXT PRIMARY KEY,
  box_id TEXT NOT NULL REFERENCES boxes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  quantity INTEGER,
  source TEXT NOT NULL CHECK (source IN ('ai', 'manual')),
  position INTEGER NOT NULL
);
CREATE INDEX items_box ON items(box_id, position);

CREATE TABLE photos (
  id TEXT PRIMARY KEY,
  box_id TEXT NOT NULL REFERENCES boxes(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX photos_box ON photos(box_id, created_at);
