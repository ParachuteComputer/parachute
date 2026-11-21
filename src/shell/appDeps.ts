// The shell's answers to an applet's `app` calls (applet/modules/app.ts), from what the shell holds.
import type { Note } from "@openparachute/surface-client";
import { notTapped, type AppDeps, type PickedFile, type RecentNote } from "../applet/modules/app";
import { openLinkOut, saveFileOut } from "./device";
import { markTap } from "../open/mark";
import { clientFor, keptClientFor } from "../vault/client";
import { isAppOwn, noteHref, titleOf } from "../vault/notes";
import { listVaults, type VaultRecord } from "../vault/store";
import { addressIn, resolveLink, type Found, type ResolveDeps } from "../links/resolve";
import { isAppletCode, type VaultNote } from "../applet/modules/vault";
import { barNow } from "./homeSettings";
import { countChanged, isSelf } from "../applet/changes";
import { vaultsDeps } from "./vaultsDeps";
import { ownKind } from "../applet/modules/vaults";
import { homeVault } from "./frameSource";
import { appletPath } from "../open/paths";
import { officialId } from "../applet/parachuteSource";

/** Notes that are the app's own or an applet's code: never in a list of what the person wrote lately. */
const own = (n: Note) => isAppOwn(n as Note & { extension?: string });

/** Its frame is on screen: in the page and drawn (a kept applet's, hidden, is not: shell/kept.tsx). */
export const onScreen = (f: HTMLIFrameElement) => f.isConnected && f.getClientRects().length > 0;

/** A tap in this applet now: live user activation in the shell's window, with the focus in this applet's own frame (not
 *  any frame: an embed's, or another applet's, docs/design/EMBED.md), and that frame on screen. */
