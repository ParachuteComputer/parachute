// The page mark (docs/design/EMBED.md, "Code that hangs"): frames share the app's process, so code that loops forever
// freezes the app. While a page reads or runs its embeds (or code it imports from elsewhere), the device keeps a mark
// naming it; leaving the page, `pagehide`, and the app going out of sight clear it, and the app coming back sets it
// again. A start that finds a mark left over (the app stopped while that page ran) holds that page's embeds unread,
// stopped, until the person runs them again. The same idea as the frame record's mark (shell/frameSource.ts), under
// its own key.

export const PAGE_MARK_KEY = "parachute.pagemark.v1";
/** The pages a start found marked: held until the person runs them again, however many starts that takes. */
export const PAGE_SUSPECT_KEY = "parachute.pagemark.suspect.v1";
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const storage = (): StorageLike | null => (typeof localStorage === "undefined" ? null : localStorage);

export function createPageMarks(s: StorageLike | null = storage()) {
  // what a mark left from before this start named joins the held pages, kept until the person runs each again
  let suspects: string[] = [];
  try {
    const v: unknown = JSON.parse(s?.getItem(PAGE_SUSPECT_KEY) ?? "[]");
    suspects = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 50) : [];
    const left = s?.getItem(PAGE_MARK_KEY) ?? null;
    if (left && !suspects.includes(left)) suspects.push(left);
    s?.setItem(PAGE_SUSPECT_KEY, JSON.stringify(suspects));
    s?.removeItem(PAGE_MARK_KEY);
  } catch { /* nothing kept */ }
  const running = new Map<string, number>();
  const write = () => { try { const first = running.keys().next(); if (first.done) s?.removeItem(PAGE_MARK_KEY); else s?.setItem(PAGE_MARK_KEY, first.value); } catch { /* nothing kept */ } };
  return {
    /** The app stopped while this page ran its embeds. */
    suspect: (page: string) => suspects.includes(page),
    /** The person chose to run it again. */
    clear: (page: string) => { suspects = suspects.filter((p) => p !== page); try { s?.setItem(PAGE_SUSPECT_KEY, JSON.stringify(suspects)); } catch { /* this session only */ } },
    /** A page starts reading or running what it embeds: until the returned function is called. */
    hold(page: string): () => void {
      running.set(page, (running.get(page) ?? 0) + 1);
      write();
      let done = false;
      return () => { if (done) return; done = true; const n = (running.get(page) ?? 1) - 1; if (n > 0) running.set(page, n); else running.delete(page); write(); };
    },
    /** The app out of sight (or gone): nothing is left marked. Back in sight: what still runs is marked again. */
    hidden: (yes: boolean) => { try { if (yes) s?.removeItem(PAGE_MARK_KEY); else write(); } catch { /* nothing kept */ } },
  };
}
export type PageMarks = ReturnType<typeof createPageMarks>;

let device: PageMarks | null = null;
export function pageMarks(): PageMarks {
  if (device) return device;
  device = createPageMarks();
  if (typeof document !== "undefined") {
    const d = device;
    addEventListener("pagehide", () => d.hidden(true));
    document.addEventListener("visibilitychange", () => d.hidden(document.visibilityState === "hidden"));
  }
  return device;
}
