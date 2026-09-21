#!/usr/bin/env node
/**
 * Embedding Backfill Script
 *
 * Finds active memories missing valid embeddings and generates them in bounded batches.
 * Safe, resumable, idempotent — skips memories that already have correct embeddings.
 *
 * Usage:
 *   node scripts/memory/backfill-embeddings.mjs
 *
 * Environment variables (inherited from server config):
 *   MEMORY_DATABASE_URL        — PostgreSQL connection string (required)
 *   MEMORY_EMBEDDINGS_ENABLED  — must be "true" (required)
 *   MEMORY_EMBEDDING_URL       — embedding API endpoint (required)
 *   MEMORY_EMBEDDING_MODEL     — model identifier (required)
 *   MEMORY_EMBEDDING_DIMENSIONS — expected dimensions (required)
 *   MEMORY_EMBEDDING_PROVIDER  — provider label (default: "openai-compatible")
 *   MEMORY_EMBEDDING_VERSION   — version tag (default: "1")
 *   MEMORY_EMBEDDING_API_KEY   — API key (optional)
 *   BACKFILL_BATCH_SIZE        — memories per batch (default: 50, max: 200)
 *   BACKFILL_DELAY_MS          — delay between batches (default: 100)
 */

import { Pool } from 'pg';

const BATCH_SIZE = Math.min(200, Math.max(1, Number(process.env.BACKFILL_BATCH_SIZE) || 50));
const DELAY_MS = Math.max(0, Number(process.env.BACKFILL_DELAY_MS) || 100);

function parseConfig() {
  const connectionString = process.env.MEMORY_DATABASE_URL;
  if (!connectionString) throw new Error('MEMORY_DATABASE_URL is required');

  if (process.env.MEMORY_EMBEDDINGS_ENABLED !== 'true') {
    throw new Error('MEMORY_EMBEDDINGS_ENABLED must be "true" to run backfill');
  }

  const endpoint = process.env.MEMORY_EMBEDDING_URL;
  const model = process.env.MEMORY_EMBEDDING_MODEL;
  const dimensions = Number(process.env.MEMORY_EMBEDDING_DIMENSIONS);

  if (!endpoint) throw new Error('MEMORY_EMBEDDING_URL is required');
  if (!model) throw new Error('MEMORY_EMBEDDING_MODEL is required');
  if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > 4096) {
    throw new Error('MEMORY_EMBEDDING_DIMENSIONS must be a valid integer (1-4096)');
  }

  return {
    connectionString,
    endpoint,
    provider: process.env.MEMORY_EMBEDDING_PROVIDER || 'openai-compatible',
    model,
    dimensions,
    version: process.env.MEMORY_EMBEDDING_VERSION || '1',
    apiKey: process.env.MEMORY_EMBEDDING_API_KEY,
  };
}

