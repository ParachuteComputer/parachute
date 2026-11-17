// Which frame runs: the built-in one, or the person's own, a record in their home vault. The shell never comes from a
// vault; the frame may. Copy-on-write: the built-in frame runs until the person (or their agent) makes a frame of their
// own, by "Make this mine" (which copies the built-in one into the home vault) or by writing the record. From then on
// it is theirs: a newer built-in frame is offered in Settings, never written over theirs.
//
//   home vault       the person's choice (Settings), else the first vault this device signed in to
//   the record       a note in the home vault tagged `parachute-frame`, extension tsx or jsx: one module whose default
//                    export is the frame. Its metadata `frame.based_on` names the built-in frame it was copied from.
//   runs when        the self-test has passed on this device (and isn't running), and the person allowed this exact
//                    code, under this gate mode, on the frame's card (frameChoice.ts). Changed code asks again.
//   offline          the last allowed copy (kept on this device) runs while the home vault can't be read.
//   stops            a frame that fails gives way to the built-in one; one still marked as shown when the app starts
//                    again (it hung the app, or the app closed while it showed) asks again on its card.
import { useSyncExternalStore } from "react";
import defaultSource from "../frame/default-frame.tsx?raw";
import { codeHash, codeKindOf, prepare, TRANSPILER } from "../applet/code";
import { gateNow, selfTestRunning, subscribeGate } from "../applet/selftest/run";
import { clientFor } from "../vault/client";
import { isMine, HOME_KEY } from "../vault/whose";
import { listVaults, subscribeVaults, type VaultRecord } from "../vault/store";
import { choose, type Approved, type Choice, type Kept, type Mode, type Read } from "./frameChoice";
export type { Choice, Kept, Read };

export const FRAME_TAG = "parachute-frame";
export const FRAME_PATH = "Parachute/Frame";
export { HOME_KEY } from "../vault/whose";
export const FRAMES_KEY = "parachute.frames.v1";
export const DEFAULT_FRAME_SOURCE = defaultSource;
export const defaultFrameHash = (): Promise<string> => codeHash("tsx", DEFAULT_FRAME_SOURCE);

// ── what this device keeps ──

const storage = () => (typeof localStorage === "undefined" ? null : localStorage);
function readJson<T>(key: string, fallback: T): T { try { const v: unknown = JSON.parse(storage()?.getItem(key) ?? "null"); return v && typeof v === "object" ? (v as T) : fallback; } catch { return fallback; } }
const writeJson = (key: string, v: unknown) => { try { storage()?.setItem(key, JSON.stringify(v)); } catch { /* this session only */ } };

/** The home vault, always one that is the person's own (vault/whose.ts): their choice if this device still holds it and
 *  it is theirs, else the first vault they signed in to that is theirs. Someone else's vault is never the home. */
export function homeVault(list: readonly VaultRecord[] = listVaults()): VaultRecord | null {
  let chosen: string | null = null;
  try { chosen = storage()?.getItem(HOME_KEY) ?? null; } catch { chosen = null; }
  const mine = list.filter(isMine);
  // at the same time: the first by name
  return mine.find((v) => v.key === chosen) ?? [...mine].sort((a, b) => a.addedAt.localeCompare(b.addedAt) || a.vault.localeCompare(b.vault))[0] ?? null;
}

/** Keep the home this device has now as its home, when it was only the default (the first of the person's own): a
 *  sign-in that keeps new records of earlier vaults must not move it. */
export function holdHome() {
  let chosen: string | null = null;
  try { chosen = storage()?.getItem(HOME_KEY) ?? null; } catch { chosen = null; }
  const list = listVaults();
  if (list.some((v) => v.key === chosen && isMine(v))) return;
  const home = homeVault(list);
  if (home) { try { storage()?.setItem(HOME_KEY, home.key); } catch { /* this session only */ } }
}

// ── the store ──

