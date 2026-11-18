// The shell's side of the bridge (bridge/protocol.ts). It answers the frame's calls from what the shell holds, and
// never with a token, a client id or a grant. A tap counts only when the shell itself sees the person's live user
// activation (a tap inside the frame gives it to the shell too; a script's click doesn't): that is what lets an applet
// start (open/mark.ts). Everything is injected, so tests can play a hostile frame against it.
import { originOf } from "../vault/store";
import type { VaultClient } from "@openparachute/surface-client";
import { RateLimiter } from "../applet/contract";
import { allowedDestination, FRAME_LIMITS, parseRequest, PF, type Events, type FrameApplets, type FrameHome, type FrameComponents, type FramePointer, type FrameVault, type Decided, type Method, type Query } from "../bridge/protocol";
import type { VaultRecord } from "../vault/store";
export { FRAME_LIMITS };

export type HostDeps = {
  vaults(): VaultRecord[];
  client(rec: VaultRecord): Pick<VaultClient, "queryNotes" | "getNote">;
  roles(rec: VaultRecord): Promise<string[]>;
  applets(rec: VaultRecord, fresh: boolean): Promise<FrameApplets>;
  /** `set` refuses (throws) a choice that names no applet of that vault, or one too many. */
  defaults: { get(vault: string): Record<string, string>; set(vault: string, type: string, choice: string | null): void };
  /** The bar and the home; `pin` and `start` write the person's settings note (only ever called during a tap). */
  home: { get(): FrameHome; pin(vault: string, noteId: string, on: boolean): Promise<void>; start(vault: string, noteId: string | null): Promise<void>;
    /** Write a pointer to that applet or component in the home vault (only ever called during a tap). */
    bringIn(vault: string, noteId: string): Promise<void>;
    /** Put that component on the home applet's page (only ever called during a tap). */
    addEmbed(vault: string, noteId: string): Promise<"added" | "already"> };
  components(rec: VaultRecord): Promise<FrameComponents>;
  pointers(): Promise<FramePointer[]>;
  go(to: string, replace: boolean): void;
  /** The shell's address now (its path). */
  here(): string;
  back(): void;
  /** Keep what the note's route decided for a history entry. */
  decide(key: string, kind: Decided): void;
  /** Is the person tapping right now (live user activation in the shell's own window)? */
  tapNow(): boolean;
  mark: { tap(path: string): void; carry(from: string, to: string): boolean; clear(): void };
  copy(text: string): Promise<boolean>;
  /** Open it (or, for a frame of the person's, ask first): whether it was opened. */
  openOut(url: string): Promise<boolean>;
  /** Whose each vault is (vault/whose.ts), and the home vault's key. */
  whose?(r: VaultRecord): FrameVault["whose"];
  homeKey?(): string | null;
  /** For errors from the vault: a message for the person. */
  message(e: unknown): string;
  now?: () => number;
};

/** The addresses a link out may open: the web, mail and phone. */
export const LINK_OUT = /^(https?:\/\/|mailto:|tel:)/i;

export const frameVault = (r: VaultRecord, whose?: FrameVault["whose"], home?: boolean): FrameVault => {
  let host = r.issuer;
  try { host = new URL(r.issuer).host; } catch { /* as given */ }
  return { key: r.key, vault: r.vault, host, issuer: r.issuer, hub: originOf(r.issuer), ...(whose ? { whose } : {}), ...(home ? { home: true } : {}) };
};

const pathOf = (to: string) => new URL(to, "http://app.invalid").pathname;

