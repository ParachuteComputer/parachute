// The Techne write capabilities an applet holds (docs/design/TECHNE.md "Read on the card, each write at first use").
// On a device with the person's key, a capability is held while its own signed approval says so: the applet's
// approval subject with the record `<record id>.techne.<capability>`, the applet's code hash, and the scope
// `techne:<capability>:<the applet's asks hash>` (techne.ts capRecord, capScope), checked by approvals.ts `decide` on
// every call. So it names exactly one capability, ends with changed code or a changed card, can't be put back once
// taken back (the floor), and follows the person to every device. A device without the key keeps the grant on the
// device only, bound to the grant's key (as it keeps its own Allow). Either way this device keeps a note of what it
// last saw held, for Settings to list.
import type { TechneCap } from "./techne.ts";
import { deviceGrants } from "./grants.ts";

/** The signed side, on a device with the person's key: does the capability's approval run, and sign one (or a taking
 *  back). Built over approvalStore.ts by the shell (shell/techneDeps.ts). */
export type Signed = { holds(cap: TechneCap): Promise<boolean>; /** whether it reached the home vault */ sign(cap: TechneCap, approved: boolean): Promise<boolean> };

type StorageLike = Pick<Storage, "getItem" | "setItem">;
export const TECHNE_KEY = "parachute.techne.v1";
/** subject → capability → the grant key it was held under, and when. */
/** `local`: signed here but not written to the home vault (it may be read only), so held on this device alone. */
type Kept = Record<string, Record<string, { key: string; at: string; local?: true }>>;

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
          if (x && typeof x.key === "string" && typeof x.at === "string") (out[s] ??= {})[c] = { key: x.key, at: x.at, ...((x as { local?: unknown }).local === true ? { local: true as const } : {}) };
        }
      }
    }
    return (memory = out);
  };
  const listeners = new Set<() => void>();
  const write = () => { try { storage?.setItem(TECHNE_KEY, JSON.stringify(read())); } catch { /* this session */ } listeners.forEach((f) => { try { f(); } catch { /* its own */ } }); };
  const keep = (subject: string, cap: TechneCap, key: string, local = false) => {
    const m = read(), was = m[subject]?.[cap];
    if (was?.key === key && !!was.local === local) return;
    (m[subject] ??= {})[cap] = { key, at: was?.key === key ? was.at : new Date(now()).toISOString(), ...(local ? { local: true as const } : {}) }; write();
  };
  const drop = (subject: string, cap: TechneCap) => { const m = read(); if (!m[subject]?.[cap]) return; delete m[subject][cap]; if (!Object.keys(m[subject]).length) delete m[subject]; write(); };

  return {
    /** The write capabilities of `caps` this applet holds now. `key`: its grant key now (grant.ts `grantKey`). */
    async held(subject: string, key: string, caps: readonly TechneCap[], signed: Signed | null): Promise<Set<TechneCap>> {
      const out = new Set<TechneCap>();
      for (const cap of caps) {
        const note = read()[subject]?.[cap];
        if (signed) {
          // the signature decides; what this device saw is only for Settings to list, but one signed here that the home
          // vault couldn't take is held here alone
          if (await signed.holds(cap).catch(() => false)) { out.add(cap); keep(subject, cap, key); }
          else if (note?.local && note.key === key) out.add(cap);
          else drop(subject, cap);
        } else if (note?.key === key) out.add(cap);
      }
      return out;
    },
    /** The person said yes on the shell's sheet: sign it (the device unlock, or the passcode if set), or keep it here. */
    async grant(subject: string, key: string, cap: TechneCap, signed: Signed | null): Promise<void> {
      const written = signed ? await signed.sign(cap, true) : true;
      keep(subject, cap, key, !written);
    },
    /** Take one capability back: signed on a device with the key (every device stops), and dropped here at once. */
    async takeBack(subject: string, cap: TechneCap, signed: Signed | null): Promise<void> {
      drop(subject, cap);
      if (signed) await signed.sign(cap, false);
    },
    /** What this device last saw held, for Settings: [capability, since]. */
    listed(subject: string): [TechneCap, string][] { return Object.entries(read()[subject] ?? {}).map(([c, r]) => [c as TechneCap, r.at]); },
    /** The applet was revoked: nothing of it is kept here (its signed capabilities end with its own approval). */
    forget(subject: string): void { const m = read(); if (!m[subject]) return; delete m[subject]; write(); },
    /** Forget every applet no longer allowed here, however it was revoked (its menu, Settings, a vault signed out of). */
    keepOnly(allowed: ReadonlySet<string>): void { const m = read(); const gone = Object.keys(m).filter((s) => !allowed.has(s)); if (!gone.length) return; for (const s of gone) delete m[s]; write(); },
    onChange(f: () => void): () => void { listeners.add(f); return () => { listeners.delete(f); }; },
  };
}
export type TechneGrants = ReturnType<typeof createTechneGrants>;

let device: TechneGrants | null = null;
/** This device's: it follows the applet grants, so a Revoke anywhere forgets what the applet held on Techne. */
export const deviceTechne = (): TechneGrants => {
  if (device) return device;
  const t = createTechneGrants(), grants = deviceGrants();
  t.keepOnly(new Set(grants.subjects()));
  grants.onChange(() => t.keepOnly(new Set(grants.subjects())));
  return (device = t);
};
