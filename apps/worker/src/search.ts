import { createOpenAI } from '@ai-sdk/openai';
import { cosineSimilarity, embedMany } from 'ai';

const MODEL = 'text-embedding-3-small';
const DIMENSIONS = 256;
const MIN_SIMILARITY = 0.4;
const MAX_SEMANTIC_RESULTS = 12;

const summaries = `SELECT b.*,
  (SELECT COUNT(*) FROM items i WHERE i.box_id = b.id) AS item_count,
  (SELECT group_concat(name, ', ') FROM (SELECT name FROM items i WHERE i.box_id = b.id ORDER BY position LIMIT 6)) AS preview`;
const numberMatch = 'CAST(b.number AS TEXT) = ?2';
const keywordMatch = `(${numberMatch} OR instr(lower(b.title), lower(?1)) > 0
  OR instr(lower(b.room), lower(?1)) > 0 OR instr(lower(b.notes), lower(?1)) > 0
  OR EXISTS (SELECT 1 FROM items i WHERE i.box_id = b.id AND instr(lower(i.name), lower(?1)) > 0))`;
export const searchItems = `(SELECT substr(group_concat(name, ', '), 1, 1500) FROM
  (SELECT name FROM items i WHERE i.box_id = b.id ORDER BY position))`;
export const upsertEmbedding = `INSERT INTO box_search_embeddings (box_id, cache_key, embedding)
  SELECT id, ?, ? FROM boxes WHERE id = ?
  ON CONFLICT(box_id) DO UPDATE SET cache_key = excluded.cache_key, embedding = excluded.embedding`;

type BoxSummary = {
  id: string;
  house_id: string;
  number: number;
  title: string;
  room: string | null;
  notes: string | null;
  status: 'packed' | 'unpacked';
  created_at: number;
  updated_at: number;
  item_count: number;
  preview: string | null;
};

type SearchRow = BoxSummary & {
  keyword_match: 0 | 1 | null;
  search_items: string | null;
  cache_key: string | null;
  embedding: string | null;
};

export async function searchBoxes(
  db: D1Database,
  apiKey: string,
  houseId: string,
  query: string,
): Promise<BoxSummary[]> {
  if (!query) {
    const { results } = await db
      .prepare(`${summaries} FROM boxes b WHERE b.house_id = ? ORDER BY b.number DESC`)
      .bind(houseId)
      .all<BoxSummary>();
    return results;
  }

  const boxNumber = /^(box\s*#?\s*|#\s*)?(\d+)$/i.exec(query);
  const number = boxNumber?.[2].replace(/^0+(?=\d)/, '') ?? '';
  if (boxNumber?.[1]) {
    const { results } = await db
      .prepare(`${summaries} FROM boxes b WHERE b.house_id = ? AND CAST(b.number AS TEXT) = ?`)
      .bind(houseId, number)
      .all<BoxSummary>();
    return results;
  }

  if (apiKey && !boxNumber && query.length <= 512 && /\p{L}/u.test(query)) {
    try {
      const { results } = await db
        .prepare(
          `${summaries}, ${keywordMatch} AS keyword_match, ${searchItems} AS search_items, e.cache_key, e.embedding
         FROM boxes b LEFT JOIN box_search_embeddings e ON e.box_id = b.id
         WHERE b.house_id = ?3
         ORDER BY b.number DESC`,
        )
        .bind(query, number, houseId)
        .all<SearchRow>();

      return await rankMatches(db, apiKey, query, results);
    } catch (error) {
      console.warn(
        'Semantic box search unavailable',
        error instanceof Error ? error.name : 'Unknown error',
      );
    }
  }

  const { results } = await db
    .prepare(
      `${summaries} FROM boxes b WHERE b.house_id = ?3 AND ${keywordMatch} ORDER BY ${numberMatch} DESC, b.number DESC`,
    )
    .bind(query, number, houseId)
    .all<BoxSummary>();
  return results;
}

export function embeddingDocument(title: string, room: string | null, items: string | null) {
  // Keep notes in keyword search. Embeddings only need the labels and item names.
  const input = [title.slice(0, 80), room?.slice(0, 100), items].filter(Boolean).join('\n');
  return { input, cacheKey: `${MODEL}:${DIMENSIONS}\n${input}` };
}

export async function embedSearchTexts(apiKey: string, values: string[]) {
  const openai = createOpenAI({ apiKey });
  const { embeddings } = await embedMany({
    model: openai.embedding(MODEL),
    values,
    providerOptions: { openai: { dimensions: DIMENSIONS } },
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(4000),
  });
  return embeddings;
}

async function rankMatches(db: D1Database, apiKey: string, query: string, rows: SearchRow[]) {
  const keywords: BoxSummary[] = [];
  const candidates = rows.flatMap(
    ({ keyword_match, search_items, cache_key, embedding, ...box }) => {
      if (keyword_match) {
        keywords.push(box);
        return [];
      }
      const { input, cacheKey } = embeddingDocument(box.title, box.room, search_items);
      if (!input.trim()) {
        return [];
      }

      // A changed input invalidates its vector, including edits made during a concurrent search.
      const vector =
        cache_key === cacheKey && embedding ? (JSON.parse(embedding) as number[]) : null;
      return [{ box, input, cacheKey, vector }];
    },
  );
  if (!candidates.length) {
    return keywords;
  }

  const missing = candidates.filter((candidate) => candidate.vector === null);
  const [queryVector, ...newVectors] = await embedSearchTexts(apiKey, [
    query,
    ...missing.map(({ input }) => input),
  ]);

  if (missing.length) {
    const upsert = db.prepare(upsertEmbedding);
    const writes = missing.map((candidate, index) => {
      candidate.vector = newVectors[index];
      return upsert.bind(candidate.cacheKey, JSON.stringify(candidate.vector), candidate.box.id);
    });
    // The matches are usable even if D1 cannot persist the cache.
    await db.batch(writes).catch(() => console.warn('Could not cache box search embeddings'));
  }

  const related = candidates
    .map(({ box, vector }) => ({ box, score: vector ? cosineSimilarity(queryVector, vector) : 0 }))
    .filter(({ score }) => score >= MIN_SIMILARITY)
    .toSorted((a, b) => b.score - a.score || b.box.number - a.box.number)
    .slice(0, MAX_SEMANTIC_RESULTS)
    .map(({ box }) => box);
  return [...keywords, ...related];
}