/** A write a frame of the person's asked for, which the shell asks about once more on its own sheet. */
export type WriteAsk = { title: string; body: string; act: string };
type State = { read: Read | null; reading: boolean; defaultHash: string | null; rev: number; linkOut: string | null; writeAsk: WriteAsk | null };
let state: State = { read: null, reading: false, defaultHash: null, rev: 0, linkOut: null, writeAsk: null };
const listeners = new Set<() => void>();
const set = (p: Partial<State>) => { state = { ...state, ...p, rev: state.rev + 1 }; listeners.forEach((f) => f()); };
const kept = (): Kept => readJson<Kept>(FRAMES_KEY, {});
const keep = (k: Kept) => { writeJson(FRAMES_KEY, k); set({}); };
// a frame still marked as shown when the app starts: the app stopped while it showed (it may have hung the app, or the
// app was closed in a way that leaves no time to say so). Its card asks before it runs again.
{ const k = kept(); if (k.starting) writeJson(FRAMES_KEY, { ...k, starting: undefined, suspect: k.starting }); }
void defaultFrameHash().then((h) => set({ defaultHash: h }));

/** The gate for a frame from a vault: the self-test's mode, or closed while it runs (a frame mounted during the
 *  self-test could be taken for one of its probes). */
const gate = (): Mode | "closed" => (selfTestRunning() ? "closed" : gateNow());

export function currentChoice(): Choice {
  const k = kept();
  return choose({ mode: gate(), home: homeVault()?.key ?? null, read: state.read, kept: failedNow && !k.failed ? { ...k, failed: failedNow } : k });
}

let generation = 0;
/** Read the home vault's frame record again (when the frame is shown, and from Settings). A read that a newer one
 *  (or a change of home) overtook is dropped. */
export async function readFrameRecord(): Promise<void> {
  const home = homeVault();
  const mine = ++generation;
  if (!home) { set({ read: null, reading: false }); return; }
  set({ reading: true });
  let read: Read;
  try {
    const rows = await clientFor(home).queryNotes({ tag: FRAME_TAG, includeContent: true, includeMetadata: true, limit: 50 });
    const frames = rows.filter((r) => { const k = codeKindOf(r as { extension?: string }); return k === "tsx" || k === "jsx"; });
    if (!frames.length) read = rows.length ? { vault: home.key, state: "bad", error: "its frame note isn't a tsx or jsx note" } : { vault: home.key, state: "none" };
    else if (frames.length > 1) read = { vault: home.key, state: "many", paths: frames.map((f) => f.path ?? f.id) };
    else {
      const f = frames[0];
      const kind = codeKindOf(f as { extension?: string }) as "tsx" | "jsx";
      const source = f.content ?? "";
      const meta = (f.metadata ?? {}) as { frame?: { based_on?: unknown } };
      read = { vault: home.key, state: "found", noteId: f.id, path: f.path ?? f.id, kind, source, hash: await codeHash(kind, source),
        basedOn: typeof meta.frame?.based_on === "string" ? meta.frame.based_on : null, updatedAt: (f as { updatedAt?: string }).updatedAt ?? null };
    }
  } catch (e) {
    const status = (e as { status?: number } | null)?.status;
    read = status && status < 500 && status !== 408 && status !== 429 ? { vault: home.key, state: "bad", error: e instanceof Error ? e.message : "it couldn't be read" } : { vault: home.key, state: "unreachable" };
  }
  if (mine !== generation || homeVault()?.key !== home.key) return;
  // the person's frame is gone from their vault (or there are two): the copy kept of it goes too (it mustn't run offline
  // later). An error reply keeps it: the vault may only be refusing for now.
  const k = kept();
  if ((read.state === "none" || read.state === "many") && k.approved?.vault === home.key) keep({ ...k, approved: undefined });
  set({ read, reading: false });
}

/** The frame's code to run now: the built-in one, or the home vault's (kept transpiled; made again for a newer transpiler). */
export async function frameCode(c: Choice): Promise<{ js: string; hash: string; from: "built-in" | "vault" } | { error: string }> {
  if (c.run === "vault") {
    const a = c.approved;
    if (a.t === TRANSPILER) return { js: a.js, hash: c.hash, from: "vault" };
    const p = await prepare(a.source, a.kind);
    if (!p.compiled?.ok) return { error: p.compiled && !p.compiled.ok ? p.compiled.error : "it couldn't be read" };
    // only if it is still the one allowed: a decline or sign-out while this compiled must not be undone
    const now = kept();
    if (now.approved?.vault === a.vault && now.approved.hash === a.hash) keep({ ...now, approved: { ...now.approved, js: p.compiled.js, t: TRANSPILER } });
    return { js: p.compiled.js, hash: c.hash, from: "vault" };
  }
  const p = await prepare(DEFAULT_FRAME_SOURCE, "tsx");
  if (!p.compiled?.ok) throw new Error("the built-in frame doesn't compile");
  return { js: p.compiled.js, hash: p.hash, from: "built-in" };
}

