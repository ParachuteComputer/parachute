// What stands in for a hash-locked page policy where the app is served on the web (shell/hostedPolicy.ts): the page's
// `script-src` keeps 'unsafe-inline' because applet frames need it, so nothing the page itself draws may ever be HTML
// from a vault or a hub, and no frame may share the page's origin. Both are held here, over the source as written:
// a change that adds an HTML sink or loosens a frame's sandbox fails, and is then argued for on purpose.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : []; });
}
const SRC = files("src").map((p) => ({ p, text: readFileSync(p, "utf8") }));
/** The code without its comments' words (a comment may name what is forbidden). */
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("the page draws no HTML and seals every frame", () => {
  it("has files to read", () => { expect(SRC.length).toBeGreaterThan(100); });
  it("no HTML sink anywhere in the app's own code", () => {
    const sink = /dangerouslySetInnerHTML|\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write(?:ln)?\s*\(|createContextualFragment|\bsrcdoc\s*=\s*[^{"']/;
    // (the self-test's probe is a hostile applet written as strings: its code runs inside a sealed frame, never in the page)
    const INSIDE_A_FRAME = ["src/applet/selftest/probe.ts"];
    expect(SRC.filter((f) => !INSIDE_A_FRAME.includes(f.p) && sink.test(code(f.text))).map((f) => f.p)).toEqual([]);
  });
  it("every frame is sandboxed to scripts alone: an opaque origin, never the page's", () => {
    const frames = SRC.flatMap((f) => [...code(f.text).matchAll(/<iframe\b[^>]*>/g)].map((m) => ({ p: f.p, tag: m[0] })));
    expect(frames.length).toBeGreaterThan(2);
    for (const f of frames) expect(f.tag, f.p).toMatch(/\bsandbox="allow-scripts"/);
    expect(SRC.filter((f) => /allow-same-origin|allow-top-navigation|allow-popups|allow-forms/.test(code(f.text))).map((f) => f.p)).toEqual([]);
  });
});

describe("public/sw.js", () => {
  it("takes the older hosted app's service worker out, and keeps nothing itself", () => {
    const sw = readFileSync("public/sw.js", "utf8");
    expect(sw).toContain("self.registration.unregister()");
    expect(sw).toContain("self.caches.delete(");
    expect(sw).toContain("self.skipWaiting()");
    expect(sw).not.toMatch(/addEventListener\(\s*["']fetch["']|importScripts|caches\.open|precache/);
  });
});
