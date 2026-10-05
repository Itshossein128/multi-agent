#!/usr/bin/env node
/**
 * Phase 8 offline memory evaluation runner.
 *
 * Executes the fixed deterministic scenarios against isolated in-memory stores
 * (never production data) and prints a metrics report. Always writes the
 * machine-readable and human-readable reports to the repository root;
 * --baseline adds a no-memory comparison run; --memory selects the
 * memory-type ablation.
 *
 * Usage:
 *   ts-node --transpile-only scripts/memory/memoryEval.ts
 *   ts-node --transpile-only scripts/memory/memoryEval.ts -- --json
 *   ts-node --transpile-only scripts/memory/memoryEval.ts -- --baseline
 *   ts-node --transpile-only scripts/memory/memoryEval.ts -- --memory=semantic
 *   ts-node --transpile-only scripts/memory/memoryEval.ts -- --scenario=semantic-pnpm
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runMemoryEvaluation, reportToJson, reportToMarkdown, type MemoryAblationMode } from "../../src/memory/evaluation/memoryEvalRunner";

const REPORT_JSON_FILENAME = "MEMORY_EVALUATION_REPORT.json";
const REPORT_MD_FILENAME = "MEMORY_EVALUATION_REPORT.md";

interface CliOptions {
  json: boolean;
  baseline: boolean;
  memory: MemoryAblationMode;
  scenario?: string;
}

function parseOptions(argv: string[]): CliOptions {
  const options: CliOptions = { json: false, baseline: false, memory: "all" };
  for (const arg of argv) {
    // pnpm passes a literal `--` separator through to the script; ignore it.
    if (arg === "--") continue;
    if (arg === "--json") options.json = true;
    else if (arg === "--baseline") options.baseline = true;
    else if (arg.startsWith("--memory=")) {
      const value = arg.slice("--memory=".length);
      if (!["all", "semantic", "episodic", "procedural", "none"].includes(value)) {
        console.error(`Unknown ablation mode: ${value}. Use all|semantic|episodic|procedural|none.`);
        process.exit(2);
      }
      options.memory = value as MemoryAblationMode;
    } else if (arg.startsWith("--scenario=")) options.scenario = arg.slice("--scenario=".length);
    else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return options;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const report = await runMemoryEvaluation({ ablation: options.memory, baseline: options.baseline, scenarioFilter: options.scenario });
  if (options.json) console.log(reportToJson(report));
  else console.log(reportToMarkdown(report));

  // Persist both report formats (Step 68/69): JSON for tooling, MD for humans.
  const outDir = resolve(process.cwd());
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, REPORT_JSON_FILENAME), `${reportToJson(report)}\n`, "utf8");
  writeFileSync(resolve(outDir, REPORT_MD_FILENAME), `${reportToMarkdown(report)}\n`, "utf8");
  console.error(`[memory:eval] Reports written: ${REPORT_JSON_FILENAME}, ${REPORT_MD_FILENAME}`);

  process.exit(report.passed ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(`[memory:eval] Fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
