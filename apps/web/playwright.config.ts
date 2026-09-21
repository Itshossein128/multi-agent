import { defineConfig, devices } from "@playwright/test";

const externalBaseUrl = process.env.E2E_BASE_URL;
const e2ePort = process.env.E2E_PORT ?? "3100";
const e2eExecutionPort = process.env.E2E_EXECUTION_PORT ?? "4100";
const e2eBaseUrl = externalBaseUrl ?? `http://127.0.0.1:${e2ePort}`;
const e2eExecutionUrl = `http://127.0.0.1:${e2eExecutionPort}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3060",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome" } }],
  webServer: externalBaseUrl ? [] : [
    {
      command: `PORT=${e2eExecutionPort} pnpm --dir ../.. --filter server dev`,
      url: `${e2eExecutionUrl}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "pnpm dev",
      url: process.env.E2E_BASE_URL ?? "http://localhost:3060/login",
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
