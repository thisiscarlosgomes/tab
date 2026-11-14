import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "plans.spec.ts",
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  outputDir: "../../../.test-artifacts/plans",
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3107",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev:plans:browser",
    cwd: "../../..",
    url: "http://127.0.0.1:3107",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
