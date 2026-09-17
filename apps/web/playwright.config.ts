import { defineConfig, devices } from "@playwright/test";

const externalBaseUrl = process.env.E2E_BASE_URL;
const e2ePort = process.env.E2E_PORT ?? "3100";
const e2eBaseUrl = externalBaseUrl ?? `http://127.0.0.1:${e2ePort}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: e2eBaseUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome" } }],
  webServer: [
    {
      command: "pnpm --dir ../.. --filter server dev",
      url: "http://localhost:4000/health",
      reuseExistingServer: true,
      timeout: 120_000,
    },
    ...(externalBaseUrl ? [] : [{
      command: `pnpm exec next dev --hostname 127.0.0.1 --port ${e2ePort}`,
      url: `${e2eBaseUrl}/login`,
      reuseExistingServer: true,
      timeout: 120_000,
    }]),
  ],
});
