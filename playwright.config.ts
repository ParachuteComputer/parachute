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
    { name: "phone", dependencies: ["setup"], testIgnore: [/webkit\.spec\.ts/, /vault\.spec\.ts/, /changes\.spec\.ts/, /grants\.spec\.ts/, /onelist\.spec\.ts/, /sharing\.spec\.ts/, /rotates\.spec\.ts/, /simple\.spec\.ts/, /scopes\.spec\.ts/, /firstrun\.spec\.ts/, /settings\.spec\.ts/, /packs\.spec\.ts/, /notion\.spec\.ts/, /start\.spec\.ts/, /plainwords\.spec\.ts/], use: { ...devices["Pixel 7"], browserName: "chromium", storageState: "e2e/.hub-session.json" } },
    // signing in again or refreshing retires the sign-in the tests above share (after a minute or so), so these run last
    { name: "signs-in", dependencies: ["phone"], testMatch: [/vault\.spec\.ts/, /changes\.spec\.ts/, /grants\.spec\.ts/, /onelist\.spec\.ts/, /sharing\.spec\.ts/, /rotates\.spec\.ts/, /simple\.spec\.ts/, /scopes\.spec\.ts/, /firstrun\.spec\.ts/, /settings\.spec\.ts/, /start\.spec\.ts/], use: { ...devices["Pixel 7"], browserName: "chromium", storageState: "e2e/.hub-session.json" } },
    // last: a 403 there makes the app refresh its sign-in, which rotates the saved session the specs before share
    { name: "packs", dependencies: ["signs-in"], testMatch: [/packs\.spec\.ts/, /notion\.spec\.ts/], use: { ...devices["Pixel 7"], browserName: "chromium", storageState: "e2e/.hub-session.json" } },
    // last of all, for the same reason (the walk of every screen reaches what an older hub refuses: Sharing, Changes), on a
    // sign-in of its own: the one the specs before it shared is retired by now
    { name: "plain-setup", dependencies: ["packs"], testMatch: /auth\.setup\.ts/, use: { ...devices["Pixel 7"], browserName: "chromium" } },
    { name: "plain", dependencies: ["plain-setup"], testMatch: [/plainwords\.spec\.ts/], use: { ...devices["Pixel 7"], browserName: "chromium", storageState: "e2e/.hub-session.json" } },
    // the same build in WebKit (the Mac app's WKWebView, Safari) at a Mac's width: the applet frame (e2e/webkit.spec.ts).
    // Last, on a sign-in of its own, so nothing before it waits on it. PW_WEBKIT_WS: a Playwright server to run WebKit in
    // (on a machine whose own libraries Playwright's WebKit can't use)
    { name: "webkit-setup", dependencies: ["plain"], testMatch: /auth\.setup\.ts/, use: { ...devices["Pixel 7"], browserName: "chromium" } },
    { name: "webkit", dependencies: ["webkit-setup"], testMatch: [/webkit\.spec\.ts/], use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 }, storageState: "e2e/.hub-session.json",
      ...(process.env.PW_WEBKIT_WS ? { connectOptions: { wsEndpoint: process.env.PW_WEBKIT_WS } } : {}) } },
  ],
  // VITE_E2E_SIGNER: the test signer for the services tests (src/services/e2eNative.ts); only this build has it
  webServer: { command: `VITE_E2E_SIGNER=1 npm run build && npx vite preview --port ${PORT} --strictPort`, url: `http://localhost:${PORT}`, reuseExistingServer: !process.env.CI, timeout: 120_000 },
});
