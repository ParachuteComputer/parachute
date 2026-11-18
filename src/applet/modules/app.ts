// app module: what an applet may ask of the app beyond its own vault, only for the words its note's `metadata.app`
// names (app.ts), which the person allowed on its card (a word it didn't ask for is not_granted, before anything else).
// All are the shell's answers; nothing here reads a token. The last four are docs/design/KEYRING.md's "Voice, files,
// links, storage" (storage is its own module, storage.ts).
//   app.recent({limit?})   the newest notes across the vaults this device holds: titles, where, when (never content)
//   app.pins()             what is on the bar: the home applet and the pins, by name, glyph and address
//   app.open({href})       go to a note or an applet in the app, during a tap only (and a tap there starts it as any tap does)
//   app.openLink({url})    (links) an http, https or mailto address in the browser, during a tap, one a second: whether it went
//   app.save({name, bytes, type})   (save) a file into Downloads during a tap, its name made bare: {saved: name}
//   app.pick({accept?, multiple?})  (attach) the shell's own picker, during a tap: [{name, type, bytes}], [] when none
import { ContractError, ERROR_CODES, hasOnly, plain } from "../contract.ts";
import type { UniModule } from "../router.ts";
import type { AppWord } from "../app.ts";
import { bareName, FILE_MAX, LINK_GAP_MS, linkOk, mediaType, parseAccept, SAVE_GAP_MS } from "../files.ts";

/** A note as `recent` gives it: its title, its vault's name, when it changed, and where it opens. No folder, no content. */
export type RecentNote = { vaultName: string; title: string; updatedAt: string | null; href: string };
export type BarPlace = { name: string; glyph: string; href: string; home: boolean };
export type PickedFile = { name: string; type: string; bytes: ArrayBuffer };
export type AppDeps = {
  /** The newest `limit` notes in each vault this device holds, newest first; `charge` counts the vault reads. */
  recent(limit: number, charge: (n: number) => void): Promise<RecentNote[]>;
  pins(): BarPlace[];
  /** Go there if the person is tapping in this applet now (and the address is one of the app's): whether it went. */
  open(href: string): boolean;
  /** Open it in the browser if the person is tapping in this applet now: whether it went. */
  openLink(url: string): Promise<boolean>;
  /** Save it into Downloads (`name` already bare): the name it was saved as. Throws `notTapped()` without a tap. */
  save(name: string, bytes: ArrayBuffer, type: string): Promise<string>;
  /** The shell's own picker over the applet: what the person picked ([] for none). Throws `notTapped()` without a tap. */
  pick(accept: string[], multiple: boolean): Promise<PickedFile[]>;
};

/** What a call that needs the person's tap answers without one. */
export const notTapped = () => new ContractError(ERROR_CODES.failed, "it asks only while you tap in it");

export const RECENT_MAX = 40;
const SHAPE = /^\/(?:v\/[^/?#\\]+(?:\/[na]\/[^/?#\\]+)?)?$/;
/** The app's addresses an applet may send the person to: the launcher, a vault, a note, an applet; and only an address
 *  the browser reads back exactly as written (no backslash, dot segment, encoded dot or stripped character that it
 *  would turn into another address, such as the shell's own screens). */
export function appHref(href: string): boolean {
  if (!SHAPE.test(href) || /[\u0000-\u0020\u007f]/.test(href)) return false;
  try { return new URL(href, "http://app.invalid").pathname === href; } catch { return false; }
}

export function createAppModule(allowed: readonly AppWord[], deps: AppDeps, now: () => number = Date.now): UniModule {
  const need = (w: AppWord) => { if (!allowed.includes(w)) throw new ContractError(ERROR_CODES.notGranted); };
  let lastLink = -Infinity, lastSave = -Infinity;
  return {
    namespace: "app",
    methods: {
      recent: {
        cap: null,
        validate: (p) => {
          need("recent");
          if (!plain(p) || !hasOnly(p, ["limit"])) return { ok: false };
          const limit = p.limit === undefined ? 20 : p.limit;
          return Number.isInteger(limit) && (limit as number) > 0 && (limit as number) <= RECENT_MAX ? { ok: true, value: limit as number } : { ok: false };
        },
        run: async (limit: number, _s, ctx) => (await deps.recent(limit, (n) => ctx.charge(n))).slice(0, limit),
      },
      pins: { cap: null, validate: (p) => { need("pins"); return plain(p) && hasOnly(p, []) ? { ok: true, value: null } : { ok: false }; }, run: async () => deps.pins() },
      open: {
        cap: null,
        validate: (p) => { need("open"); return plain(p) && hasOnly(p, ["href"]) && typeof p.href === "string" && p.href.length <= 600 && appHref(p.href) ? { ok: true, value: p.href } : { ok: false }; },
        run: async (href: string) => deps.open(href),
      },
      openLink: {
        cap: null,
        validate: (p) => { need("links"); return plain(p) && hasOnly(p, ["url"]) && linkOk(p.url) ? { ok: true, value: p.url } : { ok: false }; },
        run: async (url: string) => {
          // one a second, counted from the last one that went; taken before it goes, so calls sent together count
          if (now() - lastLink < LINK_GAP_MS) return false;
          const was = lastLink, mine = now();
          lastLink = mine;
          // given back only if no later call has taken the second since
          const back = () => { if (lastLink === mine) lastLink = was; };
          const went = await deps.openLink(url).catch((e: unknown) => { back(); throw e; });
          if (!went) back();
          return went;
        },
      },
      save: {
        cap: null,
        validate: (p) => {
          need("save");
          if (!plain(p) || !hasOnly(p, ["name", "bytes", "type"]) || typeof p.name !== "string" || p.name.length > 1000) return { ok: false };
          const type = mediaType(p.type);
          return p.bytes instanceof ArrayBuffer && p.bytes.byteLength <= FILE_MAX && type ? { ok: true, value: { name: bareName(p.name), bytes: p.bytes, type } } : { ok: false };
        },
        run: async (v: { name: string; bytes: ArrayBuffer; type: string }) => {
          // one a second, as links: a tap can't fill Downloads
          if (now() - lastSave < SAVE_GAP_MS) throw new ContractError(ERROR_CODES.rateLimited, "one file a second");
          const was = lastSave, mine = now();
          lastSave = mine;
          try { return { saved: await deps.save(v.name, v.bytes, v.type) }; } catch (e) { if (lastSave === mine) lastSave = was; throw e; }
        },
      },
      pick: {
        cap: null,
        validate: (p) => {
          need("attach");
          if (!plain(p) || !hasOnly(p, ["accept", "multiple"]) || (p.multiple !== undefined && typeof p.multiple !== "boolean")) return { ok: false };
          const accept = parseAccept(p.accept);
          return accept ? { ok: true, value: { accept, multiple: p.multiple === true } } : { ok: false };
        },
        run: async (v: { accept: string[]; multiple: boolean }) => deps.pick(v.accept, v.multiple),
      },
    },
  };
}
