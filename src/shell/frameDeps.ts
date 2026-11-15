// The shell's real answers to the frame (frameHost.ts `HostDeps`), from what the shell holds.
import type { FrameApplets } from "../bridge/protocol";
import { appletsNow, refreshApplets } from "../applet/useApplets";
import { gateNow, whenGateKnown } from "../applet/selftest/run";
import { statusOf } from "../open/status";
import { readRoleTags } from "../open/roles";
import { clearDefault, defaultsFor, setDefault } from "../open/defaults";
import { carryMark, clearMark, markTap } from "../open/mark";
import { clientFor } from "../vault/client";
import { messageOf } from "../vault/hooks";
import { listVaults, type VaultRecord } from "../vault/store";
import type { HostDeps } from "./frameHost";

async function applets(rec: VaultRecord, fresh: boolean): Promise<FrameApplets> {
  // statuses are judged once the self-test's facts are known, so a note never opens plain only because the app had
  // not finished starting
  await whenGateKnown();
  const ok = fresh || !appletsNow(rec.key) ? await refreshApplets(rec) : true;
  const e = appletsNow(rec.key);
  if (!ok || e?.state !== "ok") return { ok: false, error: e?.state === "error" ? e.error : "the applets couldn't be read" };
  const status = statusOf(rec.key, gateNow());
  return {
    ok: true, skipped: e.found.skipped,
    entries: e.found.entries.map((a) => ({ noteId: a.noteId, path: a.path, vault: a.vault, opens: a.opens, status: status(a),
      manifest: { id: a.manifest.id, name: a.manifest.name, glyph: a.manifest.glyph, screens: a.manifest.screens } })),
  };
}

export function shellDeps(go: (to: string, replace: boolean) => void): HostDeps {
  return {
    vaults: listVaults,
    client: clientFor,
    roles: (rec) => readRoleTags(clientFor(rec)),
    applets,
    defaults: { get: defaultsFor, set: (v, t, c) => (c === null ? clearDefault(v, t) : setDefault(v, t, c)) },
    go,
    back: () => history.back(),
    tapNow: () => (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive === true,
    mark: { tap: markTap, carry: carryMark, clear: clearMark },
    copy: (text) => navigator.clipboard?.writeText(text).then(() => true, () => false) ?? Promise.resolve(false),
    openOut: (url) => { window.open(url, "_blank", "noopener,noreferrer"); },
    message: messageOf,
  };
}
