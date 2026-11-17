// Trust: which other Parachutes this device lets code come in from inline (an import, docs/design/EMBED.md), each a
// hub's origin and a vault on it. Held on this device beside the grants, set only by the person's tap on the shell's
// trust card (Settings), never by a record or an agent: trusting a Parachute lets its code run inside the person's own
// applets, with everything they reach. A vault's own applets may always import from that same vault.

export const TRUST_KEY = "parachute.trust.v1";
type StorageLike = Pick<Storage, "getItem" | "setItem">;
export type Trusted = { hub: string; vault: string; at: string };

const originOf = (issuer: string) => { try { return new URL(issuer).origin; } catch { return issuer; } };

export function createTrustStore(storage: StorageLike | null = typeof localStorage === "undefined" ? null : localStorage, now: () => number = Date.now) {
  let memory: Trusted[] | null = null;
  const listeners = new Set<() => void>();
  const read = (): Trusted[] => {
    if (memory) return memory;
    try {
      const v: unknown = JSON.parse(storage?.getItem(TRUST_KEY) ?? "[]");
      memory = Array.isArray(v) ? v.filter((t): t is Trusted => !!t && typeof t.hub === "string" && typeof t.vault === "string").map((t) => ({ hub: originOf(t.hub), vault: t.vault, at: typeof t.at === "string" ? t.at : "" })) : [];
    } catch { memory = []; }
    return memory;
  };
  const write = (list: Trusted[]) => { memory = list; try { storage?.setItem(TRUST_KEY, JSON.stringify(list)); } catch { /* this session only */ } listeners.forEach((f) => f()); };
  return {
    list: () => [...read()],
    has: (hub: string, vault: string) => read().some((t) => t.hub === originOf(hub) && t.vault === vault),
    trust(hub: string, vault: string) { if (!this.has(hub, vault)) write([...read(), { hub: originOf(hub), vault, at: new Date(now()).toISOString() }]); },
    untrust(hub: string, vault: string) { write(read().filter((t) => !(t.hub === originOf(hub) && t.vault === vault))); },
    subscribe(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; },
  };
}
export type TrustStore = ReturnType<typeof createTrustStore>;
let device: TrustStore | null = null;
export const deviceTrust = (): TrustStore => (device ??= createTrustStore());