export const tappingIn = (frame: () => HTMLIFrameElement | null) => {
  const f = frame();
  // on screen too: a kept applet, hidden (shell/kept.tsx), gets no tap however its frame came to hold the focus
  return (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive === true
    && !!f && onScreen(f) && document.activeElement === f;
};

/** The shell's own picker sheet (views/DeviceSheets.tsx). */
export type Picker = { pick(accept: string[], multiple: boolean): Promise<PickedFile[]> };

export const MISS_MS = 60_000;
/** Which notes are there, asked of their vaults once a session (a note that was there is taken to be there still). */
export function noteFinder(read: (rec: VaultRecord, idOrPath: string) => Promise<VaultNote | null>) {
  const seen = new Map<string, Promise<Found | null>>();
  // (an applet's link lookups are charged up front, the same for each link: app.links below)
  return (rec: VaultRecord, idOrPath: string, ok: (f: Found) => boolean = () => true): Promise<Found | null> => {
    const k = `${rec.key}\u0000${idOrPath}`;
    let p = seen.get(k);
    if (!p) {
      p = read(rec, idOrPath).then((n) => (n && typeof n.id === "string" ? { id: n.id, path: typeof n.path === "string" ? n.path : "", code: isAppletCode(n) } : null));
      // a failed read (the network, a refresh) is asked again next time; a note that isn't there, or one this lookup
      // doesn't take (the hub found it by a path or a title, or outside the folders it may read), after a minute, as a
      // miss: kept longer, a quick answer later would say it is there (Uni may cite a note a moment before the hub has it)
      const mine = p;
      p.then((f) => { if (f === null || !ok(f)) setTimeout(() => { if (seen.get(k) === mine) seen.delete(k); }, MISS_MS); }, () => { if (seen.get(k) === mine) seen.delete(k); });
      seen.set(k, p);
    }
    return p.then((f) => (f && ok(f) ? f : null));
  };
}

/** `here`: the applet's own vault (a wikilink's, and where `address` makes its addresses); `reads`: the folders it may
 *  read there (a wikilink is looked up only in them). */
export function appDeps(go: (href: string) => void, frame: () => HTMLIFrameElement | null, picker: Picker, here: () => VaultRecord | null = () => null, reads: readonly string[] = []): AppDeps {
  const tappingInApplet = () => tappingIn(frame);
  // where a link leads, from the copy kept of that read at once (vault/readCache.ts): the note's route judges it again
  const find = noteFinder((rec, idOrPath) => keptClientFor(rec).getNote(idOrPath).catch((e: unknown) => {
    // not there: the hub's 404; anything else is asked again later
    if ((e as { status?: unknown } | null)?.status === 404) return null;
    throw e;
  }) as Promise<VaultNote | null>);
  // a rule's path is a folder ending in / (manifest.ts), as the vault module checks it
  const mayRead = (path: string) => reads.some((f) => f.endsWith("/") && path.startsWith(f));
  const resolver = (): ResolveDeps => ({ vaults: listVaults, here, mayRead, find });
  return {
    async links(links, from, charge) {
      // the same for every link, read or not (a wikilink may take two): what it costs says nothing of what it names
      charge(links.length * 2);
      const deps = resolver();
      return Promise.all(links.map(async (l) => (await resolveLink(l, from, deps)).answer));
    },
    async follow(link, from, choose) {
      if (!tappingInApplet()) return false;
      const at = location.href;
      const r = await resolveLink(link, from, resolver());
      // a slow answer moves no one: the tap must still count (it wears off in seconds), with the applet still on screen
      // and the person still where they tapped
      if (r.answer === null || !tappingInApplet() || location.href !== at) return false;
      if (r.answer === "note") {
        markTap(r.href);
        go(choose ? `${r.href}?with=choose` : r.href);
      } else go(r.href);
      return true;
    },
    address(note) {
      const rec = here();
      return rec ? addressIn(rec, note) : null;
    },
    async recent(limit, charge) {
      const vaults = listVaults();
      charge(vaults.length);
      const lists = await Promise.all(vaults.map(async (rec) => {
        const rows = await clientFor(rec).queryNotes({ orderBy: "updated_at", sort: "desc", limit: limit + 10 }).catch(() => [] as Note[]);
        return rows.filter((n) => !own(n)).map((n): RecentNote => ({
          vaultName: rec.vault, title: titleOf(n), updatedAt: (n as { updatedAt?: string }).updatedAt ?? null, href: noteHref(rec.key, n.id),
        }));
      }));
      return lists.flat().sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")).slice(0, limit);
    },
    async changes(charge) {
      // the vault's own API, as Vault reads it (no sheet is ever asked: this only reads)
      const d = vaultsDeps({ confirm: async () => "no", emit: () => {}, back: () => "" });
      const vaults = listVaults().slice(0, 6);
      const since = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
      const per = await Promise.all(vaults.map(async (rec) => {
        const cid = d.self?.(rec.key) ?? null;
        const self = (via: string | null) => isSelf(cid, via);
        try { return { rec, ...(await countChanged({ get: (p) => d.request(rec.key, "GET", p), door: await d.door(rec.key), since, charge, self, own: ownKind })) }; }
        catch { return { rec, count: 0, names: new Map<string, string>(), more: false }; }
      }));
      // the writer who wrote last first: what just happened
      const names = new Map<string, string>();
      for (const p of per) for (const [n, at] of p.names) if ((names.get(n) ?? "") < at) names.set(n, at);
      const count = per.reduce((a, p) => a + p.count, 0);
      const top = [...per].sort((a, b) => b.count - a.count)[0];
      const home = homeVault();
      return { count, names: [...names].sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0)).map(([n]) => n), more: per.some((p) => p.more),
        href: count && top && home ? `${appletPath(home.key, officialId("vault"))}?vault=${encodeURIComponent(top.rec.key)}&show=changes` : null };
    },
    pins() {
      const b = barNow();
      return b.pins.map((p) => ({ name: p.name, glyph: p.glyph, href: p.href, home: !!b.start && b.start.href === p.href }));
    },
    open(href) {
      if (!tappingInApplet()) return false;
      markTap(new URL(href, "http://app.invalid").pathname);
      go(href);
      return true;
    },
    async copy(text) {
      if (!tappingInApplet() || !navigator.clipboard) return false;
      return navigator.clipboard.writeText(text).then(() => true, () => false);
    },
    async openLink(url) {
      if (!tappingInApplet()) return false;
      await openLinkOut(url);
      return true;
    },
    async save(name, bytes, type) {
      if (!tappingInApplet()) throw notTapped();
      return saveFileOut(name, bytes, type);
    },
    pick(accept, multiple) {
      if (!tappingInApplet()) return Promise.reject(notTapped());
      return picker.pick(accept, multiple);
    },
  };
}
