// Settings → Approving code (docs/design/APP-RECORD.md): what an Allow does on a device with the person's key, the
// passcode this device asks before approving (its own secret, never the phone's unlock), and, for someone who keeps a
// root key, its public half (the anchor): then only the keys on the list it signed count. The passcode is set natively,
// behind the device unlock; the anchor is a public key kept on this device (it can only narrow which keys count).
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
  const [hasCode, setHasCode] = useState(false);
  const [old, setOld] = useState("");
  const [next, setNext] = useState("");
  const [anchor, setAnchorText] = useState("");
  const [, setRev] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => { void nativeNow().then(async (n) => { setNative(n); if (n) { forgetOwnKey(); setOwn(await ownKey()); setHasCode(await n.passcodeStatus().catch(() => false)); } }); }, []);
  if (!native || !home || !own) return null;
  const held = anchorNow();
  const run = (f: () => Promise<unknown>, ok: string) => { setError(null); setDone(null); f().then(() => { setDone(ok); setRev((r) => r + 1); }, (e: unknown) => setError(said(e))); };
  return (
    <section className="card" aria-labelledby="s-approving">
      <h2 id="s-approving">Approving code</h2>
      <p className="small">When you allow an applet here, Parachute signs that exact version with your key (<code>{shortNpub(npubEncode(own))}</code>), after this device's unlock, and keeps the approval in <strong>{home.vault}</strong>. Your other devices with your key check it and run that version without asking. Changed code waits until you approve it again, on any one of them.</p>
      <h3>Passcode</h3>
      <p className="small">{hasCode ? "This device asks your passcode, then its unlock, before approving code." : "Approving asks this device's unlock. A passcode adds a secret of your own, not the phone's PIN."}</p>
      <form className="row-buttons" onSubmit={(e) => { e.preventDefault(); run(async () => { await native.passcodeSet(hasCode ? old : null, next || null); setHasCode(!!next); setOld(""); setNext(""); }, next ? "Passcode kept." : "Passcode removed."); }}>
        {hasCode && <input type="password" aria-label="Your passcode now" placeholder="Passcode now" value={old} onChange={(e) => setOld(e.target.value)} autoComplete="off" />}
        <input type="password" aria-label="New passcode" placeholder={hasCode ? "New (empty: none)" : "New passcode"} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="off" />
        <button type="submit" className="quiet-button" disabled={!hasCode && next.length < 4}>{hasCode ? (next ? "Change" : "Remove") : "Set"}</button>
      </form>
      <h3>Root key</h3>
      <p className="small">{held ? <>This device checks your key list against your root key <code>{shortNpub(npubEncode(held))}</code>: only the keys it names can approve.</> : <>Only if you keep a root key (written down, never on a device): its public half here means only the keys on the list it signs can approve.</>}</p>
      {held ? <button type="button" className="quiet-button" onClick={() => run(async () => setAnchor(null), "Root key removed from this device.")}>Remove it from this device</button>
        : <form className="row-buttons" onSubmit={(e) => { e.preventDefault(); run(async () => { setAnchor(anchor); setAnchorText(""); }, "Root key kept on this device."); }}>
          <input aria-label="Your root key's public half" placeholder="npub1…" value={anchor} onChange={(e) => setAnchorText(e.target.value.trim())} autoCapitalize="off" spellCheck={false} />
          <button type="submit" className="quiet-button" disabled={!anchor}>Keep it</button>
        </form>}
      {done && <p className="small" role="status">{done}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
