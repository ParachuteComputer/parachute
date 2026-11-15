// An applet's code: the content of its one note. The note's extension says what kind it is:
//   html        a page, run as written
//   tsx / jsx   one module whose default export is a React component. The app turns it into plain JavaScript once (with
//               sucrase, bundled in the app, so it works offline), caches that against the code's hash, and runs it in
//               the same sealed frame, with React and the kit (`parachute`) provided as imports.
// The code's hash is what "allowed" and "changed since" are judged on: of the content as written, and for TSX/JSX of its
// kind too, so the same bytes run another way (an extension changed, nothing else) ask again (`codeHash`).

import { sha256Hex } from "./needs.ts";
import { inlineScript } from "./srcdoc.ts";

export const CODE_KINDS = ["html", "tsx", "jsx"] as const;
export type CodeKind = (typeof CODE_KINDS)[number];

/** A note's extension, plain: lower case, no dot ("md" when the note has none). */
export const extensionOf = (n: { extension?: string | null }) => String(n.extension ?? "md").replace(/^\./, "").toLowerCase();

/** The kind of code a note holds, from its extension; null for anything an applet can't be. */
export function codeKindOf(n: { extension?: string | null }): CodeKind | null {
  const e = extensionOf(n);
  return (CODE_KINDS as readonly string[]).includes(e) ? (e as CodeKind) : null;
}

/** A path that names applet code by its suffix (`x.html`, `x.tsx`…): no applet may write one. */
export const CODE_PATH = /\.(html?|tsx|jsx)$/i;
/** A note that is code: by its extension, or a path that ends like code. */
export const isCodeExtension = (n: { path?: string | null; extension?: string | null }) => codeKindOf(n) !== null || CODE_PATH.test(n.path ?? "");

/** What the imports of a TSX/JSX applet may name. Anything else stops it with a plain message. */
export const PROVIDED_IMPORTS = ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "parachute"] as const;

/** Bumped when the transpiler or its options change (a test holds it to the installed sucrase): a cached result from another version is never used. */
export const TRANSPILER = "sucrase-3.35.1/2";

/**
 * The hash a grant holds for an applet's code. HTML: the SHA-256 of its content, bare hex (as before TSX, so earlier
 * grants hold). TSX/JSX: `tsx:<hex>` / `jsx:<hex>`. The kind is on the output, where no content can reach it, so a note
 * whose extension changes is new code whatever its content, and the transpile cache, keyed on this, never serves one
 * kind's output for the other.
 */
export const codeHash = async (kind: CodeKind, source: string): Promise<string> => (kind === "html" ? "" : `${kind}:`) + await sha256Hex(source);

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
/** At most this much transpiled code is kept on the device (in characters), and none of one module bigger than a quarter of it. */
const KEEP_CHARS = 1_000_000;
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
      // the newest few stay on the device, within a size; an older one is transpiled again if it is ever opened
      const all = Object.entries({ ...read(), [hash]: c }).filter(([, v]) => v?.t === TRANSPILER && typeof v.js === "string" && v.js.length <= KEEP_CHARS / 4).sort((a, b) => (b[1]?.at ?? 0) - (a[1]?.at ?? 0));
      let size = 0;
      const kept = Object.fromEntries(all.slice(0, KEEP).filter(([, v]) => (size += v.js.length) <= KEEP_CHARS));
      try { storage?.setItem(COMPILED_KEY, JSON.stringify(kept)); } catch { try { storage?.setItem(COMPILED_KEY, "{}"); } catch { /* this session only */ } }
    },
  };
}
export type CompileCache = ReturnType<typeof createCompileCache>;
let device: CompileCache | null = null;
export const deviceCompileCache = () => (device ??= createCompileCache());

/** The code hash, and for TSX/JSX the runnable JavaScript (from the cache, or transpiled now and cached). */
export async function prepare(source: string, kind: CodeKind, cache: CompileCache = deviceCompileCache()): Promise<{ hash: string; compiled: Compiled | null }> {
  const hash = await codeHash(kind, source);
  if (kind === "html") return { hash, compiled: null };
  const hit = cache.get(hash);
  if (hit !== null) return { hash, compiled: { ok: true, js: hit } };
  const c = await transpile(source, kind);
  if (c.ok) cache.put(hash, c.js);
  return { hash, compiled: c };
}

// ── what runs in the frame ──

/**
 * Two scripts before the module, kept free of backticks and `${`. The first only sets up how a failure shows (one line
 * in the frame), so even a module the browser can't parse says why. The second is the loader: a `require` that serves
 * only the provided imports, then the module (an async function, so it may `await` at its top), then its default
 * export rendered into #root.
 */
const FAILURE = String.raw`(function () {
  window.__parachuteFail = function (e) { var root = document.getElementById("root"); if (!root) return; root.textContent = ""; var p = document.createElement("p"); p.className = "parachute-error"; p.textContent = "This applet stopped: " + (e && e.message ? e.message : String(e)); root.appendChild(p); };
  addEventListener("error", function (e) { var root = document.getElementById("root"); if (root && !root.firstChild) window.__parachuteFail(e.error || e.message); });
})();`;
const LOADER_HEAD = String.raw`(function () {
  var root = document.getElementById("root"), fail = window.__parachuteFail;
  var M = window.__ParachuteModules || {};
  var mods = { react: M.react, "react-dom": M["react-dom"], "react-dom/client": M["react-dom/client"], "react/jsx-runtime": M["react/jsx-runtime"], parachute: window.parachute };
  function require(name) {
    if (Object.prototype.hasOwnProperty.call(mods, name) && mods[name]) return mods[name];
    throw new Error("it imports " + name + ", and an applet can import only " + Object.keys(mods).join(", "));
  }
  var module = { exports: {} };
  (async function (require, module, exports) {
`;
const LOADER_TAIL = String.raw`
  })(require, module, module.exports).then(function () {
    var C = module.exports && module.exports.default;
    // a function component, or what memo, forwardRef or lazy return
    if (typeof C !== "function" && !(C && typeof C === "object" && C.$$typeof)) throw new Error("its module has no default export to show (export default function App() …)");
    M["react-dom/client"].createRoot(root).render(M.react.createElement(C));
  }).catch(fail);
})();`;

/** The page a TSX/JSX applet runs as: a root, React, then its module. `reactSource` sets `window.__ParachuteModules`. */
export function modulePage(js: string, reactSource: string): string {
  return `<div id="root"></div>${inlineScript(FAILURE)}${inlineScript(reactSource)}${inlineScript(`${LOADER_HEAD}${js}${LOADER_TAIL}`)}`;
}
