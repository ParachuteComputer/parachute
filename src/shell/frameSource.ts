// Which frame runs: the built-in one, or the person's own, a record in their home vault. The shell never comes from a
// vault; the frame may. Copy-on-write: the built-in frame runs until the person (or their agent) makes a frame of their
// own, by "Make this mine" (which copies the built-in one into the home vault) or by writing the record. From then on
// it is theirs: a newer built-in frame is offered in Settings, never written over theirs.
//
//   home vault       the person's choice (Settings), else the first vault this device signed in to
//   the record       a note in the home vault tagged `parachute-frame`, extension tsx or jsx: one module whose default
//                    export is the frame. Its metadata `frame.based_on` names the built-in frame it was copied from.
//   runs when        the self-test has passed on this device (and isn't running), and the person allowed this exact
//                    code on the frame's card. Changed code shows the card again; until then the built-in frame runs.
//   offline          the last allowed copy (kept on this device) runs while the home vault can't be read.
import { useSyncExternalStore } from "react";
import defaultSource from "../frame/default-frame.tsx?raw";
import { codeHash, codeKindOf, prepare, type CodeKind } from "../applet/code";
import { gateNow, selfTestRunning, subscribeGate } from "../applet/selftest/run";
import { clientFor } from "../vault/client";
import { listVaults, subscribeVaults, type VaultRecord } from "../vault/store";

export const FRAME_TAG = "parachute-frame";
export const FRAME_PATH = "Parachute/Frame";
export const HOME_KEY = "parachute.home.v1";
export const FRAMES_KEY = "parachute.frames.v1";
export const DEFAULT_FRAME_SOURCE = defaultSource;
export const defaultFrameHash = (): Promise<string> => codeHash("tsx", DEFAULT_FRAME_SOURCE);

import { choose, type Choice, type Kept, type Read } from "./frameChoice";
export type { Choice, Kept, Read };

// ── what this device keeps ──

const storage = () => (typeof localStorage === "undefined" ? null : localStorage);
function readJson<T>(key: string, fallback: T): T { try { const v: unknown = JSON.parse(storage()?.getItem(key) ?? "null"); return v && typeof v === "object" ? (v as T) : fallback; } catch { return fallback; } }
const writeJson = (key: string, v: unknown) => { try { storage()?.setItem(key, JSON.stringify(v)); } catch { /* this session only */ } };

/** The home vault: the person's choice if this device still holds it, else the first vault it signed in to. */
export function homeVault(list: readonly VaultRecord[] = listVaults()): VaultRecord | null {
  let chosen: string | null = null;
  try { chosen = storage()?.getItem(HOME_KEY) ?? null; } catch { chosen = null; }
  return list.find((v) => v.key === chosen) ?? [...list].sort((a, b) => a.addedAt.localeCompare(b.addedAt))[0] ?? null;
}

// ── the store ──

type State = { read: Read | null; reading: boolean; defaultHash: string | null; rev: number };
let state: State = { read: null, reading: false, defaultHash: null, rev: 0 };
const listeners = new Set<() => void>();
const set = (p: Partial<State>) => { state = { ...state, ...p, rev: state.rev + 1 }; listeners.forEach((f) => f()); };
const kept = (): Kept => readJson<Kept>(FRAMES_KEY, {});
const keep = (k: Kept) => { writeJson(FRAMES_KEY, k); set({}); };
void defaultFrameHash().then((h) => set({ defaultHash: h }));

/** The gate is open for a frame from a vault: the self-test passed here and isn't running now (a frame mounted during
 *  the self-test could be taken for one of its probes). */
const gateOpen = () => !selfTestRunning() && gateNow() !== "closed";

export function currentChoice(): Choice {
  const home = homeVault();
  const k = kept();
  return choose({ gateOpen: gateOpen(), home: home?.key ?? null, read: state.read, kept: k, failed: k.failed?.hash ?? null });
}

/** Read the home vault's frame record again (at start, when the frame is shown again, and from Settings). */
export async function readFrameRecord(): Promise<void> {
  const home = homeVault();
  if (!home) { set({ read: { state: "none" } }); return; }
  set({ reading: true });
  let read: Read;
  try {
    const rows = await clientFor(home).queryNotes({ tag: FRAME_TAG, includeContent: true, includeMetadata: true, limit: 5 });
    const frames = rows.filter((r) => { const k = codeKindOf(r as { extension?: string }); return k === "tsx" || k === "jsx"; });
    if (!frames.length) read = rows.length ? { state: "bad", error: "its frame record isn't a tsx or jsx note" } : { state: "none" };
    else if (frames.length > 1) read = { state: "many", paths: frames.map((f) => f.path ?? f.id) };
    else {
      const f = frames[0];
      const kind = codeKindOf(f as { extension?: string }) as "tsx" | "jsx";
      const source = f.content ?? "";
      const meta = (f.metadata ?? {}) as { frame?: { based_on?: unknown } };
      read = { state: "found", noteId: f.id, path: f.path ?? f.id, kind, source, hash: await codeHash(kind, source),
        basedOn: typeof meta.frame?.based_on === "string" ? meta.frame.based_on : null, updatedAt: (f as { updatedAt?: string }).updatedAt ?? null };
    }
  } catch (e) {
    const status = (e as { status?: number } | null)?.status;
    read = status && status < 500 && status !== 408 && status !== 429 ? { state: "bad", error: e instanceof Error ? e.message : "it couldn't be read" } : { state: "unreachable" };
  }
  set({ read, reading: false });
}

