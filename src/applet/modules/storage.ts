// storage module: a little room on this device for one applet (its drafts), for an applet that asked for `storage`
// (`metadata.app`, app.ts) and was allowed it (docs/design/KEYRING.md "Voice, files, links, storage"). Kept by the
// shell per applet (its grant's subject), 256 KB in all as JSON; never synced, never in a vault. It is the same store as
// the kit's saved state (modules/saved.ts, shell/saved.ts): one file per applet on a device.
//   storage.get({key})          → its value, or null
//   storage.set({key, value})   → null; a null value removes the key. Keys are 1 to 100 characters; values are JSON.
//   storage.set({key, bytes})   → the same, the value as JSON text in bytes (an ArrayBuffer): how the kit sends one, so a
//                                 value may be any size within the 256 KB, past the 8 KB a call's parameters may be
//   storage.keys()              → its keys, sorted
import { ContractError, ERROR_CODES, hasHidden, hasOnly, plain, withinBudget } from "../contract.ts";
import type { UniModule } from "../router.ts";
import { asJson, STORAGE_KEY_MAX, STORAGE_MAX, storageSize } from "../files.ts";

export type StorageDeps = { read(): Promise<Record<string, unknown>> | Record<string, unknown>; write(all: Record<string, unknown>): Promise<void> | void };

const keyOk = (k: unknown): k is string => typeof k === "string" && k.length >= 1 && k.length <= STORAGE_KEY_MAX && !hasHidden(k);

export function createStorageModule(allowed: boolean, deps: StorageDeps): UniModule {
  const need = () => { if (!allowed) throw new ContractError(ERROR_CODES.notGranted); };
  return {
    namespace: "storage",
    methods: {
      get: {
        cap: null,
        validate: (p) => { need(); return plain(p) && hasOnly(p, ["key"]) && keyOk(p.key) ? { ok: true, value: p.key } : { ok: false }; },
        run: async (key: string) => { const all = await deps.read(); return Object.hasOwn(all, key) ? all[key] : null; },
      },
      set: {
        cap: null,
        validate: (p) => {
          need();
          if (!plain(p) || !hasOnly(p, ["key", "value", "bytes"]) || !keyOk(p.key) || ("bytes" in p && "value" in p)) return { ok: false };
          if ("bytes" in p) {
            // checked for size before it is read: nothing bigger than all of its storage is decoded
            if (!(p.bytes instanceof ArrayBuffer)) return { ok: false };
            if (p.bytes.byteLength > STORAGE_MAX) throw new ContractError(ERROR_CODES.tooLarge, "its storage on this device is full (256 KB)");
            let value: unknown;
            try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(p.bytes)); } catch { return { ok: false }; }
            // nested no deeper than a value sent as parameters may be (at params.value, depth 2 of the call), so what is
            // kept can always be handed back
            return withinBudget(value, { left: Infinity }, 2) ? { ok: true, value: { key: p.key, value } } : { ok: false };
          }
          const value = p.value === null || p.value === undefined ? null : asJson(p.value);
          return value === undefined ? { ok: false } : { ok: true, value: { key: p.key, value } };
        },
        run: async ({ key, value }: { key: string; value: unknown }) => {
          // built from entries, so a key named __proto__ is a key like any other
          const next = Object.fromEntries([...Object.entries(await deps.read()).filter(([k]) => k !== key), ...(value !== null ? [[key, value] as const] : [])]);
          if (storageSize(next) > STORAGE_MAX) throw new ContractError(ERROR_CODES.tooLarge, "its storage on this device is full (256 KB)");
          await deps.write(next);
          return null;
        },
      },
      keys: { cap: null, validate: (p) => { need(); return plain(p) && hasOnly(p, []) ? { ok: true, value: null } : { ok: false }; }, run: async () => Object.keys(await deps.read()).filter((k) => !k.startsWith("parachute:")).sort() },
    },
  };
}
