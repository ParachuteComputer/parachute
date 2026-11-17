// page module: how a page with embeds is laid out (docs/design/EMBED.md). The frame reports its content height and,
// for a host, where each embed's slot starts; nothing else. The shell clamps both and decides the rest (a slot's width,
// an embed's height). Asked by the kit itself, not by applet code, but an applet could call it too: it is only ever
// a size, and the shell takes a few a second at most.
//   page.layout({height, slots: [{name, top}]})
import { hasOnly, plain } from "../contract.ts";
import type { UniModule } from "../router.ts";

export type Layout = { height: number; slots: { name: string; top: number }[] };
export const MAX_PAGE_HEIGHT = 20_000;
export const MAX_SLOTS = 8;
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Layouts taken per second; more are dropped (the last one waits for the next). */
export const LAYOUTS_PER_SECOND = 8;

export function parseLayout(p: unknown): Layout | null {
  if (!plain(p) || !hasOnly(p, ["height", "slots"]) || typeof p.height !== "number" || !Number.isFinite(p.height)) return null;
  const slots: Layout["slots"] = [];
  if (p.slots !== undefined) {
    if (!Array.isArray(p.slots) || p.slots.length > MAX_SLOTS) return null;
    for (const s of p.slots) {
      if (!plain(s) || !hasOnly(s, ["name", "top"]) || typeof s.name !== "string" || s.name.length > 40 || !NAME.test(s.name) || typeof s.top !== "number" || !Number.isFinite(s.top)) return null;
      if (!slots.some((x) => x.name === s.name)) slots.push({ name: s.name, top: Math.max(0, Math.min(MAX_PAGE_HEIGHT, Math.round(s.top))) });
    }
  }
  return { height: Math.max(0, Math.min(MAX_PAGE_HEIGHT, Math.round(p.height))), slots };
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
