import { Pool } from "pg";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";

const pool = new Pool({
  connectionString:
    process.env.MEMORY_DATABASE_URL ??
    "postgresql://studio_memory:studio_memory_local@127.0.0.1:55432/studio_memory",
});

const email = `verify-${Date.now()}@example.com`;
const hash = await bcrypt.hash("password123", 12);

await pool.query(
  `INSERT INTO studio_users (id, email, password_hash, display_name, tenant_id, status)
   VALUES ($1, $2, $3, $4, $5, 'active')`,
  [randomUUID(), email, hash, "Verify User", randomUUID()]
);

const { rows } = await pool.query(
  "SELECT email, status FROM studio_users WHERE email = $1",
  [email]
);
console.log("OK", rows[0]);

await pool.query("DELETE FROM studio_users WHERE email = $1", [email]);
await pool.end();
