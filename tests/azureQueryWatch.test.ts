import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const execute = promisify(execFile);

test("query watcher baselines existing items and retries an ambiguous delivery with the same key and body", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "azure-watch-"));
  let ids = [9];
  const deliveries: Array<{ key: string; body: string; valid: boolean }> = [];
  const server = createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url?.includes("/wiql/")) {
      response.end(JSON.stringify({ queryType: "flat", workItems: ids.map((id) => ({ id })) }));
      return;
    }
    if (request.url?.includes("/workitems/")) {
      response.end(JSON.stringify({ id: 10, rev: 1, fields: { "System.Title": "New bug", "System.Description": "Details ".repeat(1000) } }));
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString();
    const timestamp = request.headers["x-webhook-timestamp"];
    const expected = crypto.createHmac("sha256", "test-signing-secret").update(`${timestamp}.${body}`).digest("hex");
    deliveries.push({ key: String(request.headers["idempotency-key"]), body,
      valid: request.headers["x-webhook-signature"] === `sha256=${expected}` });
    // Simulate acceptance followed by a lost/failed acknowledgement.
    response.statusCode = deliveries.length === 1 ? 503 : 409;
    response.end(JSON.stringify({ error: deliveries.length === 1 ? "Unavailable" : "Duplicate delivery or replay detected" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address() as { port: number };
    const base = `http://127.0.0.1:${address.port}`;
    const statePath = path.join(directory, "state.json");
    const config = path.join(directory, "config.json");
    await writeFile(config, JSON.stringify({ azureProjectUrl: base, queryId: "query", webhookUrl: `${base}/hook`,
      projectId: "project", workspaceId: "workspace", statePath }));
    const once = () => execute(process.execPath, [path.resolve("scripts/azure-query-watch.cjs"), config, "--once"], {
      env: { ...process.env, AZURE_PAT: "test-pat", WEBHOOK_SECRET: "test-signing-secret" }, timeout: 10000, windowsHide: true,
    });
    await once();
    expect(deliveries).toHaveLength(0);
    ids = [9, 10];
    await expect(once()).rejects.toThrow();
    expect(JSON.parse(await readFile(statePath, "utf8")).pending).toHaveLength(1);
    await once();
    await once();
    expect(deliveries).toHaveLength(2);
    expect(deliveries[0].valid && deliveries[1].valid).toBe(true);
    expect(deliveries[1].key).toBe(deliveries[0].key);
    expect(deliveries[1].body).toBe(deliveries[0].body);
    expect(JSON.parse(deliveries[0].body).task).toMatchObject({ projectId: "project", workspaceId: "workspace" });
    expect(JSON.parse(deliveries[0].body).task.description.length).toBeLessThanOrEqual(2000);
    expect(JSON.parse(deliveries[0].body).workItem.fields["System.Description"]).toHaveLength(8000);
    expect(JSON.parse(await readFile(statePath, "utf8")).pending).toHaveLength(0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);
