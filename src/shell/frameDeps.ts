// The shell's real answers to the frame (frameBridge.ts `HostDeps`), from what the shell holds.
import type { Decided, FrameApplet, FrameApplets, FrameViewer } from "../bridge/protocol";
import { OFFICIAL_NAMES, officialCopyOf, officialFace, officialId } from "../applet/parachuteSource";
import { appletsNow, refreshApplets } from "../applet/useApplets";
import { gateNow, whenGateKnown } from "../applet/selftest/run";
import { statusOf } from "../open/status";
import { readRoleTags } from "../open/roles";
import { clearDefault, defaultsFor, setDefault, VAULT } from "../open/defaults";
import { carryMark, clearMark, markTap } from "../open/mark";
import { clientFor, keptClientFor } from "../vault/client";
import { messageOf } from "../vault/hooks";
import { inShell } from "../vault/oauth";
import { confirmLinkOut, confirmWrite, homeVault, type WriteAsk } from "./frameSource";
import { fullComponent, refreshComponents } from "../applet/useComponents";
import { addToHome } from "../applet/addToHome";
import { bringIn, readPointers } from "../applet/pointers";
import { isMine, whoseOf } from "../vault/whose";
import type { FrameComponents, FramePointer } from "../bridge/protocol";
import { originOf, listVaults, hostOf, type VaultRecord } from "../vault/store";
import { dismissVault, newVaultsOn, startAddVault } from "../vault/newVaults";
import type { HostDeps } from "./frameBridge";
import { atFirstEntry } from "../ui/history";
import { bundleMissing, bundleNewer, barNow, openBundleNow, pinApplet, startApplet } from "./homeSettings";
import { offered, namesApplet, type Bundle } from "./bundles";
import { chooseStart, forgetStart, START_WAIT_MS } from "./start";
import { parachutesNow } from "./parachutes";

/** The bar and the home as the frame may see them, and the two changes it may ask for on a tap. A frame's tap can't
 *  tell which of its elements was tapped, so a frame of the person's (from their vault) only writes the settings note:
 *  its choice of a home is never also the person's choice on this device (start.ts), which their own tap on the screen
 *  the next start leads to makes. The built-in frame's "Open on start" is the app's own sheet, so it counts. */
export const homeNow = () => {
  const b = barNow();
  // the app chosen here didn't load: made for a newer Parachute (its name), or malformed (null)
  const missing = bundleMissing(), newer = missing ? bundleNewer(missing) : null;
  return { start: b.start ? { vault: b.start.vault, noteId: b.start.noteId } : null, bar: b.pins.map((p) => ({ vault: p.vault, noteId: p.noteId })),
    parachutes: parachutesNow().map((p) => {
      const fresh = newVaultsOn(p.hub);
      return { hub: p.hub, host: p.host, name: p.name, home: p.home, signedIn: p.vaults.length > 0, ...(fresh.length ? { fresh } : {}) };
    }), ...(openBundleNow().look === "notes" ? { look: "notes" as const, app: "simple" as const } : {}), ...(missing ? (newer ? { notice: "bundle-newer" as const, noticeName: newer } : { notice: "bundle-record" as const }) : {}),
    ...viewerNow(), ...officialNow() };
};
/** A home's copy of one of Parachute's own (the old Add Capture wrote these), listed beside Parachute's own: said so. */
function copyNote(rec: VaultRecord, manifestId: string): { note: string } | null {
  const home = homeVault(), of = officialCopyOf(manifestId);
  return of && home?.key === rec.key && openBundleNow().parachute ? { note: `your copy of Parachute's ${of}` } : null;
}
/** Parachute's own applets, listed in the home (docs/design/PARACHUTE-SOURCE.md): from the app, never read from a vault. */
function officialNow(): { official?: FrameApplet[] } {
  const home = homeVault();
  if (!home || !openBundleNow().parachute) return {};
  const status = "ok" as const;
  return { official: OFFICIAL_NAMES.map((n) => { const f = officialFace(n); return { noteId: officialId(n), path: f.name, vault: home.key, opens: [], status,
    manifest: { id: `parachute-${n}`, name: f.name, glyph: f.glyph, ...(f.note ? { note: f.note } : {}), screens: f.screens } }; }) };
}
/** Vault, Parachute's own (docs/design/PARACHUTE-SOURCE.md): where a record no other applet opens goes (docs/VAULT.md),
 *  whenever applets run here. */