/** Allow the record's code as it is now (the card's Use it). Keeps the transpiled copy, and its code, for offline. */
export async function allowFrame(vault: string, noteId: string, hash: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = state.read?.state === "found" && state.read.vault === vault && state.read.noteId === noteId && state.read.hash === hash ? state.read : null;
  if (!r) return { ok: false, error: "the frame changed again: look at it once more" };
  const g = gate();
  if (g === "closed") return { ok: false, error: "frames from a vault run only once the self-test has passed here" };
  const p = await prepare(r.source, r.kind);
  if (!p.compiled?.ok) return { ok: false, error: `its code doesn't compile: ${p.compiled && !p.compiled.ok ? p.compiled.error : "?"}` };
  const approved: Approved = { vault, noteId, hash, js: p.compiled.js, t: TRANSPILER, source: r.source, kind: r.kind, mode: g };
  keep({ ...kept(), approved, declined: undefined, failed: undefined, starting: undefined, suspect: undefined });
  failedNow = null;
  return { ok: true };
}
export function declineFrame(vault: string, noteId: string, hash: string) {
  const k = kept();
  // "use the built-in frame" is the person's latest word: no copy of this vault's frame runs (offline, or before a read
  // lands), whichever version was allowed before
  keep({ ...k, declined: { vault, noteId, hash }, suspect: undefined, ...(k.approved?.vault === vault ? { approved: undefined } : {}) });
}
/** Ask again about the person's frame: forget that they chose the built-in one, or that theirs stopped. */
export function askAgain() { failedNow = null; keep({ ...kept(), declined: undefined, failed: undefined, starting: undefined }); }
/** Stop using the person's frame on this device: the built-in one runs until they ask for theirs again. */
export function useBuiltIn() {
  const r = state.read;
  const k = kept();
  keep({ ...k, approved: undefined, suspect: undefined, declined: r?.state === "found" ? { vault: r.vault, noteId: r.noteId, hash: r.hash } : k.declined });
}
/** Signing out of a vault forgets the frame this device kept from it. */
export function forgetVaultFrame(vault: string) {
  const k = kept();
  keep({ ...k, ...(k.approved?.vault === vault ? { approved: undefined } : {}), ...(k.declined?.vault === vault ? { declined: undefined } : {}) });
  void readFrameRecord();
}
/** The frame said it stopped (its own words, shown quoted in Settings): the built-in one runs, now and on later starts,
 *  until its code changes or the person asks for it again. */
export function frameFailed(hash: string, why: string, persist = true) {
  if (persist) keep({ ...kept(), failed: { hash, why: why.slice(0, 200) }, starting: undefined });
  // only slow, perhaps: the built-in one for this session
  else { failedNow = { hash, why }; set({}); }
}
/** A frame that didn't start in time this session (it may only have been slow): the built-in one runs until restart. */
let failedNow: { hash: string; why: string } | null = null;
/** A frame from a vault is shown, in the foreground: if the app starts again with this mark still there, the app stopped
 *  while it showed (a page that hangs can't clear it; one that is left, hidden or closed does), and its card asks again. */
export function frameShown(hash: string) { const k = kept(); if (k.starting !== hash) keep({ ...k, starting: hash }); }
export function frameHidden(hash: string) { const k = kept(); if (k.starting === hash) keep({ ...k, starting: undefined }); }

export function setHome(key: string) { try { storage()?.setItem(HOME_KEY, key); } catch { /* session only */ } set({ read: null }); void readFrameRecord(); }

/** Allow what was just written, only if the vault holds exactly that: the built-in frame, in the note just written.
 *  Anything else (someone changed it in between) is the card's to ask about. */
async function allowWritten(noteId: string): Promise<void> {
  await readFrameRecord();
  const r = state.read;
  const home = homeVault();
  if (!home || r?.state !== "found" || r.vault !== home.key || r.noteId !== noteId || r.hash !== await defaultFrameHash()) return;
  const ok = await allowFrame(home.key, r.noteId, r.hash);
  if (!ok.ok) throw new Error(ok.error);
}

