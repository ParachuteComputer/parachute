// page module: how a page with embeds is laid out (docs/design/EMBED.md). A host page and each embed report their
// content height, and nothing else; the shell clamps it and decides the rest. Asked by the kit itself, not by applet
// code, but an applet could call it too: it is only ever a height, and the shell takes a few a second at most.
//   page.layout({height})
import { hasOnly, plain } from "../contract.ts";
import type { UniModule } from "../router.ts";

export type Layout = { height: number };
export const MAX_PAGE_HEIGHT = 20_000;
/** Layouts taken per second; more are dropped (the last one waits for the next). */
export const LAYOUTS_PER_SECOND = 8;

export function parseLayout(p: unknown): Layout | null {
  if (!plain(p) || !hasOnly(p, ["height"]) || typeof p.height !== "number" || !Number.isFinite(p.height)) return null;
  return { height: Math.max(0, Math.min(MAX_PAGE_HEIGHT, Math.round(p.height))) };
}

export function createPageModule(onLayout: (l: Layout) => void, now: () => number = Date.now): UniModule {
  let window: number[] = [];
  let waiting: Layout | null = null, timer: ReturnType<typeof setTimeout> | null = null;
  const take = (l: Layout) => {
    const t = now();
    window = window.filter((x) => t - x < 1000);
    if (window.length < LAYOUTS_PER_SECOND) { window.push(t); onLayout(l); return; }
    waiting = l;
    timer ??= setTimeout(() => { timer = null; const w = waiting; waiting = null; if (w) take(w); }, 1000 - (t - window[0]));
  };
  return {
    namespace: "page",
    methods: {
      layout: {
        cap: null,
        validate: (p) => { const l = parseLayout(p); return l ? { ok: true, value: l } : { ok: false }; },
        run: async (l: Layout) => { take(l); return null; },
      },
    },
  };
}
