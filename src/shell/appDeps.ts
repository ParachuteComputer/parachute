// The shell's answers to an applet's `app` calls (applet/modules/app.ts), from what the shell holds.
import type { Note } from "@openparachute/surface-client";
import type { AppDeps, RecentNote } from "../applet/modules/app";
import { isCodeExtension } from "../applet/code";
import { markTap } from "../open/mark";
import { clientFor } from "../vault/client";
import { noteHref, titleOf } from "../vault/notes";
import { listVaults } from "../vault/store";
import { barNow } from "./homeSettings";

/** Notes that are the app's own or an applet's code: never in a list of what the person wrote lately. */
const own = (n: Note) => isCodeExtension(n as { extension?: string }) || (n.tags ?? []).some((t) => t === "applet" || t.startsWith("applet/") || t.startsWith("parachute"))
  || /^\.parachute\//i.test(n.path ?? "");

/** A tap in the applet now: live user activation in the shell's window, with the focus in an applet's frame. */
const tappingInApplet = () => (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive === true
  && document.activeElement instanceof HTMLIFrameElement && document.activeElement.classList.contains("applet-frame");

export function appDeps(go: (href: string) => void): AppDeps {
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
  };
}
