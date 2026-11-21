// theme module: the app's look (src/theme), as tokens: every colour, font and density value, also set as CSS variables
// `--<key>` in the frame by the kit. Pushed as a `theme` event on load and each time the look changes (the person's
// theme record, or the device's light/dark). The fonts are stacks by name: the app's own faces (Literata, Instrument
// Sans) are in the frame from its start as data: URLs (theme/fonts.ts; its CSP allows only `font-src data:`).

import type { UniModule } from "../router.ts";
import type { Tokens } from "../../theme/theme.ts";

export function createThemeModule(deps: { theme(): Tokens | Record<string, string> }): UniModule {
  return { namespace: "theme", methods: { get: { cap: null, validate: () => ({ ok: true, value: {} }), run: async () => deps.theme() } } };
}