/** The frame's code to run now: the built-in one, or the home vault's, transpiled (and cached against its hash). */
export async function frameCode(c: Choice): Promise<{ js: string; hash: string; from: "built-in" | "vault" } | { error: string }> {
  if (c.run === "vault") {
    if (c.js) return { js: c.js, hash: c.hash, from: "vault" };
    const r = state.read?.state === "found" && state.read.hash === c.hash ? state.read : null;
    if (!r) return { error: "its code isn't at hand" };
    const p = await prepare(r.source, r.kind);
    return p.compiled?.ok ? { js: p.compiled.js, hash: c.hash, from: "vault" } : { error: p.compiled && !p.compiled.ok ? p.compiled.error : "it couldn't be read" };
  }
  const p = await prepare(DEFAULT_FRAME_SOURCE, "tsx");
  if (!p.compiled?.ok) throw new Error("the built-in frame doesn't compile");
  return { js: p.compiled.js, hash: p.hash, from: "built-in" };
}

/** Allow the record's code as it is now (the card's Allow, or the person's own copy). Keeps the transpiled copy for offline. */
export async function allowFrame(vault: string, noteId: string, hash: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = state.read?.state === "found" && state.read.hash === hash ? state.read : null;
  if (!r) return { ok: false, error: "the frame changed again: look at it once more" };
  const p = await prepare(r.source, r.kind);
  if (!p.compiled?.ok) return { ok: false, error: `its code doesn't compile: ${p.compiled && !p.compiled.ok ? p.compiled.error : "?"}` };
  const k = kept();
  keep({ ...k, approved: { vault, noteId, hash, js: p.compiled.js }, declined: undefined, failed: undefined });
  return { ok: true };
}
/** Ask again about the person's frame: forget that they chose the built-in one, or that theirs stopped. */
export function askAgain() { keep({ ...kept(), declined: undefined, failed: undefined }); }
/** Signing out of a vault forgets the frame this device kept from it. */
export function forgetVaultFrame(vault: string) {
  const k = kept();
  keep({ ...k, ...(k.approved?.vault === vault ? { approved: undefined } : {}), ...(k.declined?.vault === vault ? { declined: undefined } : {}) });
  set({ read: null });
}
export function declineFrame(vault: string, noteId: string, hash: string) { keep({ ...kept(), declined: { vault, noteId, hash } }); }
/** Stop using the person's frame on this device: the built-in one runs until they allow theirs again. */
export function forgetFrame() { const k = kept(); keep({ ...k, approved: undefined, declined: state.read?.state === "found" && homeVault() ? { vault: homeVault()!.key, noteId: state.read.noteId, hash: state.read.hash } : k.declined }); }
/** The frame said it stopped: the built-in one runs (on later starts too, until its code changes or the person asks
 *  for it again), and the reason shows in Settings. */
export function frameFailed(hash: string, why: string) { keep({ ...kept(), failed: { hash, why } }); }

export function setHome(key: string) { try { storage()?.setItem(HOME_KEY, key); } catch { /* session only */ } set({ read: null }); void readFrameRecord(); }

/** "Make this mine": copy the built-in frame into the home vault, as its record, and run it. */
export async function makeThisMine(): Promise<void> {
  const home = homeVault();
  if (!home) throw new Error("There's no home vault yet.");
  const based = await defaultFrameHash();
  await clientFor(home).createNote({ path: FRAME_PATH, content: DEFAULT_FRAME_SOURCE, tags: [FRAME_TAG], metadata: { frame: { based_on: based } }, extension: "tsx" } as Parameters<ReturnType<typeof clientFor>["createNote"]>[0]);
  await readFrameRecord();
  const r = state.read;
  if (r?.state !== "found") throw new Error("The copy wasn't found in the vault after it was made.");
  const ok = await allowFrame(home.key, r.noteId, r.hash);
  if (!ok.ok) throw new Error(ok.error);
}

/** Take the newer built-in frame into the person's record. Their code is kept beside it, in a note of its own. */
export async function takeNewDefault(): Promise<void> {
  const home = homeVault();
  const r = state.read;
  if (!home || r?.state !== "found") throw new Error("There's no frame of yours to update.");
  const c = clientFor(home);
  const day = new Date().toISOString().slice(0, 10);
  await c.createNote({ path: `${r.path} (yours, ${day})`, content: r.source, extension: r.kind } as Parameters<typeof c.createNote>[0]);
  const based = await defaultFrameHash();
  await c.updateNote(r.noteId, { content: DEFAULT_FRAME_SOURCE, metadata: { frame: { based_on: based } }, ...(r.updatedAt ? { if_updated_at: r.updatedAt } : {}) });
  await readFrameRecord();
  const now = state.read;
  if (now?.state === "found") await allowFrame(home.key, now.noteId, now.hash);
}
/** Keep their frame as it is: this newer built-in frame isn't offered again. */
export function keepMine(defaultHash: string) { keep({ ...kept(), keptMine: defaultHash }); }

/** Is a newer built-in frame on offer? The record was copied from another built-in frame, and they didn't say keep mine. */
export function proposal(s: State = state, k: Kept = kept()): boolean {
  return s.read?.state === "found" && !!s.defaultHash && s.read.basedOn !== null && s.read.basedOn !== s.defaultHash && k.keptMine !== s.defaultHash;
}

const subscribe = (f: () => void) => {
  listeners.add(f);
  const a = subscribeGate(f), b = subscribeVaults(f);
  return () => { listeners.delete(f); a(); b(); };
};
export function useFrameSource() {
  useSyncExternalStore(subscribe, () => `${state.rev}:${gateOpen()}:${homeVault()?.key ?? ""}`);
  return { choice: currentChoice(), read: state.read, reading: state.reading, failedWhy: kept().failed?.why ?? "", proposal: proposal(), defaultHash: state.defaultHash, kind: (state.read?.state === "found" ? state.read.kind : null) as CodeKind | null };
}