/** "Make this mine": copy the built-in frame into the home vault, as its record, and run it. */
export async function makeThisMine(): Promise<void> {
  const home = homeVault();
  if (!home) throw new Error("There's no home vault yet.");
  const based = await defaultFrameHash();
  const made = await clientFor(home).createNote({ path: FRAME_PATH, content: DEFAULT_FRAME_SOURCE, tags: [FRAME_TAG], metadata: { frame: { based_on: based } }, extension: "tsx" } as Parameters<ReturnType<typeof clientFor>["createNote"]>[0]);
  await allowWritten(made.id);
}

/** Take the newer built-in frame into the person's record. Their code is kept beside it, in a note of its own. */
export async function takeNewDefault(): Promise<void> {
  const home = homeVault();
  const r = state.read;
  if (!home || r?.state !== "found" || r.vault !== home.key) throw new Error("There's no frame of yours to update.");
  const c = clientFor(home);
  const day = new Date().toISOString().slice(0, 10);
  await c.createNote({ path: `${r.path} (yours, ${day})`, content: r.source, extension: r.kind } as Parameters<typeof c.createNote>[0]);
  const based = await defaultFrameHash();
  await c.updateNote(r.noteId, { content: DEFAULT_FRAME_SOURCE, metadata: { frame: { based_on: based } }, ...(r.updatedAt ? { if_updated_at: r.updatedAt } : {}) });
  await allowWritten(r.noteId);
}
/** Keep their frame as it is: this newer built-in frame isn't offered again. */
export function keepMine(defaultHash: string) { keep({ ...kept(), keptMine: defaultHash }); }

/** Is a newer built-in frame on offer? The record was copied from another built-in frame, and they didn't say keep mine. */
export function proposal(s: State = state, k: Kept = kept()): boolean {
  return s.read?.state === "found" && !!s.defaultHash && s.read.basedOn !== null && s.read.basedOn !== s.defaultHash && k.keptMine !== s.defaultHash;
}

// ── a link out from a frame of the person's: the shell shows the whole address first ──

/** After the question is answered, no new one for longer than a tap lasts (5 s): the next asks need a new tap in the frame. */
export const LINK_OUT_REST_MS = 6_000;
/** Open counts only for a tap that began this long after the question was on screen (FrameArea's LinkOutQuestion):
 *  the second tap of a double tap can't answer it, even if the frame held the page up between the two. */
export const LINK_OUT_HOLD_MS = 700;
let pendingOpen: ((open: boolean) => void) | null = null;
let restUntil = 0;
/** Ask the person, on the shell's own screen, before a frame from a vault opens an address outside the app. One
 *  question at a time (a new ask while one is up is refused, never swapped in), and none for a while after. */
export function confirmLinkOut(url: string, now: () => number = Date.now): Promise<boolean> {
  if (pendingOpen || now() < restUntil) return Promise.resolve(false);
  return new Promise((res) => {
    pendingOpen = (open) => { pendingOpen = null; restUntil = now() + LINK_OUT_REST_MS; set({ linkOut: null }); res(open); };
    set({ linkOut: url });
  });
}
/** The person's answer. */
export function answerLinkOut(open: boolean) { pendingOpen?.(open); }
/** Ask the person, on the shell's own sheet, before a frame from a vault writes into their vault (bringing something
 *  in, adding to home: docs/design/EMBED.md). The same one-at-a-time rule and timing as a link out. */
export function confirmWrite(q: WriteAsk, now: () => number = Date.now): Promise<boolean> {
  if (pendingOpen || now() < restUntil) return Promise.resolve(false);
  return new Promise((res) => {
    pendingOpen = (yes) => { pendingOpen = null; restUntil = now() + LINK_OUT_REST_MS; set({ writeAsk: null }); res(yes); };
    set({ writeAsk: q });
  });
}

const subscribe = (f: () => void) => {
  listeners.add(f);
  const a = subscribeGate(f), b = subscribeVaults(f);
  return () => { listeners.delete(f); a(); b(); };
};
export function useFrameSource() {
  useSyncExternalStore(subscribe, () => `${state.rev}:${gate()}:${homeVault()?.key ?? ""}`);
  const k = kept();
  return { choice: currentChoice(), read: state.read, reading: state.reading, failedWhy: k.failed?.why ?? failedNow?.why ?? "", proposal: proposal(), defaultHash: state.defaultHash, linkOut: state.linkOut, writeAsk: state.writeAsk };
}
