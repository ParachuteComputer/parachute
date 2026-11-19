// saved module: what the kit saves for an applet as the person goes (docs/WRITE-AN-APPLET.md "Saved state"): its drafts,
// the screen it was on, where it was scrolled. Every applet that runs has it, someone else's too: it is the applet's
// own data on the person's own device. The kit sends what changed within 300 ms, and the shell writes it to this
// device's disk at once (shell/saved.ts); the whole store comes back in `ready` when the applet starts again, whether
// it was hidden, unloaded, the app closed or the phone restarted. The same store as `storage` (modules/storage.ts).
//   saved.put({bytes})   → null. bytes: an ArrayBuffer of a JSON object {key: value | null}; null removes a key. Keys are
//                          1 to 100 characters. Refused (too_large), with nothing changed, past 256 KB in all.
//   saved.all()          → everything it saved
import { ContractError, ERROR_CODES, hasHidden, hasOnly, plain, withinBudget } from "../contract.ts";
import type { UniModule } from "../router.ts";
import { asJson, STORAGE_KEY_MAX } from "../files.ts";

export const SAVED_LIMIT = 256 * 1024;
/** Most keys one put may change. */
const MAX_KEYS = 64;
export type SavedDeps = { all(): Promise<Record<string, unknown>>; put(entries: Record<string, unknown>): Promise<"ok" | "full"> };

const keyOk = (k: string) => k.length >= 1 && k.length <= STORAGE_KEY_MAX && !hasHidden(k);

export function createSavedModule(deps: SavedDeps): UniModule {
  return {
    namespace: "saved",
    methods: {
      put: {
        cap: null,
        validate: (p) => {
          if (!plain(p) || !hasOnly(p, ["bytes"]) || !(p.bytes instanceof ArrayBuffer)) return { ok: false };
          if (p.bytes.byteLength > SAVED_LIMIT) throw new ContractError(ERROR_CODES.tooLarge, "what it saves on this device is full (256 KB)");
          let raw: unknown;
          try { raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(p.bytes)); } catch { return { ok: false }; }
          if (!plain(raw)) return { ok: false };
          const keys = Object.keys(raw);
          if (!keys.length || keys.length > MAX_KEYS || !keys.every(keyOk)) return { ok: false };
          const entries: Record<string, unknown> = {};
          for (const k of keys) {
            const v = raw[k] === null ? null : asJson(raw[k]);
            // nested no deeper than a value sent as parameters may be, so what is kept can always be handed back
            if (v === undefined || (v !== null && !withinBudget(v, { left: Infinity }, 2))) return { ok: false };
            entries[k] = v;
          }
          return { ok: true, value: entries };
        },
        run: async (entries: Record<string, unknown>) => {
          if ((await deps.put(entries)) === "full") throw new ContractError(ERROR_CODES.tooLarge, "what it saves on this device is full (256 KB)");
          return null;
        },
      },
      all: { cap: null, validate: (p) => (plain(p) && hasOnly(p, []) ? { ok: true, value: null } : { ok: false }), run: async () => deps.all() },
    },
  };
}
