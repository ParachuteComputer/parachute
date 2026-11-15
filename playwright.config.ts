import { defineConfig, devices } from "@playwright/test";

// E2E_PORT: another port for the web build, so two runs can share a machine
const PORT = process.env.E2E_PORT ?? "4173";

// Against the web build (vite preview) and a real hub started by e2e/hub.ts.
export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/hub.ts",
  globalTeardown: "./e2e/teardown.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/, use: { ...devices["Pixel 7"], browserName: "chromium" } },
    { name: "phone", dependencies: ["setup"], testIgnore: [/vault\.spec\.ts/, /rotates\.spec\.ts/], use: { ...devices["Pixel 7"], browserName: "chromium", storageState: "e2e/.hub-session.json" } },
    // signing in again or refreshing retires the sign-in the tests above share (after a minute or so), so these run last
    { name: "signs-in", dependencies: ["phone"], testMatch: [/vault\.spec\.ts/, /rotates\.spec\.ts/], use: { ...devices["Pixel 7"], browserName: "chromium", storageState: "e2e/.hub-session.json" } },
  ],
  webServer: { command: `npm run build && npx vite preview --port ${PORT} --strictPort`, url: `http://localhost:${PORT}`, reuseExistingServer: !process.env.CI, timeout: 120_000 },
});
