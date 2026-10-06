import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests. By default they start ORIVEXY NIGHTS (`scripts/e2e-server.sh`)
 * on port 3100 against an isolated, freshly recreated database (app_e2e)
 * with only base data + a few fixtures; tests create everything else through
 * the real UI and API. Run `npm run build` first.
 * Set E2E_BASE_URL to run against an already running instance instead.
 */
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${process.env.E2E_PORT ?? 3100}`;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    locale: "es-ES",
    timezoneId: "Europe/Madrid",
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : undefined,
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"], browserName: "chromium" }, testMatch: /guest|responsive/ },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: "bash scripts/e2e-server.sh", url: `${baseURL}/api/health`, reuseExistingServer: false, timeout: 180_000, stdout: "ignore", stderr: "pipe" },
});
