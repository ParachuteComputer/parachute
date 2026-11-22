// Settings → Keys, beyond the everyday key (docs/design/KEYRING.md): the approval key (the everyday key until a
// separate one is made), the root key's place, and the keys this device trusts to ask for approvals. Every change the
// Rust side makes behind the device unlock; this page only asks.
import { useEffect, useState } from "react";
import { keysHere, shortNpub } from "./key";
import { keyringNow } from "../services/keyring";
import { syncNotify } from "../services/notify";
import type { KeyringStatus } from "../services/native";
import { approvalsShown } from "../views/settingsShown";

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}
const said = (e: unknown) => (e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e));

/** `cards`: an applet here answers approval cards (settingsShown.ts). */
export default function KeyringSettings({ cards }: { cards: boolean }) {
  const [k, setK] = useState<KeyringStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [name, setName] = useState("");
  const [npub, setNpub] = useState("");
  const [room, setRoom] = useState("");
  const [copied, setCopied] = useState(false);
  const [forKey, setForKey] = useState("");
  useEffect(() => { if (keysHere()) void keyringNow(true).then(setK); }, []);
  if (!keysHere() || !k || !approvalsShown(cards, k)) return null;
  // the notification list names trusted keys too: it follows a change here
  const run = (f: () => Promise<unknown>) => { setError(null); f().then(() => keyringNow(true).then((x) => { setK(x); void syncNotify(); }), (e: unknown) => setError(said(e))); };
  // the enrollment is for the trusted key the person picks (their agent's, normally)
  const uni = k.approvers.find((a) => a.pubkey === forKey) ?? k.approvers.find((a) => a.name.toLowerCase() === "uni") ?? k.approvers[0];
  return (
    <section className="card" aria-labelledby="s-keyring">
      <h2 id="s-keyring">Approvals</h2>
      <p className="small">One key is yours: it chats, signs in, and answers your agent's approval cards and secret requests, the risky ones behind this device's unlock. A <strong>root key</strong>, if you keep one, is recovery only: written down, never on this device.</p>
      {k.same ? <div className="stack">
        <p>Your key answers approvals too.</p>
        {null /* one personal key (Aaron, 11-18): no new separate approval keys; one made before can still be removed below */}
      </div> : <div className="stack">
        <p>Approval key: <code>{shortNpub(k.approval)}</code></p>
        <p className="small">Give it to your agent outside the chat: copy the enrollment below for <code>sealed enroll</code> on the machine your agent runs on. Not as a message: anything that can post as you could post a fake one.</p>
        {uni ? <div className="row-buttons">
          {k.approvers.length > 1 && <select aria-label="For" value={uni.pubkey} onChange={(e) => setForKey(e.target.value)}>{k.approvers.map((a) => <option key={a.pubkey} value={a.pubkey}>{a.name}</option>)}</select>}
          <input className="text-input" aria-label={`${uni.name}'s room id`} placeholder={`${uni.name}'s room id`} value={room} onChange={(e) => setRoom(e.target.value.trim())} />
          <button type="button" className="quiet-button" disabled={!room} onClick={() => run(async () => { const ev = await invoke<unknown>("keyring_enrollment", { room, uni: uni.pubkey }); await navigator.clipboard.writeText(JSON.stringify(ev)); setCopied(true); })}>{copied ? "Copied" : `Copy the enrollment for ${uni.name}`}</button>
        </div> : <p className="small quiet">Trust your agent's key below first.</p>}
        {removing ? <div className="stack">
          <p className="small">Use the everyday key again? This device's approval key is removed for good. Everything your agent sealed to it must be sealed again.</p>
          <div className="row-buttons">
            <button type="button" className="quiet-button" onClick={() => run(() => invoke("keyring_remove_approval").then(() => setRemoving(false)))}>Remove it</button>
            <button type="button" className="quiet-button" onClick={() => setRemoving(false)}>Keep it</button>
          </div>
        </div> : <button type="button" className="quiet-button" onClick={() => setRemoving(true)}>Use the everyday key again</button>}
      </div>}
      <details className="small quiet"><summary>Details</summary>Sealing key (compare it with the one your agent shows): <code>{k.seal_pub.slice(0, 16)}…</code></details>

      <h3>Trusted for approvals</h3>
      <p className="small">Only these keys can ask this device for an approval or a secret, whatever an applet says.</p>
      {k.approvers.length ? <ul className="plain">{k.approvers.map((a) => <li key={a.pubkey} className="row-buttons">
        <span><strong>{a.name}</strong> <details className="quiet small"><summary>Details</summary>Its key: <code>{a.pubkey.slice(0, 12)}…</code></details></span>
        <button type="button" className="quiet-button" onClick={() => run(() => invoke("approvers_remove", { pubkey: a.pubkey }))}>Stop trusting</button>
      </li>)}</ul> : <p className="quiet">None yet.</p>}
      <form className="row-buttons" onSubmit={(e) => { e.preventDefault(); run(() => invoke("approvers_add", { name, key: npub }).then(() => { setName(""); setNpub(""); })); }}>
        <input className="text-input" aria-label="Name" placeholder="Whose key" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        <input className="text-input" aria-label="Public key" placeholder="npub1…" value={npub} onChange={(e) => setNpub(e.target.value.trim())} autoCapitalize="off" spellCheck={false} />
        <button type="submit" className="quiet-button" disabled={!name.trim() || !npub}>Trust</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
