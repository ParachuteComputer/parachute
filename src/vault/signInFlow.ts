// Signing in to a Parachute, and asking it for one vault more (docs/design/ONE-SIGN-IN.md, docs/design/SCOPES.md).
// The sign-in learns which vaults the person has, and which of them holds their settings or app record (with the key,
// from the shell; without, by a first step that only lists them and is ended at once), and reads one: the home (or, on
// someone else's Parachute, the vault the person opens first).
// Every other vault is asked for alone, when something the person allows needs it (vault/reach.ts). The screens (Add a
// Parachute, the sign-in's return, the launcher's Open, an applet's Allow, a change that needs write) call these.
import { beginSignIn, completeSignIn, dropPending, revoke, type AllowAfter, type Pending, type Why } from "./oauth";
import { holdManage } from "./manage";
import { describe, homeFrom, homeWithToken, levelIn, listWithToken, reachesEvery, vaultUrlFrom, type Level, type Listed, type Parachute } from "./parachute";
import { limitedFetch } from "./limited";
import { MAX_VAULTS } from "./address";
import { listVaults, originOf, saveVault, vaultUrlOf, type VaultRecord } from "./store";
import { setWhose, whoseOf, whoseSaid } from "./whose";
import { homeRecordsWithKey, keySignIn, keysHere, listWithKey, type Refusal } from "../key/key";
import { noteEvery, noteListed, undismissOn } from "./newVaults";
import { holdHome, homeVault, setHome } from "../shell/frameSource";
import { deviceGrants } from "../applet/grants";
import { noteOwnWrite } from "./writeAsk";
import { grantExpiry } from "../applet/grant";
import { chooseStart } from "../shell/start";
import type { TokenResponse } from "@openparachute/surface-client";

/** Before the hub's consent, what only the person can say: on a hub they run (it lists every vault on it), which vaults
 *  are theirs (`askMine`); and when more than one could be read first, which one (`first`: their home, on a Parachute
 *  of theirs). `mine` and `first` are what is chosen to begin with. The screen calls `go` with the choice, and opens the
 *  address it gives. */
export type VaultPick = { hub: string; vaults: string[]; askMine: boolean; mine: string[]; first: string; home: boolean;
  go: (mine: string[], first: string) => Promise<string> };
/** Where to go next: the hub (its sign-in or consent page), a pick first, or done, with the vault now held and where to
 *  go after (`back`). `signIn`: this finished a sign-in to the Parachute (its list and home follow, afterSignIn). */
export type Next = { go: string } | { pick: VaultPick } | { done: VaultRecord; parachute: Parachute; back?: string; signIn: boolean; firstHome: boolean;
  /** the sign-in listed one vault, the person's own (a new person on Cloud has one; another vault may hold settings) */
  solo: boolean; why: Why };

const fetchFor = (whose: "mine" | "theirs") => (whose === "mine" ? fetch.bind(globalThis) : limitedFetch());

/** The vault this device already calls home, when it is on this hub and among these. */
function homeHere(parachute: Parachute, vaults: readonly string[]): string | null {
  const h = homeVault();
  return h && originOf(h.issuer) === originOf(parachute.issuer) && vaults.includes(h.vault) ? h.vault : null;
}

/** What the person says of the vaults a sign-in listed (whose each is), carried through the hub's consent and kept only
 *  when it comes back (finishStep): a sign-in stopped at the hub changes nothing. */
export type Marks = { listed: string[]; whose: "mine" | "theirs"; mine: string[] | null; solo: boolean };

/** Say whose each listed vault is, as the person did: on a hub they run, by their pick; else what they said of the
 *  Parachute, for each vault this device hasn't been told about (signing in again never changes what they already said
 *  of a vault; Settings does). */
function sayWhose(issuer: string, m: Marks) {
  for (const v of m.listed) {
    const at = { issuer, vault: v };
    if (m.mine) setWhose(at, m.mine.includes(v) ? "mine" : whoseOf(at) === "trusted" ? "trusted" : "theirs");
    else if (whoseSaid(at) === null) setWhose(at, m.whose);
  }
}

/** What a sign-in asks of a vault it reads that isn't the home (the home is asked at write: Parachute's own applets
 *  write there, docs/design/PARACHUTE-SOURCE.md): read, or write when this device already holds write there (signing in
 *  again never takes away what something allowed needs). */
