// Settings → Security (docs/design/APP-RECORD.md "Security levels"; shell/levels.ts, src-tauri/src/levels.rs): how
// careful Parachute is, per action, and the idle lock, in plain words; and this device's passcode. A stricter choice is
// a tap (kept here at once, and in the open app's record so the person's other devices follow). A looser one, or the
// idle lock turned off, asks the passcode (when this device keeps one) and the unlock, and is signed with the person's
// key for their other devices.
import { useEffect, useState } from "react";
import { nativeNow, type Native } from "../services/native";
import { homeVault } from "../shell/frameSource";
import { changeSecurity, useSettings } from "../shell/homeSettings";
import { IDLE_CHOICES, idleWords, levelsChanged, levelWords, loosens, onLevels, signLowering, type Level, type Levels, type LevelsStatus } from "../shell/levels";
import { signsHere } from "../applet/approvalStore";

const said = (e: unknown) => (e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e));

type Row = { key: "approvals" | "code" | "join"; label: string; note: string; choices: Level[] };
const ROWS: Row[] = [
  { key: "approvals", label: "Approval cards", note: "Uni's routine cards and held sends. Powerful ones always ask your unlock. After an unlock, routine ones in that applet go through for 5 minutes, until the screen locks.", choices: ["none", "unlock", "passcode"] },
  { key: "code", label: "Approving an applet's code", note: "Always at least your unlock.", choices: ["unlock", "passcode"] },
  { key: "join", label: "Joining a network", note: "Your key signs the request to join, as for your WireGuard.", choices: ["none", "unlock", "passcode"] },
];

export default function SecuritySettings() {
  const { bundle: app } = useSettings();
  const [native, setNative] = useState<Native | null>(null);
  const [status, setStatus] = useState<LevelsStatus | null>(null);
  const [pending, setPending] = useState<Levels | null>(null);
  const [code, setCode] = useState("");
  const [old, setOld] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const refresh = (n: Native) => n.levelsStatus().then(setStatus, (e: unknown) => setError(said(e)));
  useEffect(() => { void nativeNow().then((n) => { setNative(n); if (n) void refresh(n); }); }, []);
  // the record may raise it meanwhile (shell/Security.tsx)
  useEffect(() => (native ? onLevels(() => void refresh(native)) : undefined), [native]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!native || !status) return null;
  const cur = status.levels;

  const run = (f: () => Promise<unknown>, ok: string) => { setError(null); setDone(null); f().then(() => { setDone(ok); void refresh(native); }, (e: unknown) => { setError(said(e)); void refresh(native); }); };
  const choose = (l: Levels) => {
    setPending(null);
    if (!loosens(cur, l)) {
      // stricter: kept here now; the record is for the other devices (a failed write leaves this one stricter)
      run(async () => { await native.levelsRaise(l); levelsChanged(); await changeSecurity(l).catch(() => undefined); }, "Kept. Your other devices follow when they read your app.");
      return;
    }
    setCode("");
    setPending(l);
  };
  const lower = (l: Levels) => run(async () => {
    // someone else's app: its record raises this device again, so nothing is signed for it
    if (app.live) throw new Error(`${app.name} is offered by someone else: its levels are theirs, and yours can only be stricter.`);
    const home = homeVault();
    if (!home || !(await signsHere())) throw new Error("Making Parachute less careful needs your key and your home vault on this device.");
    const { written } = await signLowering(native, home, app.id, l, status.passcode ? code : null);
    setPending(null);
    setCode("");
    await changeSecurity(l);
    if (!written) throw new Error("Changed on this device. The signed change couldn't be kept in your home vault, so your other devices keep theirs.");
  }, "Changed, and signed for your other devices.");

  const shown = pending ?? cur;
  return (
    <section className="card" aria-labelledby="s-security">
      <h2 id="s-security">Security</h2>
      <p className="small">What Parachute asks before it acts for you, in <strong>{app.name}</strong>. Stricter is a tap; looser asks your {status.passcode ? "passcode and " : ""}unlock, signed for your other devices.</p>
      <div className="levels-row">
        <span>Lock after<br /><span className="small quiet">untouched; then your unlock opens it</span></span>
        <span className="levels-choices" role="group" aria-label="Lock after">
          {IDLE_CHOICES.map((m) => <button key={m} type="button" aria-pressed={shown.idle === m} onClick={() => choose({ ...cur, idle: m })}>{idleWords(m)}</button>)}
          {!IDLE_CHOICES.includes(shown.idle as (typeof IDLE_CHOICES)[number]) && <button type="button" aria-pressed="true">{idleWords(shown.idle)}</button>}
        </span>
      </div>
      {ROWS.map((r) => (
        <div className="levels-row" key={r.key}>
          <span>{r.label}<br /><span className="small quiet">{r.note}{shown[r.key] === "passcode" && !status.passcode ? " Needs a passcode on this device: set one below." : ""}</span></span>
          <span className="levels-choices" role="group" aria-label={r.label}>
            {r.choices.map((c) => <button key={c} type="button" aria-pressed={shown[r.key] === c} onClick={() => choose({ ...cur, [r.key]: c })}>{levelWords[c]}</button>)}
          </span>
        </div>
      ))}
      {pending && <form className="row-buttons levels-confirm" onSubmit={(e) => { e.preventDefault(); lower(pending); }}>
        <span className="small"><strong>Less careful: {[pending.idle !== cur.idle ? `Lock after ${idleWords(pending.idle).toLowerCase()}` : null, ...ROWS.filter((r) => pending[r.key] !== cur[r.key]).map((r) => `${r.label}, ${levelWords[pending[r.key]].toLowerCase()}`)].filter(Boolean).join("; ")}.</strong> {status.passcode ? "Your passcode, then your unlock." : "Your unlock."}</span>
        {status.passcode && <input type="password" aria-label="Your passcode, to make it less careful" placeholder="Passcode" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />}
        <button type="submit" className="primary" disabled={status.passcode && !code}>Change</button>
        <button type="button" className="quiet-button" onClick={() => { setPending(null); setCode(""); }}>Cancel</button>
      </form>}
      <h3>Passcode</h3>
      <p className="small">{status.passcode ? "This device keeps a passcode: your own secret, not the phone's PIN, kept only as a slow hash here." : "A secret of your own, not the phone's PIN, for what you set to Passcode. Kept only as a slow hash on this device."}</p>
      <form className="row-buttons" onSubmit={(e) => { e.preventDefault(); run(async () => { await native.passcodeSet(status.passcode ? old : null, next || null); setOld(""); setNext(""); }, next ? "Passcode kept." : "Passcode removed."); }}>
        {status.passcode && <input type="password" aria-label="Your passcode now" placeholder="Passcode now" value={old} onChange={(e) => setOld(e.target.value)} autoComplete="off" />}
        <input type="password" aria-label="New passcode" placeholder={status.passcode ? "New (empty: none)" : "New passcode"} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="off" />
        <button type="submit" className="quiet-button" disabled={!status.passcode && next.length < 4}>{status.passcode ? (next ? "Change" : "Remove") : "Set"}</button>
      </form>
      {done && <p className="small" role="status">{done}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
