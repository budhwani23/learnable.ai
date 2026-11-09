import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against an isolated local stack:
 *   Postgres (Docker, :5434, in-memory) → Django API (:8020) → Vite frontend (:8082).
 * Generation tests call the real Gemini API with backend/.env's GOOGLE_API_KEY.
 *
 *   npx playwright test                 # everything except @slow
 *   npm run test:slow                   # explainer video + slide deck (minutes)
 */
const API_PORT = process.env.E2E_API_PORT || "8020";
const WEB_PORT = process.env.E2E_WEB_PORT || "8082";
export const API_URL = `http://localhost:${API_PORT}/api`;

export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  fullyParallel: false,
  workers: 2,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  // @slow tests (real video / slide generation) run only when selected with --grep @slow.
  grepInvert: process.argv.some((a) => a.includes("@slow")) ? undefined : /@slow/,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }], ["json", { outputFile: "reports/results.json" }]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node scripts/start-backend.mjs",
      url: `http://localhost:${API_PORT}/healthz`,
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: `npm --prefix ../frontend run dev -- --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: { VITE_API_URL: API_URL },
    },
  ],
});
