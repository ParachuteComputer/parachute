// The Techne write capabilities an applet holds (docs/design/TECHNE.md "Read on the card, each write at first use").
// On a device with the person's key, a capability is held while its own signed approval says so: the applet's
// approval subject with the record `<record id>.techne.<capability>`, the applet's code hash, and the scope
// `techne:<capability>:<the applet's asks hash>` (techne.ts capRecord, capScope), checked by approvals.ts `decide` on
// every call. So it names exactly one capability, ends with changed code or a changed card, can't be put back once
// taken back (the floor), and follows the person to every device. A device without the key keeps the grant on the
// device only, bound to the grant's key (as it keeps its own Allow). Either way this device keeps a note of what it
// last saw held, for Settings to list.
import type { TechneCap } from "./techne.ts";

/** The signed side, on a device with the person's key: does the capability's approval run, and sign one (or a taking
 *  back). Built over approvalStore.ts by the shell (shell/techneDeps.ts). */
export type Signed = { holds(cap: TechneCap): Promise<boolean>; sign(cap: TechneCap, approved: boolean): Promise<void> };

type StorageLike = Pick<Storage, "getItem" | "setItem">;
export const TECHNE_KEY = "parachute.techne.v1";
/** subject → capability → the grant key it was held under, and when. */
type Kept = Record<string, Record<string, { key: string; at: string }>>;

export function createTechneGrants(storage: StorageLike | null = typeof localStorage === "undefined" ? null : localStorage, now: () => number = Date.now) {
  let memory: Kept | null = null;
  const read = (): Kept => {
    if (memory) return memory;
    let v: unknown = {};
    try { v = JSON.parse(storage?.getItem(TECHNE_KEY) ?? "{}"); } catch { v = {}; }
    const out: Kept = {};
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const [s, caps] of Object.entries(v as Record<string, unknown>)) {
        if (!caps || typeof caps !== "object" || Array.isArray(caps)) continue;
        for (const [c, r] of Object.entries(caps as Record<string, unknown>)) {
          const x = r as { key?: unknown; at?: unknown } | null;
          if (x && typeof x.key === "string" && typeof x.at === "string") (out[s] ??= {})[c] = { key: x.key, at: x.at };
        }
      }
    }
    return (memory = out);
  };
  const listeners = new Set<() => void>();
  const write = () => { try { storage?.setItem(TECHNE_KEY, JSON.stringify(read())); } catch { /* this session */ } listeners.forEach((f) => { try { f(); } catch { /* its own */ } }); };
  const keep = (subject: string, cap: TechneCap, key: string) => { const m = read(); if (m[subject]?.[cap]?.key === key) return; (m[subject] ??= {})[cap] = { key, at: new Date(now()).toISOString() }; write(); };
  const drop = (subject: string, cap: TechneCap) => { const m = read(); if (!m[subject]?.[cap]) return; delete m[subject][cap]; if (!Object.keys(m[subject]).length) delete m[subject]; write(); };

  return {
    /** The write capabilities of `caps` this applet holds now. `key`: its grant key now (grant.ts `grantKey`). */
    async held(subject: string, key: string, caps: readonly TechneCap[], signed: Signed | null): Promise<Set<TechneCap>> {
      const out = new Set<TechneCap>();
      for (const cap of caps) {
        if (signed) {
          // the signature decides; what this device saw is only for Settings to list
          if (await signed.holds(cap).catch(() => false)) { out.add(cap); keep(subject, cap, key); } else drop(subject, cap);
        } else if (read()[subject]?.[cap]?.key === key) out.add(cap);
      }
      return out;
    },
    /** The person said yes on the shell's sheet: sign it (the device unlock, or the passcode if set), or keep it here. */
    async grant(subject: string, key: string, cap: TechneCap, signed: Signed | null): Promise<void> {
      if (signed) await signed.sign(cap, true);
      keep(subject, cap, key);
    },
    /** Take one capability back: signed on a device with the key (every device stops), and dropped here at once. */
    async takeBack(subject: string, cap: TechneCap, signed: Signed | null): Promise<void> {
      drop(subject, cap);
      if (signed) await signed.sign(cap, false);
    },
    /** What this device last saw held, for Settings: [capability, since]. */
    listed(subject: string): [TechneCap, string][] { return Object.entries(read()[subject] ?? {}).map(([c, r]) => [c as TechneCap, r.at]); },
    /** The applet was revoked: nothing of it is kept here (its signed capabilities end with its code and card). */
    forget(subject: string): void { const m = read(); if (!m[subject]) return; delete m[subject]; write(); },
    onChange(f: () => void): () => void { listeners.add(f); return () => { listeners.delete(f); }; },
  };
}
export type TechneGrants = ReturnType<typeof createTechneGrants>;

let device: TechneGrants | null = null;
export const deviceTechne = (): TechneGrants => (device ??= createTechneGrants());
