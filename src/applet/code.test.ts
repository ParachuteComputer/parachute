import { describe, expect, it } from "vitest";
import { codeHash, codeKindOf, COMPILED_KEY, createCompileCache, isCodeExtension, modulePage, prepare, transpile, TRANSPILER } from "./code";
import { inlineScript } from "./srcdoc";
import { sha256Hex } from "./needs";
import { runDecision } from "./selftest/gate";

class Mem { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, v); } }

describe("an applet's code kind comes from its note's extension", () => {
  it.each([["html", "html"], [".HTML", "html"], ["htm", null], ["tsx", "tsx"], ["jsx", "jsx"], ["md", null], [undefined, null], ["ts", null], ["js", null]])("%s → %s", (ext, kind) => {
    expect(codeKindOf({ extension: ext as string | undefined })).toBe(kind);
  });
  it("a path ending like code counts as code, whatever its extension", () => {
    expect(isCodeExtension({ path: "Notes/x.tsx", extension: "md" })).toBe(true);
    expect(isCodeExtension({ path: "Notes/x", extension: "md" })).toBe(false);
  });
});

describe("transpile", () => {
  it("turns TSX into CommonJS that imports React's JSX runtime and drops the types", async () => {
    const c = await transpile(`import { useState } from "react";\ntype P = { n: number };\nexport default function App({ n }: P) { const [x] = useState<number>(n); return <p className="a">{x}</p>; }`, "tsx");
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.js).toContain('require("react/jsx-runtime")');
    expect(c.js).toMatch(/require\(['"]react['"]\)/);
    expect(c.js).toContain("exports.default = App");
    expect(c.js).not.toMatch(/type P|: P\b|<number>/);
  });
  it("reads JSX too", async () => {
    const c = await transpile(`export default () => <b>hi</b>;`, "jsx");
    expect(c.ok && c.js).toContain("_jsxruntime.jsx");
  });
  it("says why code doesn't compile, in one line", async () => {
    const c = await transpile(`export default function App() { return <p>; }`, "tsx");
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.error).not.toContain("\n");
  });
});

describe("prepare: one transpile per code hash", () => {
  it("caches against the hash and reuses it", async () => {
    const mem = new Mem();
    const cache = createCompileCache(mem);
    const src = "export default () => <i>x</i>;";
    const a = await prepare(src, "jsx", cache);
    expect(a.compiled?.ok).toBe(true);
    const stored = JSON.parse(mem.getItem(COMPILED_KEY)!);
    expect(Object.keys(stored)).toEqual([a.hash]);
    // a second cache over the same storage (a later launch) finds it without transpiling
    stored[a.hash].js = "/* from the cache */";
    mem.setItem(COMPILED_KEY, JSON.stringify(stored));
    const b = await prepare(src, "jsx", createCompileCache(mem));
    expect(b.compiled).toEqual({ ok: true, js: "/* from the cache */" });
  });
  it("never uses what another transpiler version made", async () => {
    const mem = new Mem();
    const src = "export default () => <i>y</i>;";
    const first = await prepare(src, "jsx", createCompileCache(mem));
    const stored = JSON.parse(mem.getItem(COMPILED_KEY)!);
    stored[first.hash] = { t: "older", js: "/* stale */", at: 1 };
    mem.setItem(COMPILED_KEY, JSON.stringify(stored));
    const again = await prepare(src, "jsx", createCompileCache(mem));
    expect(again.compiled?.ok && again.compiled.js).not.toContain("stale");
    expect(TRANSPILER).toMatch(/^sucrase-/);
  });
  it("an HTML applet's hash is of its content, and nothing is transpiled", async () => {
    const p = await prepare("<p>hi</p>", "html", createCompileCache(new Mem()));
    expect(p.compiled).toBeNull();
    expect(p.hash).toMatch(/^[0-9a-f]{64}$/);
  });
  it("code that doesn't compile is not cached", async () => {
    const mem = new Mem();
    const p = await prepare("export default (", "tsx", createCompileCache(mem));
    expect(p.compiled?.ok).toBe(false);
    expect(mem.getItem(COMPILED_KEY)).toBeNull();
  });
});

describe("the code's hash", () => {
  it("is of the kind and the content for TSX/JSX, so the same bytes run another way ask again", async () => {
    const src = "export default () => <i>z</i>;";
    const hashes = await Promise.all([codeHash("html", src), codeHash("tsx", src), codeHash("jsx", src)]);
    expect(new Set(hashes).size).toBe(3);
    // an HTML applet's hash is what it was before TSX: grants made then still hold
    expect(hashes[0]).toBe(await sha256Hex(src));
  });
  it("keys the transpile cache, so one kind's output is never served for the other", async () => {
    const cache = createCompileCache(new Mem());
    const src = 'import _ from "lodash";\nexport default () => <i>w</i>;';
    const tsx = await prepare(src, "tsx", cache), jsx = await prepare(src, "jsx", cache);
    expect(tsx.hash).not.toBe(jsx.hash);
    // sucrase drops an import only types use in TSX, and keeps it in JSX
    expect(jsx.compiled?.ok && jsx.compiled.js).toContain("lodash");
  });
});

describe("the module page", () => {
  it("keeps the module's own </script> from closing the loader", () => {
    const page = modulePage('const s = "</script><script>alert(1)</script>";', "/* react */");
    expect(page.match(/<\/script>/g)).toHaveLength(3);
  });
  it("escapes </script> and <!-- without changing what the code means", () => {
    const code = 'globalThis.__out = ["</script>", "<!--", /<!--/u.test("a<!--b"), `</SCRIPT>`];';
    const body = inlineScript(code).replace(/^<script>/, "").replace(/<\/script>$/, "");
    expect(body).not.toMatch(/<\/script|<!--/i);
    new Function(body)();
    expect((globalThis as { __out?: unknown }).__out).toEqual(["</script>", "<!--", true, "</SCRIPT>"]);
  });
});

describe("changed code shows the card again, in both modes", () => {
  it.each([
    ["sealed", "updated", "sealed", "ask-updated"],
    ["approved-code", "updated", "approved-code", "ask-updated"],
    ["sealed", "ok", "sealed", "run"],
    ["approved-code", "ok", "approved-code", "run"],
    ["approved-code", "ok", "sealed", "ask-updated"],
    ["sealed", "none", null, "ask"],
    ["closed", "ok", "sealed", "closed"],
  ] as const)("%s, %s (granted under %s) → %s", (mode, status, under, out) => {
    expect(runDecision(mode, status, under)).toBe(out);
  });
});
