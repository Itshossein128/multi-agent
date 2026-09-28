#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  memoryBenchmarkReportToJson,
  memoryBenchmarkReportToMarkdown,
  runMemoryBenchmark,
} from "../../src/memory/benchmark/memoryBenchmarkRunner";
import {
  runLiveEmbeddingEvaluation,
  liveEmbeddingReportToMarkdown,
} from "../../src/memory/benchmark/memoryLiveEmbeddingRunner";
import type { MemoryBenchmarkMode } from "../../src/memory/benchmark/memoryBenchmarkFixtures";

const JSON_REPORT = "MEMORY_BENCHMARK_REPORT.json";
const MARKDOWN_REPORT = "MEMORY_BENCHMARK_REPORT.md";
const LIVE_JSON_REPORT = "LIVE_EMBEDDING_REPORT.json";
const LIVE_MARKDOWN_REPORT = "LIVE_EMBEDDING_REPORT.md";
const MODES: MemoryBenchmarkMode[] = ["no-memory", "semantic-only", "semantic-episodic", "full"];

interface CliOptions {
  json: boolean;
  live: boolean;
  liveEmbedding: boolean;
  runAblations: boolean;
  provider?: string;
  model?: string;
  scenario?: string;
  mode?: MemoryBenchmarkMode;
}

export function parseMemoryBenchmarkOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    json: false,
    live: false,
    liveEmbedding: process.env.MEMORY_LIVE_EMBEDDING_EVAL === "1",
    runAblations: false,
  };
  for (const argument of argv) {
    if (argument === "--") continue;
    if (argument === "--json") options.json = true;
    else if (argument === "--live") options.live = true;
    else if (argument === "--live-embedding") options.liveEmbedding = true;
    else if (argument === "--run-ablations") options.runAblations = true;
    else if (argument.startsWith("--provider=")) options.provider = argument.slice("--provider=".length);
    else if (argument.startsWith("--model=")) options.model = argument.slice("--model=".length);
    else if (argument.startsWith("--scenario=")) options.scenario = argument.slice("--scenario=".length);
    else if (argument.startsWith("--mode=")) {
      const mode = argument.slice("--mode=".length) as MemoryBenchmarkMode;
      if (!MODES.includes(mode)) throw new Error(`Unknown mode: ${mode}. Use ${MODES.join("|")}.`);
      options.mode = mode;
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseMemoryBenchmarkOptions(process.argv.slice(2));
  const outputDirectory = resolve(process.cwd());
  mkdirSync(outputDirectory, { recursive: true });

  // 1. Run standard deterministic memory benchmark
  const report = await runMemoryBenchmark({
    scenarioFilter: options.scenario,
    modeFilter: options.mode,
    live: options.live,
  });
  const json = memoryBenchmarkReportToJson(report);
  const markdown = memoryBenchmarkReportToMarkdown(report);
  if (!options.liveEmbedding) {
    console.log(options.json ? json : markdown);
  }
  writeFileSync(resolve(outputDirectory, JSON_REPORT), `${json}\n`, "utf8");
  writeFileSync(resolve(outputDirectory, MARKDOWN_REPORT), `${markdown}\n`, "utf8");
  console.error(`[memory:benchmark] Reports written: ${JSON_REPORT}, ${MARKDOWN_REPORT}`);

  // 2. If live embedding evaluation requested, run through PostgreSQL + pgvector
  if (options.liveEmbedding) {
    console.error("[memory:benchmark] Running live embedding evaluation with real PostgreSQL + pgvector...");
    const liveReport = await runLiveEmbeddingEvaluation({
      provider: options.provider,
      model: options.model,
      runAblations: options.runAblations,
    });
    const liveJson = JSON.stringify(liveReport, null, 2);
    const liveMarkdown = liveEmbeddingReportToMarkdown(liveReport);

    console.log(options.json ? liveJson : liveMarkdown);
    writeFileSync(resolve(outputDirectory, LIVE_JSON_REPORT), `${liveJson}\n`, "utf8");
    writeFileSync(resolve(outputDirectory, LIVE_MARKDOWN_REPORT), `${liveMarkdown}\n`, "utf8");
    console.error(`[memory:benchmark] Live reports written: ${LIVE_JSON_REPORT}, ${LIVE_MARKDOWN_REPORT}`);

    if (liveReport.status !== "completed") {
      process.exitCode = 1;
      return;
    }
  }

  process.exitCode = report.passed ? 0 : 1;
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(`[memory:benchmark] Fatal: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
