// Settings → Keys, beyond the everyday key (docs/design/KEYRING.md): the approval key (the everyday key until a
// separate one is made), the root key's place, and the keys this device trusts to ask for approvals. Every change the
// Rust side makes behind the device unlock; this page only asks.
import { useEffect, useState } from "react";
import { keysHere, shortNpub } from "./key";
import { keyringNow } from "../services/keyring";
import { syncNotify } from "../services/notify";
import type { KeyringStatus } from "../services/native";

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}
const said = (e: unknown) => (e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e));

export default function KeyringSettings() {
  const [k, setK] = useState<KeyringStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [name, setName] = useState("");
  const [npub, setNpub] = useState("");
  const [room, setRoom] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (keysHere()) void keyringNow(true).then(setK); }, []);
  if (!keysHere() || !k) return null;
  // the notification list names trusted keys too: it follows a change here
  const run = (f: () => Promise<unknown>) => { setError(null); f().then(() => keyringNow(true).then((x) => { setK(x); void syncNotify(); }), (e: unknown) => setError(said(e))); };
  const uni = k.approvers[0];
  return (
    <section className="card" aria-labelledby="s-keyring">
      <h2 id="s-keyring">Approvals</h2>
      <p className="small">Your <strong>everyday key</strong> chats and signs in. Your <strong>approval key</strong> answers Uni's approval cards and secret requests, behind this device's unlock. Your <strong>root key</strong> stays offline and is never on this device.</p>
      {k.same ? <div className="stack">
        <p>Your approval key is your everyday key for now.</p>
        {making ? <div className="stack">
          <p className="small">A separate key means posting rights alone can never approve. Switching has a cost: every credential Uni holds is sealed to this key now, so Uni must seal each again to the new one (on Uni's side), and Uni and Hermes must be told the new key before they accept it. Until then, Uni's cards can't be answered here. The new key has no backup: if this device is lost, everything sealed to it is sealed again from the source.</p>
          <div className="row-buttons">
            <button type="button" className="quiet-button" onClick={() => run(() => invoke("keyring_make_approval").then(() => setMaking(false)))}>Make it</button>
            <button type="button" className="quiet-button" onClick={() => setMaking(false)}>Not now</button>
          </div>
        </div> : <button type="button" className="quiet-button" onClick={() => setMaking(true)}>Make a separate approval key</button>}
      </div> : <div className="stack">
        <p>Approval key: <code>{shortNpub(k.approval)}</code></p>
        <p className="small">Give it to Uni and Hermes outside the rooms: copy the enrollment below for <code>sealed enroll</code> on the box Uni runs on. Not as a message: anything that can post as you could post a fake one.</p>
        {uni ? <div className="row-buttons">
          <input aria-label="Uni's room id" placeholder="Uni's room id" value={room} onChange={(e) => setRoom(e.target.value.trim())} />
          <button type="button" className="quiet-button" disabled={!room} onClick={() => run(async () => { const ev = await invoke<unknown>("keyring_enrollment", { room, uni: uni.pubkey }); await navigator.clipboard.writeText(JSON.stringify(ev)); setCopied(true); })}>{copied ? "Copied" : `Copy the enrollment for ${uni.name}`}</button>
        </div> : <p className="small quiet">Trust Uni's key below first.</p>}
        {removing ? <div className="stack">
          <p className="small">Use the everyday key again? This device's approval key is removed for good. Everything Uni sealed to it must be sealed again.</p>
          <div className="row-buttons">
            <button type="button" className="quiet-button" onClick={() => run(() => invoke("keyring_remove_approval").then(() => setRemoving(false)))}>Remove it</button>
            <button type="button" className="quiet-button" onClick={() => setRemoving(false)}>Keep it</button>
          </div>
        </div> : <button type="button" className="quiet-button" onClick={() => setRemoving(true)}>Use the everyday key again</button>}
      </div>}
      <p className="small quiet">Sealing key (compare it with the Uni app's): <code>{k.seal_pub.slice(0, 16)}…</code></p>

      <h3>Trusted for approvals</h3>
      <p className="small">Only these keys can ask this device for an approval or a secret, whatever an applet says.</p>
      {k.approvers.length ? <ul className="plain">{k.approvers.map((a) => <li key={a.pubkey} className="row-buttons">
        <span><strong>{a.name}</strong> <code className="quiet">{a.pubkey.slice(0, 12)}…</code></span>
        <button type="button" className="quiet-button" onClick={() => run(() => invoke("approvers_remove", { pubkey: a.pubkey }))}>Stop trusting</button>
      </li>)}</ul> : <p className="quiet">None yet.</p>}
      <form className="row-buttons" onSubmit={(e) => { e.preventDefault(); run(() => invoke("approvers_add", { name, key: npub }).then(() => { setName(""); setNpub(""); })); }}>
        <input aria-label="Name" placeholder="Name (Uni)" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        <input aria-label="Public key" placeholder="npub1…" value={npub} onChange={(e) => setNpub(e.target.value.trim())} autoCapitalize="off" spellCheck={false} />
        <button type="submit" className="quiet-button" disabled={!name.trim() || !npub}>Trust</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
