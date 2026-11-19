CREATE TABLE box_search_embeddings (
  box_id TEXT PRIMARY KEY REFERENCES boxes(id) ON DELETE CASCADE,
  cache_key TEXT NOT NULL,
  embedding TEXT NOT NULL
);
