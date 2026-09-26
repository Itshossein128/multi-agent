#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  memoryBenchmarkReportToJson,
  memoryBenchmarkReportToMarkdown,
  runMemoryBenchmark,
} from "../../src/memory/benchmark/memoryBenchmarkRunner";
import type { MemoryBenchmarkMode } from "../../src/memory/benchmark/memoryBenchmarkFixtures";

const JSON_REPORT = "MEMORY_BENCHMARK_REPORT.json";
const MARKDOWN_REPORT = "MEMORY_BENCHMARK_REPORT.md";
const MODES: MemoryBenchmarkMode[] = ["no-memory", "semantic-only", "semantic-episodic", "full"];

interface CliOptions {
  json: boolean;
  live: boolean;
  scenario?: string;
  mode?: MemoryBenchmarkMode;
}

export function parseMemoryBenchmarkOptions(argv: string[]): CliOptions {
  const options: CliOptions = { json: false, live: false };
  for (const argument of argv) {
    if (argument === "--") continue;
    if (argument === "--json") options.json = true;
    else if (argument === "--live") options.live = true;
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
  const report = await runMemoryBenchmark({
    scenarioFilter: options.scenario,
    modeFilter: options.mode,
    live: options.live,
  });
  const json = memoryBenchmarkReportToJson(report);
  const markdown = memoryBenchmarkReportToMarkdown(report);
  console.log(options.json ? json : markdown);
  const outputDirectory = resolve(process.cwd());
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(resolve(outputDirectory, JSON_REPORT), `${json}\n`, "utf8");
  writeFileSync(resolve(outputDirectory, MARKDOWN_REPORT), `${markdown}\n`, "utf8");
  console.error(`[memory:benchmark] Reports written: ${JSON_REPORT}, ${MARKDOWN_REPORT}`);
  process.exitCode = report.passed ? 0 : 1;
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(`[memory:benchmark] Fatal: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
