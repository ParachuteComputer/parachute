// The frame's side of the bridge (bridge/protocol.ts): one typed call to the shell, and the shell's events. The frame
// has no other way to the vaults, the person's choices or the app's address.
import { PF, type Events, type Method, type Params, type Result } from "../bridge/protocol";

type Pending = { res: (v: unknown) => void; rej: (e: Error) => void };
const pending = new Map<string, Pending>();
const listeners = new Map<string, Set<(d: unknown) => void>>();
let n = 0;

addEventListener("message", (e: MessageEvent) => {
  if (e.source !== parent) return;
  const m = e.data as { pf?: unknown; id?: unknown; result?: unknown; error?: unknown; event?: unknown; data?: unknown } | null;
  if (!m || typeof m !== "object" || m.pf !== PF) return;
  if (typeof m.event === "string") { listeners.get(m.event)?.forEach((f) => f(m.data)); return; }
  const p = typeof m.id === "string" ? pending.get(m.id) : undefined;
  if (!p) return;
  pending.delete(m.id as string);
  if (typeof m.error === "string") p.rej(Object.assign(new Error(m.error), { code: m.error })); else p.res(m.result);
});

export function call<M extends Method>(method: M, params: Params<M>): Promise<Result<M>> {
  return new Promise((res, rej) => {
    const id = `c${++n}`;
    pending.set(id, { res: res as (v: unknown) => void, rej });
    parent.postMessage({ pf: PF, id, method, params }, "*");
  });
}

export function on<E extends keyof Events>(event: E, f: (d: Events[E]) => void): () => void {
  const set = listeners.get(event) ?? new Set();
  listeners.set(event, set);
  const g = f as (d: unknown) => void;
  set.add(g);
  return () => { set.delete(g); };
}

/** Tell the shell the frame is listening: it answers with the current address. */
export const hello = () => parent.postMessage({ pf: PF, hello: 1 }, "*");
