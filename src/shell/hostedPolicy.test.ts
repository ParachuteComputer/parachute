import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hostedCsp, hostedManifest } from "./hostedPolicy";
import { FRAME_DOC_CSP } from "./frameDoc";

const app = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).app.security.csp as Record<string, string>;

describe("the policy a web host sends with the app's page", () => {
  const csp = hostedCsp(app);
  const of = (name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `))?.slice(name.length + 1);
  it("is the app's own policy without the shell's sources", () => {
    expect(csp).not.toMatch(/tauri:|ipc|localhost|127\.0\.0\.1/);
    expect(of("default-src")).toBe("'self'");
    expect(of("connect-src")).toBe("'self' https: wss:");
    expect(of("img-src")).toBe(app["img-src"]);
  });
  it("lets applet frames run and nothing else be framed: inline script stays, frames are about: only", () => {
    // a srcdoc frame inherits the page's policy before its own narrows it: without 'unsafe-inline' no applet runs
    expect(of("script-src")).toBe("'self' 'unsafe-inline'");
    expect(FRAME_DOC_CSP).toContain("script-src 'unsafe-inline'");
    expect(of("frame-src")).toBe("about:");
    expect(csp).not.toMatch(/unsafe-eval|script-src[^;]*https?:/);
  });
  it("adds what only a header can say", () => {
    expect(of("frame-ancestors")).toBe("'none'");
    expect(of("base-uri")).toBe("'self'");
    expect(of("form-action")).toBe("'self'");
    expect(of("object-src")).toBe("'none'");
  });
  it("names the app's own screens, and never /vault (a host that keeps vaults there takes it)", () => {
    const m = hostedManifest(app);
    expect(m.contract).toBe(1);
    expect(m.spa).toContain("/oauth/callback");
    expect(m.spa).not.toContain("/vault");
    expect(m.csp).toBe(csp);
  });
});
