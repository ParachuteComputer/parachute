import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Bar } from "../ui/Bar";
import { errorText, pairCancel, pairConfirm, pairStart } from "./key";
import { deviceAgent } from "../shell/agent";

type Step = "link" | "scanning" | "connecting" | "code" | "receiving";
const isLink = (s: string) => s.trim().startsWith("nostrpair://");
/** The phones, where the shell has the barcode scanner (src-tauri/Cargo.toml). */
const canScan = () => /Android|iPhone|iPad/i.test(deviceAgent());

/** Pair from a device that has the key: the other device shows a pairing link (a QR code); this one scans or pastes it,
 *  both show a 6-digit code, the person checks they match, and the key comes over encrypted (src-tauri/src/pairing.rs). */
export default function Pair() {
  const nav = useNavigate();
  const [link, setLink] = useState("");
  const [step, setStep] = useState<Step>("link");
  const [sas, setSas] = useState("");
  const [error, setError] = useState<string | null>(null);
  const live = useRef(true);
  const say = (e: unknown) => setError(errorText(e, "The pairing didn't finish."));
  // the pairing this screen started; leaving the screen mid-pairing stops it and tells the other device
  const pairing = useRef<number | null>(null);
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; if (pairing.current !== null) void pairCancel(pairing.current, false); };
  }, []);

  async function start(uri = link) {
    setError(null); setStep("connecting");
    try {
      const r = await pairStart(uri.trim());
      if (!live.current) { void pairCancel(r.id, false); return; }
      pairing.current = r.id;
      setSas(r.sas); setStep("code");
    } catch (e) { if (live.current) { say(e); setStep("link"); } }
  }
  async function scan() {
    setError(null); setStep("scanning");
    try {
      const scanner = await import("@tauri-apps/plugin-barcode-scanner");
      if (await scanner.checkPermissions() !== "granted" && await scanner.requestPermissions() !== "granted") throw new Error("The camera isn't allowed. Allow it for Parachute in the phone's settings, or paste the link.");
      const got = (await scanner.scan({ formats: [scanner.Format.QRCode], windowed: false })).content.trim();
      if (!isLink(got)) throw new Error("That QR code isn't a pairing link.");
      setLink(got);
      await start(got);
    } catch (e) { if (live.current) { say(e); setStep("link"); } }
  }
  async function confirm() {
    const id = pairing.current;
    if (id === null) return;
    setError(null); setStep("receiving");
    try {
      await pairConfirm(id);
      pairing.current = null;
      if (live.current) nav("/", { replace: true });
    } catch (e) { if (pairing.current !== id) return; /* the person cancelled: nothing to report */ pairing.current = null; if (live.current) { say(e); setLink(""); setStep("link"); } }
  }
  async function cancel(codesDiffer: boolean) {
    const id = pairing.current;
    pairing.current = null;
    if (id !== null) await pairCancel(id, codesDiffer);
    setSas(""); setLink(""); setStep("link");
    if (codesDiffer) setError("The codes didn't match, so nothing was sent. Start again on the other device.");
  }

  return (
    <main className="screen">
      <Bar title="Pair your key" back={step === "link" ? "/key" : undefined} />
      <section className="card stack">
        {(step === "link" || step === "connecting" || step === "scanning") && <>
          <ol className="steps">
            <li>On the device that has your key, open the app that holds it and choose <strong>Pair a device</strong> (in Buzz desktop: Settings → Pair mobile device).</li>
            <li>Scan the QR code it shows, or copy its link and paste it here.</li>
            <li>Check that both devices show the same 6-digit code.</li>
          </ol>
          {canScan() && <button type="button" className="secondary" disabled={step !== "link"} onClick={() => void scan()}>{step === "scanning" ? "Scanning…" : "Scan the QR code"}</button>}
          <label className="field">
            <span>Pairing link</span>
            <textarea rows={3} value={link} onChange={(e) => setLink(e.target.value)} spellCheck={false} autoCapitalize="off" autoCorrect="off" placeholder="nostrpair://…" disabled={step !== "link"} />
          </label>
          <button type="button" className="primary" disabled={!isLink(link) || step !== "link"} onClick={() => void start()}>{step === "connecting" ? "Connecting…" : "Start"}</button>
        </>}
        {(step === "code" || step === "receiving") && <>
          <p>Does the other device show this code?</p>
          <p className="sas" aria-label={`Code ${sas.split("").join(" ")}`}>{sas.slice(0, 3)} {sas.slice(3)}</p>
          <p className="quiet small">Go on only if the codes are the same. Then confirm on the other device too.</p>
          <button type="button" className="primary" disabled={step === "receiving"} onClick={() => void confirm()}>{step === "receiving" ? "Waiting for the other device…" : "The codes match"}</button>
          <div className="row-buttons">
            {step === "code" && <button type="button" className="secondary" onClick={() => void cancel(true)}>They're different</button>}
            <button type="button" className="secondary" onClick={() => void cancel(false)}>Cancel</button>
          </div>
        </>}
        {error && <p className="error" role="alert">{error}</p>}
      </section>
      {step === "link" && <p className="screen-foot quiet small">Your key travels encrypted end to end and is kept in this device's secure storage. <Link to="/key">Other ways to get a key</Link></p>}
    </main>
  );
}
