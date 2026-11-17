// Which frame tried to leave (docs/design/EMBED.md, "A frame that tries to leave"). The shell's CSP stops a frame's
// navigation, and the violation event can't say which frame tried. A frame element that loads again after its first
// load is the one that navigated (checked in Chromium, the engine of Android's WebView). On a violation each frame
// waits a moment for that: the one that loaded again stops; if no single frame can be named (a webview that fires no
// second load), every frame stops, which is safe at the cost of the page.

export const NAME_WAIT_MS = 400;
const loads: { id: string; at: number }[] = [];
const now = () => (typeof performance === "undefined" ? Date.now() : performance.now());

/** A frame's element loaded again after its first load: it navigated. */
export function loadedAgain(id: string) { loads.push({ id, at: now() }); while (loads.length > 50) loads.shift(); }

/** Called by every frame on a frame-src violation: after a moment, whether it was this frame ("mine": stop it), another
 *  one ("other": carry on), or no one frame can be named ("unnamed": every frame stops). */
export function judge(id: string, at = now()): Promise<"mine" | "other" | "unnamed"> {
  return new Promise((res) => setTimeout(() => {
    const who = [...new Set(loads.filter((l) => l.at >= at - 1500).map((l) => l.id))];
    res(who.length === 1 ? (who[0] === id ? "mine" : "other") : "unnamed");
  }, NAME_WAIT_MS));
}

// ── pages stopped when no one frame could be named: when they open again, what came from someone else's vaults waits ──
const heldPages = new Map<string, Set<string>>();
/** Every embed of this page from someone else's vault waits at Review until the person allows it again. */
export const holdPage = (page: string) => { if (!heldPages.has(page)) heldPages.set(page, new Set()); };
/** Is this embed waiting (the page was stopped and the person hasn't allowed it again since)? */
export const pageHeld = (page: string, name: string) => !!heldPages.get(page) && !heldPages.get(page)!.has(name);
/** The person allowed it again. */
export const releaseFromPage = (page: string, name: string) => { heldPages.get(page)?.add(name); };
