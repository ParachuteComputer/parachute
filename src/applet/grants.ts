// The grant store (copied from the Uni app's src/interface/grants.ts): which applet the person has allowed, under
// what (the hash of the grant: what it reaches and what it opens) and for which code (code.ts `codeHash`, the last one
// they allowed; the field is still named `html`). The subject is the vault plus the applet's note id. A different grant
// key is `none` (ask again). Only the code changing is `updated`. A grant carries an expiry (grant.ts `grantExpiry`); past it, `none`.
// Kept in this app's storage under its own key; storage is injectable.

export const GRANTS_KEY = "parachute.applets.grants.v1";
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type GrantedUnder = "sealed" | "approved-code";
/** `face` and `others` (face.ts): what the card said and the imports from someone else's vault, when it was allowed;
 *  kept to mark what is new when it asks again. A grant made before them has neither (the card then says it plainly). */
type Record_ = { scope: string; html: string; grantedAt: string; grantedUnder: GrantedUnder; expires?: string; face?: string[]; others?: string[] };
export type Asked = { face: string[]; others: string[] };
const strings = (x: unknown): string[] | undefined => (Array.isArray(x) && x.length <= 200 && x.every((v) => typeof v === "string" && v.length <= 4000) ? x as string[] : undefined);
/** What a grant is stored under: the vault (this device's key for it) and the applet's note. */
export const subjectOf = (vaultKey: string, subject: string) => `${vaultKey}\u0000${subject}`;
export type GrantStatus = "none" | "ok" | "updated";

export function createGrantStore(storage: StorageLike | null = typeof localStorage === "undefined" ? null : localStorage, now: () => number = Date.now) {
  // Kept in memory too, so a failing or missing storage still works for this session.
  let memory: Map<string, Record_> | null = null;
  const read = (): Map<string, Record_> => {
    if (memory) return memory;
    const parsed = new Map<string, Record_>();
    try {
      const v: unknown = JSON.parse(storage?.getItem(GRANTS_KEY) ?? "{}");
      if (v && typeof v === "object" && !Array.isArray(v)) {
        for (const [k, r] of Object.entries(v as Record<string, unknown>)) {
          const rec = r as { scope?: unknown; html?: unknown; grantedAt?: unknown; grantedUnder?: unknown; expires?: unknown; face?: unknown; others?: unknown } | null;
          const face = strings(rec?.face), others = strings(rec?.others);
          if (rec && typeof rec.scope === "string" && typeof rec.html === "string") parsed.set(k, { scope: rec.scope, html: rec.html, grantedAt: typeof rec.grantedAt === "string" ? rec.grantedAt : "", grantedUnder: rec.grantedUnder === "approved-code" ? "approved-code" : "sealed",
            // an expiry that can't be read is an expired one: never a grant with no end
            ...(rec.expires === undefined ? {} : { expires: typeof rec.expires === "string" && !isNaN(Date.parse(rec.expires)) ? rec.expires : new Date(0).toISOString() }),
            ...(face && others ? { face, others } : {}) });
        }
      }
    } catch { parsed.clear(); }
    return (memory = parsed);
  };
  const listeners = new Set<() => void>();
  const write = () => { try { storage?.setItem(GRANTS_KEY, JSON.stringify(Object.fromEntries(read()))); } catch { /* session only */ } listeners.forEach((f) => { try { f(); } catch { /* one listener's failure is its own */ } }); };
  return {
    status(subject: string, scope: string, html: string): GrantStatus {
      const r = read().get(subject);
      if (!r || r.scope !== scope || (r.expires !== undefined && Date.parse(r.expires) <= now())) return "none";
      return r.html === html ? "ok" : "updated";
    },
    /** When it was allowed and when it ends, for the card; null without a grant. */
    record(subject: string): { grantedAt: string; expires: string | null; scope: string; code: string; asked: Asked | null } | null {
      const r = read().get(subject);
      return r ? { grantedAt: r.grantedAt, expires: r.expires ?? null, scope: r.scope, code: r.html, asked: r.face && r.others ? { face: r.face, others: r.others } : null } : null;
    },
    /** The gate mode the grant was made under; a record without one (or with an unknown value) counts as `sealed`. */
    grantedUnder(subject: string): GrantedUnder | null { return read().get(subject)?.grantedUnder ?? null; },
    /** `expires`: when it ends, made from the moment it was allowed (grant2.ts `grantExpiry`). */
    /** `asked`: what its card said (face.ts), kept to mark what is new next time. */
    grant(subject: string, scope: string, html: string, mode: GrantedUnder = "sealed", expires?: (from: Date) => Date, asked?: Asked): void {
      const at = new Date(now());
      read().set(subject, { scope, html, grantedAt: at.toISOString(), grantedUnder: mode, ...(expires ? { expires: expires(at).toISOString() } : {}), ...(asked ? { face: [...asked.face], others: [...asked.others] } : {}) }); write();
    },
    revoke(subject: string): void { read().delete(subject); write(); },
    /** Called after any grant or revoke (the notification list follows the grants: services/notify.ts). */
    onChange(f: () => void): () => void { listeners.add(f); return () => { listeners.delete(f); }; },
    /** Every subject with a grant. */
    subjects(): string[] { return [...read().keys()]; },
  };
}
export type GrantStore = ReturnType<typeof createGrantStore>;

let device: GrantStore | null = null;
/** This device's grants: one store for the whole app (a second one over the same storage would write over the first). */
export const deviceGrants = (): GrantStore => (device ??= createGrantStore());
