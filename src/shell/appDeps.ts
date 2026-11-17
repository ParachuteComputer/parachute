// The shell's answers to an applet's `app` calls (applet/modules/app.ts), from what the shell holds.
import type { Note } from "@openparachute/surface-client";
import { notTapped, type AppDeps, type PickedFile, type RecentNote } from "../applet/modules/app";
import { openLinkOut, saveFileOut } from "./device";
import { markTap } from "../open/mark";
import { clientFor } from "../vault/client";
import { isAppOwn, noteHref, titleOf } from "../vault/notes";
import { listVaults } from "../vault/store";
import { barNow } from "./homeSettings";

/** Notes that are the app's own or an applet's code: never in a list of what the person wrote lately. */
const own = (n: Note) => isAppOwn(n as Note & { extension?: string });

/** A tap in this applet now: live user activation in the shell's window, with the focus in this applet's own frame (not
 *  any frame: an embed's, or another applet's, docs/design/EMBED.md). */
export const tappingIn = (frame: () => HTMLIFrameElement | null) => (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive === true
  && !!frame() && document.activeElement === frame();

/** The shell's own picker sheet (views/DeviceSheets.tsx). */
export type Picker = { pick(accept: string[], multiple: boolean): Promise<PickedFile[]> };

export function appDeps(go: (href: string) => void, frame: () => HTMLIFrameElement | null, picker: Picker): AppDeps {
  const tappingInApplet = () => tappingIn(frame);
  return {
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
    pins() {
      const b = barNow();
      return [...(b.start ? [{ name: b.start.name, glyph: b.start.glyph, href: b.start.href, home: true }] : []), ...b.pins.map((p) => ({ name: p.name, glyph: p.glyph, href: p.href, home: false }))];
    },
    open(href) {
      if (!tappingInApplet()) return false;
      markTap(new URL(href, "http://app.invalid").pathname);
      go(href);
      return true;
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
