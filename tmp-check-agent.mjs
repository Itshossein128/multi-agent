import pg from "pg";

const pool = new pg.Pool({
  connectionString:
    process.env.MEMORY_DATABASE_URL ??
    "postgresql://studio_memory:studio_memory_local@127.0.0.1:55432/studio_memory",
});

const agentId = "agent-mty46eeg-33cca0";
const { rows } = await pool.query(
  "SELECT id, name, definition FROM studio_agents WHERE id = $1",
  [agentId]
);
console.log(JSON.stringify(rows[0] ?? null, null, 2));

const runs = await pool.query(
  `SELECT id, status, error, metadata, created_at
   FROM studio_runs
   ORDER BY created_at DESC
   LIMIT 8`
);
console.log("--- runs ---");
console.log(JSON.stringify(runs.rows, null, 2));
await pool.end();
