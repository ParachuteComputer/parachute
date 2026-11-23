// A React project of many files made into one applet record (docs/WRITE-AN-APPLET.md "A project of many files"): its
// entry and everything it imports from its own files and from npm, bundled by esbuild into one ES module of plain JS
// (JSX already compiled to react/jsx-runtime calls). What the frame gives an applet stays an import, for the frame to
// give: react, react-dom, react-dom/client, react/jsx-runtime, parachute, and component:<id>. CSS and other files don't
// come along: an applet draws with the kit and its theme's CSS variables. Node only (scripts/bundle-applet.ts).
import { PROVIDED_IMPORTS } from "./code.ts";

export type BundleResult = { ok: true; code: string; warnings: string[] } | { ok: false; errors: string[] };

/** The frame's own modules, and a component from a vault: imports the bundle leaves for the frame. */
export const FRAME_IMPORTS: readonly string[] = [...PROVIDED_IMPORTS, "component:*"];

export async function bundleApplet(entry: string, o: { minify?: boolean } = {}): Promise<BundleResult> {
  const esbuild = await import("esbuild");
  try {
    const r = await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      target: "es2020",
      jsx: "automatic",
      external: [...FRAME_IMPORTS],
      minify: !!o.minify,
      // one module: a dynamic import of its own files is folded in, not split into a second file
      splitting: false,
      legalComments: "none",
      logLevel: "silent",
      // a file that isn't code (a stylesheet, a picture) has no place to go: said, not dropped
      plugins: [{
        name: "not-code",
        setup(b) {
          b.onResolve({ filter: /\.(css|scss|sass|less|svg|png|jpe?g|gif|webp|woff2?|ttf)$/i }, (a) => ({ errors: [{ text: `${a.path} (imported by ${a.importer.replace(process.cwd() + "/", "")}) can't come along: an applet is one file of code. Style it with the kit's parts and its theme's CSS variables (--accent, --line, …), and keep pictures as files in the vault.` }] }));
        },
      }],
    });
    const out = r.outputFiles?.[0]?.text;
    if (!out) return { ok: false, errors: ["esbuild made no file"] };
    return { ok: true, code: out, warnings: r.warnings.map((w) => w.text) };
  } catch (e) {
    const errors = (e as { errors?: { text: string; location?: { file: string; line: number } | null }[] }).errors;
    return { ok: false, errors: errors?.length ? errors.map((x) => (x.location ? `${x.location.file}:${x.location.line}: ${x.text}` : x.text)) : [String(e)] };
  }
}
