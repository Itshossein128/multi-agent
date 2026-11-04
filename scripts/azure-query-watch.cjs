const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

async function main() {
  const configPath = process.argv[2];
  if (!configPath) throw new Error("Usage: node scripts/azure-query-watch.cjs <config.json> [--once]");
  const config = JSON.parse(await fs.readFile(configPath, "utf8"));
  for (const key of ["azureProjectUrl", "queryId", "webhookUrl", "projectId", "workspaceId", "statePath"]) {
    if (typeof config[key] !== "string" || !config[key]) throw new Error(`Missing configuration: ${key}`);
  }
  if (!process.env.AZURE_PAT || !process.env.WEBHOOK_SECRET) throw new Error("AZURE_PAT and WEBHOOK_SECRET are required");
  for (const key of ["azureProjectUrl", "webhookUrl"]) {
    const url = new URL(config[key]);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error(`Invalid URL: ${key}`);
  }
  const statePath = path.resolve(config.statePath);
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  const lockPath = statePath + ".lock";
  try {
    const pid = Number(await fs.readFile(lockPath, "utf8"));
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Invalid watcher lock");
    try { process.kill(pid, 0); throw new Error("Query watcher is already running"); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
    await fs.unlink(lockPath);
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  await fs.writeFile(lockPath, String(process.pid), { flag: "wx" });
  let stopped = false;
  process.on("SIGINT", () => { stopped = true; });
  process.on("SIGTERM", () => { stopped = true; });
  const save = async (state) => {
    const temporary = statePath + ".tmp";
    await fs.writeFile(temporary, JSON.stringify(state, null, 2));
    await fs.rename(temporary, statePath);
  };
  const azure = async (suffix) => {
    const response = await fetch(`${config.azureProjectUrl.replace(/\/$/, "")}/_apis/wit/${suffix}`, {
      headers: { Authorization: `Basic ${Buffer.from(`:${process.env.AZURE_PAT}`).toString("base64")}` },
      signal: AbortSignal.timeout(30_000), redirect: "error",
    });
    if (!response.ok) throw new Error(`Azure DevOps returned HTTP ${response.status}`);
    return response.json();
  };
  let state;
  try { state = JSON.parse(await fs.readFile(statePath, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (state && (state.queryId !== config.queryId || state.webhookUrl !== config.webhookUrl)) {
    throw new Error("Watcher state belongs to another query or webhook");
  }
  if (state?.projectId && (state.projectId !== config.projectId || state.workspaceId !== config.workspaceId)) {
    throw new Error("Watcher state belongs to another project or workspace");
  }
  if (state) {
    state.projectId = config.projectId;
    state.workspaceId = config.workspaceId;
  }
  try {
    do {
      try {
        const query = await azure(`wiql/${encodeURIComponent(config.queryId)}?api-version=5.1`);
        if (query.queryType !== "flat" || !Array.isArray(query.workItems)) throw new Error("Expected a flat query result");
        const ids = query.workItems.map((item) => item.id);
        if (!ids.every(Number.isSafeInteger)) throw new Error("Invalid work item IDs");
        if (!state) {
          state = { queryId: config.queryId, webhookUrl: config.webhookUrl, projectId: config.projectId, workspaceId: config.workspaceId,
            members: ids, pending: [], lastPollAt: new Date().toISOString() };
          await save(state);
          console.log(JSON.stringify({ event: "baseline", count: ids.length }));
        } else {
          const previous = new Set(state.members);
          for (const id of ids.filter((id) => !previous.has(id))) {
            state.pending.push({ id, key: `azure-query-${id}-${crypto.randomUUID()}` });
          }
          state.members = ids;
          state.lastPollAt = new Date().toISOString();
          await save(state);
        }
        while (state.pending.length) {
          const item = state.pending[0];
          if (!item.body) {
            const workItem = await azure(`workitems/${item.id}?api-version=5.1`);
            const fields = workItem.fields ?? {};
            const title = `Azure Bug #${item.id}: ${fields["System.Title"] ?? "Untitled"}`;
            item.body = JSON.stringify({
              source: "azure-devops", queryId: config.queryId,
              workItem: { id: item.id, rev: workItem.rev, url: `${config.azureProjectUrl}/_workitems/edit/${item.id}`, fields },
              task: { projectId: config.projectId, workspaceId: config.workspaceId, title: title.slice(0, 200),
                description: `${title}\n${config.azureProjectUrl}/_workitems/edit/${item.id}\nFull bug fields are included in the workItem run input.`.slice(0, 2000) },
            });
            await save(state);
          }
          const timestamp = String(Math.floor(Date.now() / 1000));
          const signature = crypto.createHmac("sha256", process.env.WEBHOOK_SECRET).update(`${timestamp}.${item.body}`).digest("hex");
          const response = await fetch(config.webhookUrl, {
            method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000), body: item.body,
            headers: { "Content-Type": "application/json", "X-Webhook-Timestamp": timestamp,
              "X-Webhook-Signature": `sha256=${signature}`, "Idempotency-Key": item.key },
          });
          const result = await response.json();
          const duplicate = response.status === 409 && /duplicate|replay/i.test(result.error ?? "");
          if (response.status !== 202 && !duplicate) throw new Error(`Webhook returned HTTP ${response.status}`);
          state.pending.shift();
          await save(state);
          console.log(JSON.stringify({ event: "delivered", workItemId: item.id, duplicate }));
        }
      } catch (error) {
        console.error(JSON.stringify({ event: "poll_failed", message: error.message }));
        if (process.argv.includes("--once")) throw error;
      }
      if (process.argv.includes("--once") || stopped) break;
      await new Promise((resolve) => setTimeout(resolve, Math.max(5000, config.intervalMs ?? 30000)));
    } while (!stopped);
  } finally { await fs.unlink(lockPath); }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
