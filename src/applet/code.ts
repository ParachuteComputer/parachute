// An applet's code: the content of its one note. The note's extension says what kind it is:
//   html        a page, run as written
//   tsx / jsx   one module whose default export is a React component. The app turns it into plain JavaScript once (with
//               sucrase, bundled in the app, so it works offline), caches that against the code's hash, and runs it in
//               the same sealed frame, with React and the kit (`parachute`) provided as imports.
// The code's hash (of the note's content, as written) is what "allowed" and "changed since" are judged on, for every kind.

import { sha256Hex } from "./needs.ts";

export const CODE_KINDS = ["html", "tsx", "jsx"] as const;
export type CodeKind = (typeof CODE_KINDS)[number];

/** A note's extension, plain: lower case, no dot ("md" when the note has none). */
export const extensionOf = (n: { extension?: string | null }) => String(n.extension ?? "md").replace(/^\./, "").toLowerCase();

/** The kind of code a note holds, from its extension; null for anything an applet can't be. */
export function codeKindOf(n: { extension?: string | null }): CodeKind | null {
  const e = extensionOf(n);
  return e === "htm" ? "html" : (CODE_KINDS as readonly string[]).includes(e) ? (e as CodeKind) : null;
}

/** A path that names applet code by its suffix (`x.html`, `x.tsx`…): no applet may write one. */
export const CODE_PATH = /\.(html?|tsx|jsx)$/i;
/** A note that is code: by its extension, or a path that ends like code. */
export const isCodeExtension = (n: { path?: string | null; extension?: string | null }) => codeKindOf(n) !== null || CODE_PATH.test(n.path ?? "");

/** What the imports of a TSX/JSX applet may name. Anything else stops it with a plain message. */
export const PROVIDED_IMPORTS = ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "parachute"] as const;

/** Bumped when the transpiler or its options change: a cached result from another version is never used. */
export const TRANSPILER = "sucrase-3.35.1/1";

export type Compiled = { ok: true; js: string } | { ok: false; error: string };

/** Turn one TSX or JSX module into CommonJS that the frame's loader runs. Pure but for the lazy import of sucrase. */
export async function transpile(source: string, kind: "tsx" | "jsx"): Promise<Compiled> {
  const { transform } = await import("sucrase");
  try {
    const out = transform(source, {
      transforms: kind === "tsx" ? ["typescript", "jsx", "imports"] : ["jsx", "imports"],
      jsxRuntime: "automatic",
      production: true,
      disableESTransforms: true,
    });
    return { ok: true, js: out.code };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.split("\n")[0] : "it couldn't be read" };
  }
}

// ── the cache: one transpile per code hash ──

export const COMPILED_KEY = "parachute.applets.compiled.v1";
const KEEP = 24;
type StorageLike = Pick<Storage, "getItem" | "setItem">;
type Cached = { t: string; js: string; at: number };

export function createCompileCache(storage: StorageLike | null = typeof localStorage === "undefined" ? null : localStorage) {
  const memory = new Map<string, Cached>();
  const read = (): Record<string, Cached> => {
    try { const v: unknown = JSON.parse(storage?.getItem(COMPILED_KEY) ?? "{}"); return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, Cached>) : {}; } catch { return {}; }
  };
  return {
    get(hash: string): string | null {
      const hit = memory.get(hash) ?? read()[hash];
      return hit && hit.t === TRANSPILER && typeof hit.js === "string" ? hit.js : null;
    },
    put(hash: string, js: string) {
      const c: Cached = { t: TRANSPILER, js, at: Date.now() };
      memory.set(hash, c);
      // the newest few stay on the device; an older one is transpiled again if it is ever opened
      const all = { ...read(), [hash]: c };
      const kept = Object.fromEntries(Object.entries(all).sort((a, b) => (b[1]?.at ?? 0) - (a[1]?.at ?? 0)).slice(0, KEEP));
      try { storage?.setItem(COMPILED_KEY, JSON.stringify(kept)); } catch { /* this session only */ }
    },
  };
}
export type CompileCache = ReturnType<typeof createCompileCache>;
let device: CompileCache | null = null;
export const deviceCompileCache = () => (device ??= createCompileCache());

/** The code hash, and for TSX/JSX the runnable JavaScript (from the cache, or transpiled now and cached). */
export async function prepare(source: string, kind: CodeKind, cache: CompileCache = deviceCompileCache()): Promise<{ hash: string; compiled: Compiled | null }> {
  const hash = await sha256Hex(source);
  if (kind === "html") return { hash, compiled: null };
  const hit = cache.get(hash);
  if (hit !== null) return { hash, compiled: { ok: true, js: hit } };
  const c = await transpile(source, kind);
  if (c.ok) cache.put(hash, c.js);
  return { hash, compiled: c };
}

// ── what runs in the frame ──

/** Keep a script body from closing its own tag or opening an HTML comment. */
const inlineScript = (code: string) => `<script>${code.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--")}</script>`;

/**
 * The loader for a transpiled module: a `require` that serves only the provided imports, then the module, then its
 * default export rendered into #root. An error shows as one line in the frame. Kept free of backticks and `${`.
 */
const LOADER_HEAD = String.raw`(function () {
  var root = document.getElementById("root");
  function fail(e) { root.textContent = ""; var p = document.createElement("p"); p.className = "parachute-error"; p.textContent = "This applet stopped: " + (e && e.message ? e.message : String(e)); root.appendChild(p); }
  var M = window.__ParachuteModules || {};
  var mods = { react: M.react, "react-dom": M["react-dom"], "react-dom/client": M["react-dom/client"], "react/jsx-runtime": M["react/jsx-runtime"], parachute: window.parachute };
  function require(name) {
    if (Object.prototype.hasOwnProperty.call(mods, name) && mods[name]) return mods[name];
    throw new Error("it imports " + name + ", and an applet can import only " + Object.keys(mods).join(", "));
  }
  var module = { exports: {} };
  try {
    (function (require, module, exports) {
`;
const LOADER_TAIL = String.raw`
    })(require, module, module.exports);
    var C = module.exports && module.exports.default;
    if (typeof C !== "function") throw new Error("its module has no default export to show (export default function App() …)");
    M["react-dom/client"].createRoot(root).render(M.react.createElement(C));
  } catch (e) { fail(e); }
  addEventListener("error", function (e) { if (!root.firstChild) fail(e.error || e.message); });
})();`;

/** The page a TSX/JSX applet runs as: a root, React, then its module. `reactSource` sets `window.__ParachuteModules`. */
export function modulePage(js: string, reactSource: string): string {
  return `<div id="root"></div>${inlineScript(reactSource)}${inlineScript(`${LOADER_HEAD}${js}${LOADER_TAIL}`)}`;
}