export function createFrameHost(post: (m: unknown) => void, deps: HostDeps) {
  const limiter = new RateLimiter(FRAME_LIMITS.perWindow, FRAME_LIMITS.windowMs);
  const now = deps.now ?? Date.now;
  let pending = 0;
  const vault = (key: string) => {
    const rec = deps.vaults().find((r) => r.key === key);
    if (!rec) throw new Error("This device doesn't hold that vault.");
    return rec;
  };
  const run = async (method: Method, p: Record<string, unknown>): Promise<unknown> => {
    switch (method) {
      case "vaults.list": return deps.vaults().map((r) => frameVault(r, deps.whose?.(r), deps.homeKey?.() === r.key));
      case "vault.query": return deps.client(vault(p.vault as string)).queryNotes(p.query as Query);
      case "vault.note": {
        try { return await deps.client(vault(p.vault as string)).getNote(p.id as string); } catch (e) { if ((e as { status?: number } | null)?.status === 404) return null; throw e; }
      }
      case "vault.roles": return deps.roles(vault(p.vault as string)).catch(() => null);
      case "applets.list": return deps.applets(vault(p.vault as string), p.fresh as boolean);
      case "defaults.get": vault(p.vault as string); return deps.defaults.get(p.vault as string);
      case "defaults.set": vault(p.vault as string); if (!deps.tapNow()) throw new Error("not_allowed"); deps.defaults.set(p.vault as string, p.type as string, p.choice as string | null); return null;
      case "home.get": return deps.home.get();
      case "home.pin": vault(p.vault as string); if (!deps.tapNow()) throw new Error("not_allowed"); await deps.home.pin(p.vault as string, p.noteId as string, p.on as boolean); return null;
      case "home.start": vault(p.vault as string); if (!deps.tapNow()) throw new Error("not_allowed"); await deps.home.start(p.vault as string, p.noteId as string | null); return null;
      case "pointers.list": return deps.pointers();
      case "home.bringIn": vault(p.vault as string); if (!deps.tapNow()) throw new Error("not_allowed"); await deps.home.bringIn(p.vault as string, p.noteId as string); return null;
      case "home.addEmbed": vault(p.vault as string); if (!deps.tapNow()) throw new Error("not_allowed"); return deps.home.addEmbed(p.vault as string, p.noteId as string);
      case "components.list": return deps.components(vault(p.vault as string));
      case "nav.go": {
        const to = p.to as string;
        if (!allowedDestination(to)) throw new Error("not_allowed");
        const from = p.carryFrom as string | undefined;
        // a tap marks where it leads; the note's route may carry that mark on to the applet it opens, once
        // a carry is the note's route sending the person on: only from where they still are
        if (from !== undefined && from !== deps.here()) throw new Error("not_allowed");
        if (from !== undefined) deps.mark.carry(from, pathOf(to));
        else if (deps.tapNow()) deps.mark.tap(pathOf(to));
        else deps.mark.clear();
        deps.go(to, p.replace === true);
        return null;
      }
      case "nav.back": deps.back(); return null;
      case "nav.decided": deps.decide(p.key as string, p.kind as Decided); return null;
      case "clipboard.write": return deps.tapNow() ? deps.copy(p.text as string) : false;
      case "link.out": {
        const url = p.url as string;
        if (!deps.tapNow() || !LINK_OUT.test(url)) return false;
        return deps.openOut(url);
      }
    }
  };
  return {
    handle(data: unknown) {
      const req = parseRequest(data);
      if ("error" in req) { if (req.id) post({ pf: PF, id: req.id, error: req.error }); return; }
      if (pending >= FRAME_LIMITS.pending || !limiter.take(now())) { post({ pf: PF, id: req.id, error: "rate_limited" }); return; }
      pending++;
      run(req.method, req.params).finally(() => { pending--; }).then(
        (result) => post({ pf: PF, id: req.id, result: result ?? null }),
        (e: unknown) => post({ pf: PF, id: req.id, error: e instanceof Error && e.message === "not_allowed" ? "not_allowed" : deps.message(e) }),
      );
    },
    event<E extends keyof Events>(event: E, data: Events[E]) { post({ pf: PF, event, data }); },
  };
}
export type FrameHostApi = ReturnType<typeof createFrameHost>;
