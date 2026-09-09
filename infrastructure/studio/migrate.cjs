#!/usr/bin/env node
require("ts-node/register");
const { Pool } = require("pg");
const { runStudioMigrations } = require("../../src/studio/infrastructure/migrate");
const { resolve } = require("node:path");
async function main() {
  const url = process.env.MEMORY_DATABASE_URL ?? process.env.STUDIO_DATABASE_URL;
  if (!url) throw new Error("MEMORY_DATABASE_URL (or STUDIO_DATABASE_URL) must point to the isolated Studio database");
  const pool = new Pool({ connectionString: url });
  try {
    const applied = await runStudioMigrations(pool, { directory: resolve(__dirname, "migrations") });
    console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Studio migrations already current");
  } finally {
    await pool.end();
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