function viewerNow(): { viewer?: FrameViewer } {
  const home = homeVault();
  if (!home) return {};
  // Parachute's own runs before the self-test is known (AppletScreen): always "ok"
  if (openBundleNow().parachute) return { viewer: { vault: home.key, noteId: officialId("vault"), status: "ok" } };
  // a bundle that leaves Parachute's own out: a copy of Vault the person keeps in their home, as before (its card asks)
  const a = appletsNow(home.key);
  const e = a?.state === "ok" ? a.found.entries.find((x) => x.manifest.id === "vault-view") : undefined;
  return e ? { viewer: { vault: home.key, noteId: e.noteId, status: statusOf(home.key, gateNow())(e) } } : {};
}
/** For a frame of the person's own, a write into their vault is asked about once more on the shell's own sheet. */
const confirmed = (from: "built-in" | "vault", q: WriteAsk) => (from === "vault" ? confirmWrite(q) : Promise.resolve(true)).then((yes) => { if (!yes) throw new Error("not_allowed"); });
/** The same, once the home vault's applets have been read this session (so Vault, when it is there, is known). */
const homeRead = async () => {
  const home = homeVault();
  // read once if never read this session, or wait for the read already under way: a read that failed isn't asked
  // again here (each frame's reload of the home would ask it again, and each failure would set off another)
  const was = home ? appletsNow(home.key) : undefined;
  // never long: a slow hub or self-test leaves Vault unknown (the plain views, with their line), as a start does
  const read = (async () => { if (home && (!was || was.state === "loading")) await refreshApplets(home).catch(() => false); await whenGateKnown(); })();
  await Promise.race([read, new Promise((r) => setTimeout(r, START_WAIT_MS))]);
  return homeNow();
};
const homeDeps = (from: "built-in" | "vault"): HostDeps["home"] => ({
  get: homeRead,
  bringIn: async (vault, noteId) => { await confirmed(from, { title: "Bring this into your Parachute?", body: "Your frame asks to write a pointer to it in your home vault. Nothing of it runs until you allow it.", act: "Bring it in" }); await bringThingIn(vault, noteId); },
  addEmbed: async (vault, noteId) => { await confirmed(from, { title: "Add this to your home?", body: "Your frame asks to put this component on your home applet's page. It asks before it runs.", act: "Add to home" }); return addToHome(vault, noteId); },
  addVault: async (hub, vault) => {
    // only a vault the shell itself found on offer: the sheet below never words what a frame made up
    if (!newVaultsOn(hub).includes(vault)) throw new Error("not_allowed");
    await confirmed(from, { title: `Add ${vault}?`, body: `Your frame asks to add the vault ${vault} from ${hostOf(hub)}. Your hub asks you to approve it first, unless you already have.`, act: "Add it" });
    window.location.assign(await startAddVault(hub, vault));
  },
  dismissVault: (hub, vault) => dismissVault(hub, vault),
  pin: (vault, noteId, on) => pinApplet(vault, noteId, on),
  start: async (vault, noteId) => {
    await startApplet(vault, noteId);
    if (noteId === null) forgetStart(); else if (from === "built-in") chooseStart(vault, noteId);
  },
});

async function applets(rec: VaultRecord, fresh: boolean): Promise<FrameApplets> {
  // statuses are judged once the self-test's facts are known, so a note never opens plain only because the app had
  // not finished starting
  await whenGateKnown();
  // at a tap (`fresh`), as the hub has them now: if that read fails, no applet opens the note this time
  const ok = fresh || !appletsNow(rec.key) ? await refreshApplets(rec, fresh) : true;
  const e = appletsNow(rec.key);
  if (!ok || e?.state !== "ok") return { ok: false, error: e?.state === "error" ? e.error : "the applets couldn't be read" };
  const status = statusOf(rec.key, gateNow());
  // only what the open bundle offers (shell/bundles.ts): listing is all it decides; what runs is still each applet's card
  const app = openBundleNow(), home = homeVault();
  const held = { hub: originOf(rec.issuer), vault: rec.vault };
  const inApp = (a: { noteId: string; path: string }) => !home || offered(app, held, a, originOf(home.issuer));
  return {
    ok: true, skipped: e.found.skipped,
    entries: e.found.entries.filter(inApp).map((a) => ({ noteId: a.noteId, path: a.path, vault: a.vault, opens: a.opens, status: status(a),
      manifest: { id: a.manifest.id, name: a.manifest.name, glyph: a.manifest.glyph, ...(copyNote(rec, a.manifest.id) ?? (a.manifest.note ? { note: a.manifest.note } : {})), screens: a.manifest.screens } })),
  };
}

// ── other Parachutes in the person's own (docs/design/EMBED.md) ──

/** This device's vault for a pointer's hub and vault, if it holds it. */
const heldFor = (hub: string, vault: string) => listVaults().find((v) => originOf(v.issuer) === hub && v.vault === vault) ?? null;