function levelAt(parachute: Parachute, vault: string): Level {
  const held = listVaults().find((v) => originOf(v.issuer) === originOf(parachute.issuer) && v.vault === vault);
  return held && levelIn(held.scope, held.vault) === "write" ? "write" : "read";
}

/** Whether a sign-in asks which listed vault holds the person's settings or app record (parachute.ts homeFrom): on a
 *  Parachute of theirs with more than one vault, when this device has no home yet. A home already chosen never moves. */
const asksHome = (whose: "mine" | "theirs", listed: Listed) => whose === "mine" && listed.vaults.length > 1 && !homeVault();

/** After the listing: keep what it found, then the vault to read first (the home on a Parachute of the person's own),
 *  asked of the person only when it isn't clear. */
function readFirst(parachute: Parachute, listed: Listed, whose: "mine" | "theirs", open: (first: string, home: boolean, marks: Marks) => Promise<string>): { go: Promise<string> } | { pick: VaultPick } {
  noteListed(parachute.hub, listed.vaults);
  // a new sign-in offers again the vaults waved away on this device
  undismissOn(parachute.hub);
  const at = (vault: string) => ({ issuer: parachute.issuer, vault });
  const askMine = whose === "mine" && listed.all && listed.vaults.length > 1;
  const mine = whose !== "mine" ? [] : listed.vaults.filter((v) => !askMine || [null, "mine"].includes(whoseSaid(at(v))));
  const known = homeHere(parachute, listed.vaults);
  // the vault read first is the home when the Parachute is the person's and this device has no home elsewhere
  const home = whose === "mine" && (!homeVault() || !!known);
  const candidates = whose === "mine" ? mine : listed.vaults;
  // offered first: the home this device has there, else the vault that holds the person's settings or app record, else
  // the first by name
  const first = known ?? (listed.home && candidates.includes(listed.home) ? listed.home : null) ?? [...candidates].sort()[0] ?? listed.vaults[0];
  const marks = (m: string[] | null): Marks => ({ listed: listed.vaults, whose, mine: m, solo: (m ?? candidates).length === 1 && listed.vaults.length === 1 });
  if (!askMine && (known || candidates.length <= 1)) return { go: open(first, home, marks(null)) };
  return { pick: { hub: parachute.hub, vaults: listed.vaults, askMine, mine, first, home,
    go: (m, f) => open(f, home && (!askMine || m.includes(f)), marks(askMine ? m : null)) } };
}

/** Start: read the hub, and with the key learn the person's vaults at once and open the hub's key door. Throws a
 *  Refusal (key) or an Error (words for the person). */
export async function startSignIn(hub: string, whose: "mine" | "theirs", withKey: boolean): Promise<{ go: string } | { pick: VaultPick }> {
  const f = fetchFor(whose);
  const parachute = await describe(hub, f);
  if (!withKey) return { go: await beginSignIn({ parachute, step: "list", whose, how: "page", fresh: true }, f) };
  // which vault holds the person's settings is asked beside the listing, not after it (asksHome decides once the list is in)
  const records = whose === "mine" && !homeVault() ? homeRecordsWithKey(parachute) : null;
  // the shell signs one `list-vaults` request with the key, to the hub's own account MCP; a hub that can't answer it
  // (an older one, or one whose account MCP is elsewhere) gets the listing sign-in instead, through the same key door
  const listed: Listed | null = await listWithKey(parachute);
  if (listed) noteEvery(hub, listed.all);
  if (listed && !listed.vaults.length) throw { code: "no_vaults", message: "Your key is known there, but no vault is yours yet. Ask the hub's owner to give you one." } satisfies Refusal;
  const door = async (b: Parameters<typeof beginSignIn>[0]) => {
    const authorize = await beginSignIn(b, f);
    try {
      return await keySignIn(hub, authorize);
    } catch (r) {
      dropPending();
      throw r;
    }
  };
  if (!listed) return { go: await door({ parachute, step: "list", whose, how: "key", fresh: true }) };
  if (records && asksHome(whose, listed)) listed.home = homeFrom(await records, listed.vaults);
  const next = readFirst(parachute, listed, whose, (first, home, marks) => door({ parachute, step: "open", vault: first, level: home ? "write" : levelAt(parachute, first), why: "signin", whose, how: "key", fresh: true, home, marks }));
  return "pick" in next ? next : { go: await next.go };
}

