// Settings → Approving code (docs/design/APP-RECORD.md): what an Allow does on a device with the person's key, and, for
// someone who keeps a root key, its public half (the anchor): then only the keys on the list it signed count. The
// anchor is a public key kept on this device (it can only narrow which keys count). What approving asks (the unlock, or
// the passcode too) is Settings → Security's (SecuritySettings.tsx).
import { useEffect, useState } from "react";
import { nativeNow, type Native } from "../services/native";
import { anchorNow, forgetOwnKey, ownKey, setAnchor } from "../applet/approvalStore";
import { homeVault } from "../shell/frameSource";
import { useVaults } from "../vault/hooks";
import { npubEncode } from "nostr-tools/nip19";
import { shortNpub } from "./key";

const said = (e: unknown) => (e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e));

export default function ApprovalSettings() {
  const home = homeVault(useVaults());
  const [native, setNative] = useState<Native | null>(null);
  const [own, setOwn] = useState<string | null>(null);
  const [anchor, setAnchorText] = useState("");
  const [, setRev] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => { void nativeNow().then(async (n) => { setNative(n); if (n) { forgetOwnKey(); setOwn(await ownKey()); } }); }, []);
  if (!native || !home || !own) return null;
  const held = anchorNow();
  const run = (f: () => Promise<unknown>, ok: string) => { setError(null); setDone(null); f().then(() => { setDone(ok); setRev((r) => r + 1); }, (e: unknown) => setError(said(e))); };
  return (
    <section className="card" aria-labelledby="s-approving">
      <h2 id="s-approving">Approving code</h2>
      <p className="small">When you allow an applet here, Parachute signs that exact version with your key, after this device's unlock, and keeps the approval in <strong>{home.vault}</strong>. Your other devices with your key check it and run that version without asking. Changed code waits until you approve it again, on any one of them. What approving asks is in Security, above.</p>
      <details className="small"><summary>Details</summary>Your key: <code>{shortNpub(npubEncode(own))}</code></details>
      <h3>Root key</h3>
      <p className="small">{held ? <>This device checks your key list against your root key: only the keys it names can approve.</> : <>Only if you keep a root key (written down, never on a device): its public half here means only the keys on the list it signs can approve.</>}</p>
      {held && <details className="small"><summary>Details</summary>Your root key: <code>{shortNpub(npubEncode(held))}</code></details>}
      {held ? <button type="button" className="quiet-button" onClick={() => run(async () => setAnchor(null), "Root key removed from this device.")}>Remove it from this device</button>
        : <form className="row-buttons" onSubmit={(e) => { e.preventDefault(); run(async () => { setAnchor(anchor); setAnchorText(""); }, "Root key kept on this device."); }}>
          <input className="text-input" aria-label="Your root key's public half" placeholder="npub1…" value={anchor} onChange={(e) => setAnchorText(e.target.value.trim())} autoCapitalize="off" spellCheck={false} />
          <button type="submit" className="quiet-button" disabled={!anchor}>Keep it</button>
        </form>}
      {done && <p className="small" role="status">{done}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