/** Bring an applet or a component of someone else's vault in: a pointer in the home vault, pinned to its code as read now. */
async function bringThingIn(vault: string, noteId: string): Promise<void> {
  const rec = listVaults().find((v) => v.key === vault);
  if (!rec) throw new Error("This device doesn't hold that vault.");
  if (isMine(rec)) throw new Error("It's in a vault of yours already.");
  await refreshApplets(rec, true);
  const a = appletsNow(rec.key);
  const e = a?.state === "ok" ? a.found.entries.find((x) => x.noteId === noteId) : undefined;
  if (e) { await bringIn(rec, noteId, { kind: "applet", id: e.manifest.id, name: e.manifest.name, code: e.keys.html }); return; }
  const c = await fullComponent(rec, noteId);
  await bringIn(rec, noteId, { kind: "component", id: c.component.id, name: c.component.name, code: c.hash });
}

async function components(rec: VaultRecord): Promise<FrameComponents> {
  const r = await refreshComponents(rec);
  if (r.state !== "ok") return { ok: false, error: r.error };
  return { ok: true, entries: r.entries.map((c) => ({ noteId: c.noteId, path: c.path, id: c.component.id, name: c.component.name, glyph: c.component.glyph, ...(c.component.note ? { note: c.component.note } : {}), props: { ...c.component.props } })) };
}

/** The home vault's pointers, each found on this device. */
async function pointers(): Promise<FramePointer[]> {
  await whenGateKnown();
  const list = await readPointers().catch(() => []);
  const mode = gateNow();
  return Promise.all(list.map(async ({ noteId, pointer: p }) => {
    let host = p.hub;
    try { host = new URL(p.hub).host; } catch { /* as written */ }
    const base: FramePointer = { noteId, kind: p.kind, id: p.id, name: p.name, from: { vault: p.vault, host }, record: p.record, at: null };
    const rec = heldFor(p.hub, p.vault);
    if (!rec) return base;
    if (p.kind !== "applet") return { ...base, at: rec.key };
    if (appletsNow(rec.key)?.state !== "ok") await refreshApplets(rec);
    const a = appletsNow(rec.key);
    const e = a?.state === "ok" ? a.found.entries.find((x) => x.noteId === p.record) : undefined;
    return e ? { ...base, at: rec.key, glyph: e.manifest.glyph, status: statusOf(rec.key, mode)(e), changed: e.keys.html !== p.code } : { ...base, at: rec.key };
  }));
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

/** What the open bundle's record says opens each kind of note in this vault (its `opens`), as the device's choices are
 *  kept: an applet's note id here, or "vault" for the plain view. The device's own "Always" wins over it. A choice
 *  naming an applet this device hasn't read, or one that doesn't open that kind, is left out. */
export function appDefaults(vault: string, app: Bundle = openBundleNow()): Record<string, string> {
  const rec = listVaults().find((v) => v.key === vault), home = homeVault();
  if (!rec || !home || !app.opens.length) return {};
  const a = appletsNow(vault);
  const out: Record<string, string> = {};
  for (const o of app.opens) {
    if ((o.hub ?? app.hubOf ?? originOf(home.issuer)) !== originOf(rec.issuer) || o.vault !== rec.vault || o.type in out) continue;
    if (o.applet === null) { out[o.type] = VAULT; continue; }
    const held = { hub: originOf(rec.issuer), vault: rec.vault };
    const e = a?.state === "ok" ? a.found.entries.find((x) => namesApplet(o.applet!, x) && x.opens.some((y) => y.type === o.type) && offered(app, held, x, originOf(home.issuer))) : undefined;
    if (e) out[o.type] = e.noteId;
  }
  return out;
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
    roles: (rec) => readRoleTags(keptClientFor(rec)),
    applets,
    defaults: { get: (vault) => ({ ...appDefaults(vault), ...defaultsFor(vault) }), set: setChoice },
    home: homeDeps(from),
    pointers,
    components,
    whose: whoseOf,
    homeKey: () => homeVault()?.key ?? null,
    go,
    here: () => location.pathname,
    // one step back, or the launcher on the first entry (a start, a link from outside): never out of the app from a screen's Back
    back: () => { if (!atFirstEntry()) history.back(); else go("/", true); },
    decide,
    tapNow: tapIn(frame),
    mark: { tap: markTap, carry: carryMark, clear: clearMark },
    copy: (text) => navigator.clipboard?.writeText(text).then(() => true, () => false) ?? Promise.resolve(false),
    openOut: (url) => (from === "vault" ? confirmLinkOut(url) : Promise.resolve(true)).then(async (yes) => { if (yes) await openOut(url); return yes; }).catch(() => false),
    message: messageOf,
  };
}
