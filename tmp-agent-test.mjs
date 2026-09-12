import { createHmac, randomUUID } from "node:crypto";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: "apps/server/.env" });

const secret = process.env.INTERNAL_PRINCIPAL_SECRET;
const pool = new pg.Pool({ connectionString: process.env.MEMORY_DATABASE_URL });
const { rows } = await pool.query("SELECT record FROM studio_agents WHERE id = $1", [
  "agent-mty46eeg-33cca0",
]);
const agent = rows[0].record;
console.log("backend", agent.backend);

const principal = { userId: agent.ownerId, tenantId: agent.tenantId };
const body = Buffer.from(
  JSON.stringify({ ...principal, exp: Date.now() + 60_000, nonce: randomUUID() })
).toString("base64url");
const assertion = `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;

const res = await fetch("http://localhost:4000/runs/agent-test", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Multi-Agent-Principal": assertion,
  },
  body: JSON.stringify({ agent, input: { prompt: "Reply with just the word ok" } }),
});
const created = await res.json();
console.log("create", created);

for (let i = 0; i < 90; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const run = await (
    await fetch(`http://localhost:4000/runs/${created.runId}`, {
      headers: { "X-Multi-Agent-Principal": assertion },
    })
  ).json();
  if (run.status !== "running" && run.status !== "queued") {
    console.log("status", run.status);
    console.log((run.error || "").slice(0, 1000));
    console.log("output", JSON.stringify(run.output)?.slice(0, 500));
    break;
  }
  if (i % 10 === 0) console.log("waiting", run.status);
}

await pool.end();
