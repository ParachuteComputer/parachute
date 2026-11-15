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
    { name: "setup", testMatch: /auth\.setup\.ts/, use: { ...devices["Pixel 7"], browserName: "chromium" } },
    { name: "phone", dependencies: ["setup"], use: { ...devices["Pixel 7"], browserName: "chromium", storageState: "e2e/.hub-session.json" } },
  ],
  webServer: { command: "npm run build && npm run preview", url: "http://localhost:4173", reuseExistingServer: !process.env.CI, timeout: 120_000 },
});
