// app module: what an applet may ask of the app beyond its own vault, only for the words its note's `metadata.app`
// names (app.ts), which the person allowed on its card. All three are the shell's answers; nothing here reads a token.
//   app.recent({limit?})   the newest notes across the vaults this device holds: titles, where, when (never content)
//   app.pins()             what is on the bar: the home applet and the pins, by name, glyph and address
//   app.open({href})       go to a note or an applet in the app, during a tap only (and a tap there starts it as any tap does)
import { ContractError, ERROR_CODES, hasOnly, plain } from "../contract.ts";
import type { UniModule } from "../router.ts";
import type { AppWord } from "../app.ts";

export type RecentNote = { vault: string; vaultName: string; id: string; title: string; path: string; updatedAt: string | null; href: string };
export type BarPlace = { name: string; glyph: string; href: string; home: boolean };
export type AppDeps = {
  /** The newest `limit` notes in each vault this device holds, newest first; `charge` counts the vault reads. */
  recent(limit: number, charge: (n: number) => void): Promise<RecentNote[]>;
  pins(): BarPlace[];
  /** Go there if the person is tapping in this applet now (and the address is one of the app's): whether it went. */
  open(href: string): boolean;
};

export const RECENT_MAX = 40;
/** The app's addresses an applet may send the person to: the launcher, a vault, a note, an applet. */
export const APP_HREF = /^\/(?:v\/[^/?#]+(?:\/[na]\/[^/?#]+)?)?$/;

export function createAppModule(allowed: readonly AppWord[], deps: AppDeps): UniModule {
  const need = (w: AppWord) => { if (!allowed.includes(w)) throw new ContractError(ERROR_CODES.notGranted); };
  return {
    namespace: "app",
    methods: {
      recent: {
        cap: null,
        validate: (p) => {
          if (!plain(p) || !hasOnly(p, ["limit"])) return { ok: false };
          const limit = p.limit === undefined ? 20 : p.limit;
          return Number.isInteger(limit) && (limit as number) > 0 && (limit as number) <= RECENT_MAX ? { ok: true, value: limit as number } : { ok: false };
        },
        run: async (limit: number, _s, ctx) => { need("recent"); return (await deps.recent(limit, (n) => ctx.charge(n))).slice(0, limit); },
      },
      pins: { cap: null, validate: (p) => (plain(p) && hasOnly(p, []) ? { ok: true, value: null } : { ok: false }), run: async () => { need("pins"); return deps.pins(); } },
      open: {
        cap: null,
        validate: (p) => (plain(p) && hasOnly(p, ["href"]) && typeof p.href === "string" && p.href.length <= 600 && APP_HREF.test(p.href) ? { ok: true, value: p.href } : { ok: false }),
        run: async (href: string) => { need("open"); return deps.open(href); },
      },
    },
  };
}