async function fetchEmbeddings(config, texts) {
  const headers = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;

  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: config.model, input: texts, encoding_format: 'float' }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Embedding API error ${response.status}: ${body.slice(0, 200)}`);
  }

  const body = await response.json();
  if (!Array.isArray(body.data) || body.data.length !== texts.length) {
    throw new Error(`Embedding API returned ${body.data?.length ?? 0} results for ${texts.length} inputs`);
  }

  return body.data
    .sort((a, b) => a.index - b.index)
    .map((item) => {
      if (!Array.isArray(item.embedding) || item.embedding.length !== config.dimensions) {
        throw new Error(`Embedding dimensions mismatch: expected ${config.dimensions}, got ${item.embedding?.length}`);
      }
      return item.embedding;
    });
}

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const config = parseConfig();
  console.log(`[backfill] Starting embedding backfill`);
  console.log(`[backfill] Provider: ${config.provider}, Model: ${config.model}, Dimensions: ${config.dimensions}, Version: ${config.version}`);
  console.log(`[backfill] Batch size: ${BATCH_SIZE}, Delay: ${DELAY_MS}ms`);

  const pool = new Pool({ connectionString: config.connectionString, max: 4 });

  let totalBackfilled = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  let batchNumber = 0;

  try {
    // Verify pgvector extension and embedding_vector column exist
    const extCheck = await pool.query(
      "SELECT 1 FROM pg_extension WHERE extname = 'vector'"
    );
    if (extCheck.rows.length === 0) {
      console.error('[backfill] ERROR: pgvector extension not found. Run migrations first: pnpm db:migrate');
      process.exit(1);
    }

    const colCheck = await pool.query(
      "SELECT 1 FROM information_schema.columns WHERE table_name = 'studio_memories' AND column_name = 'embedding_vector'"
    );
    if (colCheck.rows.length === 0) {
      console.error('[backfill] ERROR: embedding_vector column not found. Run pgvector migration first.');
      process.exit(1);
    }

    // Find all active memories missing valid embeddings
    // Using FOR UPDATE SKIP LOCKED for safe concurrent execution
    const countResult = await pool.query(`
      SELECT COUNT(*) as total
      FROM studio_memories
      WHERE status = 'active'
        AND (embedding IS NULL
          OR embedding_provider IS NULL
          OR embedding_model IS NULL
          OR embedding_version IS NULL
          OR embedding_dimensions IS NULL
          OR embedding::double precision[] IS NULL
          OR cardinality(embedding) != embedding_dimensions)
    `);
    const totalMissing = Number(countResult.rows[0].total);
    console.log(`[backfill] Found ${totalMissing} memories needing embeddings`);

    if (totalMissing === 0) {
      console.log('[backfill] Nothing to backfill');
      return;
    }

    while (true) {
      batchNumber++;
      const client = await pool.connect();
      let batch;

      try {
        await client.query('BEGIN');

        // Fetch a batch of memories needing embeddings, lock them to prevent concurrent processing
        const result = await client.query(`
          SELECT tenant_id, id, content
          FROM studio_memories
          WHERE status = 'active'
            AND (embedding IS NULL
              OR embedding_provider IS NULL
              OR embedding_model IS NULL
              OR embedding_version IS NULL
              OR embedding_dimensions IS NULL
              OR embedding::double precision[] IS NULL
              OR cardinality(embedding) != embedding_dimensions)
          ORDER BY updated_at ASC, id ASC
          LIMIT $1
          FOR UPDATE SKIP LOCKED
        `, [BATCH_SIZE]);

        batch = result.rows;

        if (batch.length === 0) {
          await client.query('ROLLBACK');
          break;
        }

        // Extract embeddings for the batch
        const texts = batch.map((row) => row.content);
        let embeddings;
        try {
          embeddings = await fetchEmbeddings(config, texts);
        } catch (error) {
          await client.query('ROLLBACK');
          console.error(`[backfill] Batch ${batchNumber}: embedding API failed: ${error.message}`);
          totalFailed += batch.length;
          // If the API is consistently failing, stop rather than spinning
          if (totalFailed > totalMissing * 0.5) {
            console.error(`[backfill] Too many failures (${totalFailed}/${totalMissing}), stopping`);
            break;
          }
          await delay(DELAY_MS * 5);
          continue;
        }

        // Update each memory with its embedding
        let batchBackfilled = 0;
        let batchSkipped = 0;
        for (let i = 0; i < batch.length; i++) {
          const { tenant_id, id } = batch[i];
          const embedding = embeddings[i];

          try {
            const updateResult = await client.query(`
              UPDATE studio_memories
              SET embedding = $3::double precision[],
                  embedding_provider = $4,
                  embedding_model = $5,
                  embedding_dimensions = $6,
                  embedding_version = $7,
                  updated_at = now()
              WHERE tenant_id = $1 AND id = $2
                AND (embedding IS NULL
                  OR embedding_provider IS NULL
                  OR embedding_model IS NULL
                  OR embedding_version IS NULL
                  OR embedding_dimensions IS NULL
                  OR embedding::double precision[] IS NULL
                  OR cardinality(embedding) != embedding_dimensions)
            `, [tenant_id, id, embedding, config.provider, config.model, config.dimensions, config.version]);

            if (updateResult.rowCount > 0) {
              batchBackfilled++;
            } else {
              batchSkipped++;
            }
          } catch (error) {
            console.error(`[backfill] Batch ${batchNumber}: failed to update ${tenant_id}/${id}: ${error.message}`);
            batchSkipped++;
          }
        }

        await client.query('COMMIT');
        totalBackfilled += batchBackfilled;
        totalSkipped += batchSkipped;
        const progress = Math.round(((totalBackfilled + totalSkipped) / totalMissing) * 100);
        console.log(`[backfill] Batch ${batchNumber}: ${batchBackfilled} backfilled, ${batchSkipped} skipped (${progress}% complete)`);

      } catch (error) {
        try { await client.query('ROLLBACK'); } catch { /* ignore */ }
        throw error;
      } finally {
        client.release();
      }

      // Delay between batches to avoid overwhelming the embedding API
      if (batch.length === BATCH_SIZE) {
        await delay(DELAY_MS);
      }
    }
  } finally {
    await pool.end();
  }

  console.log(`[backfill] Complete: ${totalBackfilled} backfilled, ${totalSkipped} skipped, ${totalFailed} failed`);
}

main().catch((error) => {
  console.error(`[backfill] Fatal error: ${error.message}`);
  process.exit(1);
});
