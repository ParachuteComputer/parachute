// What the web side may know of the keyring (docs/design/KEYRING.md): the public keys, whether the approval key is still
// the everyday key, and the device's list of keys trusted for approvals, by name. Read from the native side; the card
// uses it to name approvers ("Uni") and to say when the approval key is the everyday key.
import { useEffect, useState } from "react";
import { nativeNow, type KeyringStatus } from "./native";
import type { LineOptions } from "../applet/services";

let cached: Promise<KeyringStatus | null> | null = null;
/** The keyring now (null: no key here, or a browser). `fresh`: read again (after Settings changed it). */
export function keyringNow(fresh = false): Promise<KeyringStatus | null> {
  if (!cached || fresh) cached = nativeNow().then((n) => (n ? n.keyring().catch(() => null) : null));
  return cached;
}

export const lineOptions = (k: KeyringStatus | null): LineOptions => ({
  approvalSame: k?.same ?? true,
  approverName: (hex) => k?.approvers.find((a) => a.pubkey === hex)?.name ?? null,
});

export function useKeyring(): KeyringStatus | null {
  const [k, setK] = useState<KeyringStatus | null>(null);
  useEffect(() => { let on = true; void keyringNow().then((x) => { if (on) setK(x); }); return () => { on = false; }; }, []);
  return k;
}
