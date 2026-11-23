// A React project of many files made into one applet record (docs/WRITE-AN-APPLET.md "A project of many files"): its
// entry and everything it imports from its own files and from npm, bundled by esbuild into one ES module of plain JS
// (JSX already compiled to react/jsx-runtime calls). What the frame gives an applet stays an import, for the frame to
// give, by its exact name: react, react-dom, react-dom/client, react/jsx-runtime, parachute, and component:<id>. Any
// other path into those (react-dom/server) is refused, as the frame would. CSS and other files don't come along: an
// applet draws with the kit and its theme's CSS variables. Node only (scripts/bundle-applet.ts).
import { existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { PROVIDED_IMPORTS } from "./code.ts";
import { IMPORT_PREFIX } from "./imports.ts";

export type BundleResult = { ok: true; code: string; imports: string[]; warnings: string[] } | { ok: false; errors: string[] };

const NOT_CODE = /\.(css|scss|sass|less|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|mp3|mp4|wav)$/i;
/** The frame's packages: only their exact names (PROVIDED_IMPORTS) are given. */
const FRAME_PACKAGE = /^(react|react-dom|parachute)(\/|$)/;

/** The folder a project's paths are written from: the nearest with a package.json above the entry, else the entry's.
 *  So the same project bundles to the same code wherever it is run from (a changed hash asks the person again). */
function projectDir(entry: string): string {
  for (let d = dirname(entry); ; d = dirname(d)) {
    if (existsSync(join(d, "package.json"))) return d;
    if (dirname(d) === d) return dirname(entry);
  }
}

export async function bundleApplet(entry: string, o: { minify?: boolean } = {}): Promise<BundleResult> {
  const esbuild = await import("esbuild");
  const cwd = projectDir(entry);
  const said = (importer: string) => relative(cwd, importer) || importer;
  try {
    const r = await esbuild.build({
      entryPoints: [entry],
      absWorkingDir: cwd,
      bundle: true,
      write: false,
      metafile: true,
      format: "esm",
      platform: "browser",
      // the frame runs a module inside an async function: it may await at its top level
      target: "es2022",
      jsx: "automatic",
      // packages built for production, whether minified or not (the same code, the same hash)
      define: { "process.env.NODE_ENV": '"production"' },
      minify: !!o.minify,
      // one module: a dynamic import of its own files is folded in, not split into a second file
      splitting: false,
      legalComments: "none",
      logLevel: "silent",
      plugins: [{
        name: "frame",
        setup(b) {
          b.onResolve({ filter: /.*/ }, (a) => {
            if (a.path.startsWith(IMPORT_PREFIX) || (PROVIDED_IMPORTS as readonly string[]).includes(a.path)) return { path: a.path, external: true };
            if (FRAME_PACKAGE.test(a.path)) return { errors: [{ text: `${a.path} (imported by ${said(a.importer)}) isn't one the frame gives: an applet may import only ${PROVIDED_IMPORTS.join(", ")} and component:<id>.` }] };
            return undefined;
          });
          // a file that isn't code (a stylesheet, a picture, a font), however it was reached: said, not dropped
          b.onLoad({ filter: NOT_CODE }, (a) => ({ errors: [{ text: `${relative(cwd, a.path)} can't come along: an applet is one file of code. Style it with the kit's parts and its theme's CSS variables (--accent, --line, …), and keep pictures as files in the vault.` }] }));
        },
      }],
    });
    const out = r.outputFiles?.[0]?.text;
    if (!out) return { ok: false, errors: ["esbuild made no file"] };
    // what it imports from outside, each said once at the top: the frame reads a module's imports from its source
    // (imports.ts), and an npm package's code ahead of the entry's own import lines could hide one from it
    const imports = [...new Set(Object.values(r.metafile.outputs).flatMap((x) => x.imports.filter((i) => i.external).map((i) => i.path)))].sort();
    const head = imports.map((i) => `import ${JSON.stringify(i)};`).join("\n");
    return { ok: true, code: head ? `${head}\n${out}` : out, imports, warnings: r.warnings.map((w) => w.text) };
  } catch (e) {
    const errors = (e as { errors?: { text: string; location?: { file: string; line: number } | null }[] }).errors;
    return { ok: false, errors: errors?.length ? errors.map((x) => (x.location ? `${x.location.file}:${x.location.line}: ${x.text}` : x.text)) : [String(e)] };
  }
}
