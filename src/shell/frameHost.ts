// The shell's side of the bridge (bridge/protocol.ts). It answers the frame's calls from what the shell holds, and
// never with a token, a client id or a grant. A tap counts only when the shell itself sees the person's live user
// activation (a tap inside the frame gives it to the shell too; a script's click doesn't): that is what lets an applet
// start (open/mark.ts). Everything is injected, so tests can play a hostile frame against it.
import type { VaultClient } from "@openparachute/surface-client";
import { allowedDestination, parseRequest, PF, type Events, type FrameApplets, type FrameVault, type Method, type Query } from "../bridge/protocol";
import type { VaultRecord } from "../vault/store";

export type HostDeps = {
  vaults(): VaultRecord[];
  client(rec: VaultRecord): Pick<VaultClient, "queryNotes" | "getNote">;
  roles(rec: VaultRecord): Promise<string[]>;
  applets(rec: VaultRecord, fresh: boolean): Promise<FrameApplets>;
  defaults: { get(vault: string): Record<string, string>; set(vault: string, type: string, choice: string | null): void };
  go(to: string, replace: boolean): void;
  back(): void;
  /** Is the person tapping right now (live user activation in the shell's own window)? */
  tapNow(): boolean;
  mark: { tap(path: string): void; carry(from: string, to: string): boolean; clear(): void };
  copy(text: string): Promise<boolean>;
  openOut(url: string): void;
  /** For errors from the vault: a message for the person. */
  message(e: unknown): string;
};

export const frameVault = (r: VaultRecord): FrameVault => {
  let host = r.issuer;
  try { host = new URL(r.issuer).host; } catch { /* as given */ }
  return { key: r.key, vault: r.vault, host, issuer: r.issuer };
};

const pathOf = (to: string) => new URL(to, "http://app.invalid").pathname;

export function createFrameHost(post: (m: unknown) => void, deps: HostDeps) {
  const vault = (key: string) => {
    const rec = deps.vaults().find((r) => r.key === key);
    if (!rec) throw new Error("This device doesn't hold that vault.");
    return rec;
  };
  const run = async (method: Method, p: Record<string, unknown>): Promise<unknown> => {
    switch (method) {
      case "vaults.list": return deps.vaults().map(frameVault);
      case "vault.query": return deps.client(vault(p.vault as string)).queryNotes(p.query as Query);
      case "vault.note": {
        try { return await deps.client(vault(p.vault as string)).getNote(p.id as string); } catch (e) { if ((e as { status?: number } | null)?.status === 404) return null; throw e; }
      }
      case "vault.roles": return deps.roles(vault(p.vault as string)).catch(() => null);
      case "applets.list": return deps.applets(vault(p.vault as string), p.fresh as boolean);
      case "defaults.get": vault(p.vault as string); return deps.defaults.get(p.vault as string);
      case "defaults.set": vault(p.vault as string); deps.defaults.set(p.vault as string, p.type as string, p.choice as string | null); return null;
      case "nav.go": {
        const to = p.to as string;
        if (!allowedDestination(to)) throw new Error("not_allowed");
        const from = p.carryFrom as string | undefined;
        // a tap marks where it leads; the note's route may carry that mark on to the applet it opens, once
        if (from !== undefined) deps.mark.carry(from, pathOf(to));
        else if (deps.tapNow()) deps.mark.tap(pathOf(to));
        else deps.mark.clear();
        deps.go(to, p.replace === true);
        return null;
      }
      case "nav.back": deps.back(); return null;
      case "clipboard.write": return deps.tapNow() ? deps.copy(p.text as string) : false;
      case "link.out": {
        const url = p.url as string;
        if (!deps.tapNow() || !/^https?:\/\//i.test(url)) return false;
        deps.openOut(url);
        return true;
      }
    }
  };
  return {
    handle(data: unknown) {
      const req = parseRequest(data);
      if ("error" in req) { if (req.id) post({ pf: PF, id: req.id, error: req.error }); return; }
      run(req.method, req.params).then(
        (result) => post({ pf: PF, id: req.id, result: result ?? null }),
        (e: unknown) => post({ pf: PF, id: req.id, error: e instanceof Error && e.message === "not_allowed" ? "not_allowed" : deps.message(e) }),
      );
    },
    event<E extends keyof Events>(event: E, data: Events[E]) { post({ pf: PF, event, data }); },
  };
}
export type FrameHostApi = ReturnType<typeof createFrameHost>;