/** Ask a Parachute this device is signed in to for one vault, at a level (vault/reach.ts says when): through the key
 *  door when this device has a key the hub takes, else the hub's own page. Resolves to the address to open. */
export async function askVault(rec: Pick<VaultRecord, "issuer" | "vault">, level: Level, why: Why, back?: string, allow?: AllowAfter): Promise<string> {
  const hub = originOf(rec.issuer);
  const whose: "mine" | "theirs" = whoseOf(rec) === "mine" ? "mine" : "theirs";
  const parachute = await describe(hub, fetchFor(whose));
  const b = { parachute, step: "open" as const, vault: rec.vault, level, why, whose, ...(back ? { back } : {}), ...(allow ? { allow } : {}) };
  if (keysHere()) {
    try { return await keySignIn(hub, await beginSignIn({ ...b, how: "key" })); } catch { dropPending(); }
  }
  return beginSignIn({ ...b, how: "page" });
}

/** Ask a Parachute for one vault's admin, to manage who reaches it (vault/manage.ts): through the key door when this
 *  device has a key the hub takes, else the hub's own page. Resolves to the address to open. */
export async function askManage(rec: Pick<VaultRecord, "issuer" | "vault">, back: string, applet: string): Promise<string> {
  const hub = originOf(rec.issuer);
  const whose: "mine" | "theirs" = whoseOf(rec) === "mine" ? "mine" : "theirs";
  const parachute = await describe(hub, fetchFor(whose));
  const b = { parachute, step: "manage" as const, vault: rec.vault, why: "manage" as const, whose, back, applet };
  if (keysHere()) {
    try { return await keySignIn(hub, await beginSignIn({ ...b, how: "key" })); } catch { dropPending(); }
  }
  return beginSignIn({ ...b, how: "page" });
}

