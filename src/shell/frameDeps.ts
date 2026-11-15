// The shell's real answers to the frame (frameHost.ts `HostDeps`), from what the shell holds.
import type { Decided, FrameApplets } from "../bridge/protocol";
import { appletsNow, refreshApplets } from "../applet/useApplets";
import { gateNow, whenGateKnown } from "../applet/selftest/run";
import { statusOf } from "../open/status";
import { readRoleTags } from "../open/roles";
import { clearDefault, defaultsFor, setDefault, VAULT } from "../open/defaults";
import { carryMark, clearMark, markTap } from "../open/mark";
import { clientFor } from "../vault/client";
import { messageOf } from "../vault/hooks";
import { inShell } from "../vault/oauth";
import { confirmLinkOut } from "./frameSource";
import { listVaults, type VaultRecord } from "../vault/store";
import type { HostDeps } from "./frameHost";

async function applets(rec: VaultRecord, fresh: boolean): Promise<FrameApplets> {
  // statuses are judged once the self-test's facts are known, so a note never opens plain only because the app had
  // not finished starting
  await whenGateKnown();
  const ok = fresh || !appletsNow(rec.key) ? await refreshApplets(rec) : true;
  const e = appletsNow(rec.key);
  if (!ok || e?.state !== "ok") return { ok: false, error: e?.state === "error" ? e.error : "the applets couldn't be read" };
  const status = statusOf(rec.key, gateNow());
  return {
    ok: true, skipped: e.found.skipped,
    entries: e.found.entries.map((a) => ({ noteId: a.noteId, path: a.path, vault: a.vault, opens: a.opens, status: status(a),
      manifest: { id: a.manifest.id, name: a.manifest.name, glyph: a.manifest.glyph, screens: a.manifest.screens } })),
  };
}

/** A choice the frame may store: the vault view or one of the vault's applets as last read, for a tag-like type, and
 *  no more than a few hundred per vault (they share the device's storage with the sign-ins). */
export const MAX_DEFAULTS = 200;
const TYPE = /^[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*)*$/;
function setChoice(vault: string, type: string, choice: string | null) {
  if (choice === null) { clearDefault(vault, type); return; }
  const a = appletsNow(vault);
  if (!TYPE.test(type) || (choice !== VAULT && !(a?.state === "ok" && a.found.entries.some((e) => e.noteId === choice)))) throw new Error("That isn't a choice this vault has.");
  const cur = defaultsFor(vault);
  if (!(type in cur) && Object.keys(cur).length >= MAX_DEFAULTS) throw new Error("Too many choices kept for this vault.");
  setDefault(vault, type, choice);
}

/** Open a link outside the app: the system's browser (or mail, or phone) in the shell, a new tab on the web. */
async function openOut(url: string) {
  if (inShell()) { const { openUrl } = await import("@tauri-apps/plugin-opener"); await openUrl(url); }
  else window.open(url, "_blank", "noopener,noreferrer");
}

/** What each history entry's note route decided, for the session: the frame is made afresh after every shell screen,
 *  and a return to an entry must not decide again (it would send the person on to the applet a second time). */
const decisions = new Map<string, Decided>();
export const decidedFor = (key: string): Decided | undefined => decisions.get(key);
function decide(key: string, kind: Decided) {
  decisions.set(key, kind);
  if (decisions.size > 500) decisions.delete(decisions.keys().next().value!);
}

/** A tap counts for the frame only while the frame has the focus: a tap inside it gives it that, and a tap on a shell
 *  screen just before the frame was made (Back from Settings) doesn't. */
const tapIn = (frame: () => HTMLIFrameElement | null) => () =>
  (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive === true && !!frame() && document.activeElement === frame();

/** `from`: a frame of the person's (from their vault) asks the shell before it opens an address outside the app. */
export function shellDeps(go: (to: string, replace: boolean) => void, frame: () => HTMLIFrameElement | null, from: "built-in" | "vault" = "built-in"): HostDeps {
  return {
    vaults: listVaults,
    client: clientFor,
    roles: (rec) => readRoleTags(clientFor(rec)),
    applets,
    defaults: { get: defaultsFor, set: setChoice },
    go,
    here: () => location.pathname,
    back: () => history.back(),
    decide,
    tapNow: tapIn(frame),
    mark: { tap: markTap, carry: carryMark, clear: clearMark },
    copy: (text) => navigator.clipboard?.writeText(text).then(() => true, () => false) ?? Promise.resolve(false),
    openOut: (url) => { void (from === "vault" ? confirmLinkOut(url) : Promise.resolve(true)).then((yes) => (yes ? openOut(url) : undefined)).catch(() => {}); },
    message: messageOf,
  };
}
