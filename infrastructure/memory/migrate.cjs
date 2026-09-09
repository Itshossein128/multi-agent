#!/usr/bin/env node
require('ts-node/register');
const { Pool } = require('pg');
const { runMemoryMigrations } = require('../../src/memory/infrastructure/migrate');
const { resolve } = require('node:path');
async function main() {
  if (!process.env.MEMORY_DATABASE_URL) throw new Error('MEMORY_DATABASE_URL must point to the isolated Studio database');
  const pool = new Pool({ connectionString: process.env.MEMORY_DATABASE_URL });
  try {
    const applied = await runMemoryMigrations(pool, { vectorEnabled: process.argv.includes('--vector'), directory: resolve(__dirname, 'migrations') });
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Memory migrations already current');
  } finally { await pool.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