/** The hub sent the person back with a code: finish that step, keep what it brought, and say where to go next. */
export async function finishStep(code: string, state: string, iss?: string | null): Promise<Next> {
  const { pending, token, vault, level } = await completeSignIn(code, state, undefined, iss);
  const f = fetchFor(pending.whose ?? "theirs");
  const p = pending.parachute;

  if (pending.step === "list") {
    let listed: Listed;
    try {
      // an account token's `covered` says what the token covers, not whether the person runs the hub (0.9 grants it
      // per vault): that is read from the hub's public list instead
      const theirs = await listWithToken(p.accountMcp, token.access_token, f);
      // asked only when there could be a pick (Mine, and more than one vault)
      const ask = pending.whose === "mine" && theirs.vaults.length > 1;
      const [all, home] = await Promise.all([ask && reachesEvery(p.hub, theirs.vaults, f),
        asksHome(pending.whose ?? "theirs", theirs) ? homeWithToken(p.accountMcp, token.access_token, theirs.vaults, f) : null]);
      listed = { vaults: theirs.vaults, all, home };
    } finally {
      // the listing token has done its one job: ended before the page moves on (it could do more than list on some
      // hubs: docs/design/SCOPES.md)
      await revoke({ issuer: pending.issuer, clientId: pending.clientId, refreshToken: token.refresh_token, revocationEndpoint: pending.revocationEndpoint });
    }
    // whether the person reaches every vault there: then the hub's public list is theirs, for vaults made later (newVaults.ts)
    // (strictly: a list cut at MAX_VAULTS is taken as every vault for the pick, never here)
    noteEvery(p.hub, listed.all && listed.vaults.length < MAX_VAULTS);
    if (!listed.vaults.length) throw new Error("You're signed in there, but no vault is yours yet. Ask the hub's owner to give you one.");
    // the hub's session is still in place: its consent for the one vault comes next
    const whose = pending.whose ?? "theirs";
    const next = readFirst(p, listed, whose, (first, home, marks) => beginSignIn({ parachute: p, step: "open", vault: first, level: home ? "write" : levelAt(p, first), why: "signin", whose, how: pending.how, home, marks }, f));
    return "pick" in next ? next : { go: await next.go };
  }

  // managing who reaches a vault: its admin is held for this visit only, never as the vault's own token
  if (pending.step === "manage") {
    const rec = listVaults().find((v) => v.issuer === pending.issuer && v.vault === vault);
    if (!rec) {
      await revoke({ issuer: pending.issuer, clientId: pending.clientId, refreshToken: token.refresh_token, revocationEndpoint: pending.revocationEndpoint });
      throw new Error("That vault isn't on this device any more. Nothing changed.");
    }
    holdManage(pending, token, vault!);
    return { done: rec, parachute: p, ...(pending.back ? { back: pending.back } : {}), signIn: false, firstHome: false, solo: false, why: "manage" };
  }

  // a sign-in's first vault: the device's home stays where it is until this sign-in says otherwise (a new record of a
  // vault it held would otherwise count as newer)
  if (pending.why === "signin") holdHome();
  const hadHome = !!homeVault();
  // whose each listed vault is, as the person said before the consent
  if (pending.why === "signin" && pending.marks) sayWhose(p.issuer, pending.marks);
  const rec = keep(pending, token, vault!);
  // the vault the person chose as home (or the one this device already called home there)
  if (pending.why === "signin" && pending.home && whoseOf(rec) === "mine") setHome(rec.key);
  // the person's own change needed write, and the hub gave it: kept as theirs (vault/reach.ts)
  if (pending.why === "write" && level === "write") noteOwnWrite(rec);
  // the hub gave read where the person asked to change notes: they hold read only there, and asking again won't help
  if (pending.why === "write" && level !== "write") throw new Error(`Your hub lets you read ${vault} only, so Parachute can't change notes there.`);
  // an applet allowed on its card is recorded only now that the hub gave what it needs
  if (pending.allow) {
    if (level === "write" || pending.level !== "write") {
      const a = pending.allow;
      deviceGrants().grant(a.subject, a.scope, a.html, a.mode, grantExpiry, a.asked);
      if (a.home) chooseStart(a.home.vault, a.home.noteId);
    } else throw new Error(`Your hub gave Parachute read only in ${vault}, so it can't let this applet change notes there. Nothing was allowed.`);
  }
  return { done: rec, parachute: p, ...(pending.back ? { back: pending.back } : {}), signIn: pending.why === "signin", firstHome: !hadHome && !!pending.home, solo: !!pending.marks?.solo, why: pending.why };
}

/** Keep one vault, with its own token; an older sign-in of the same vault here is ended. */
function keep(pending: Pending, token: TokenResponse, vault: string): VaultRecord {
  const p = pending.parachute;
  const url = vaultUrlFrom(p.vaultTemplate, vault);
  const before = listVaults().find((v) => v.issuer === p.issuer && v.vault === vault);
  // what the person already said of this vault: read before the record is kept
  const said = whoseSaid({ issuer: p.issuer, vault });
  const rec = saveVault({ issuer: p.issuer, vault, tokenEndpoint: pending.tokenEndpoint, ...(pending.revocationEndpoint ? { revocationEndpoint: pending.revocationEndpoint } : {}), clientId: pending.clientId,
    accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined, scope: token.scope ?? "",
    addedAt: before?.addedAt ?? new Date().toISOString(), ...(url !== vaultUrlOf({ issuer: p.issuer, vault }) ? { url } : {}) });
  if (before?.refreshToken && before.refreshToken !== token.refresh_token) void revoke(before);
  // whose it is (the sign-in said it of every vault it listed, before the consent): their answer on Add a Parachute,
  // for a vault this device still hasn't been told about. Signing in again never changes what they already said of a vault
  // (Settings does), and a trusted vault stays trusted.
  const to = said === null ? pending.whose : null;
  if (to && !(to === "theirs" && whoseOf(rec) === "trusted")) setWhose(rec, to);
  return rec;
}

/** An error of a sign-in step, in words for the person. */
export const signInWords = (err: unknown) => err instanceof TypeError ? "The hub didn't answer." : err instanceof Error ? err.message : "The hub didn't answer.";

/** Sign out of a whole Parachute on this device: each of its vaults, as Settings signs out of one. */
export function signOutOf(issuer: string, signOut: (v: VaultRecord) => void) {
  for (const v of listVaults().filter((x) => x.issuer === issuer)) signOut(v);
}

export type { Pending };
