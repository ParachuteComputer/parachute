import { defineConfig, devices } from "@playwright/test";

// Against the web build (vite preview) and a real hub started by e2e/hub.ts.
export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/hub.ts",
  globalTeardown: "./e2e/teardown.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: "http://localhost:4173", trace: "retain-on-failure" },
  projects: [
    { name: "phone", use: { ...devices["Pixel 7"], browserName: "chromium" } },
  ],
  webServer: { command: "npm run build && npm run preview", url: "http://localhost:4173", reuseExistingServer: !process.env.CI, timeout: 120_000 },
});
