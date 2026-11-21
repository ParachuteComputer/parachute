// An allowed applet's servers on its settings line (docs/design/SERVICES.md): why its list was refused, if it was; a
// token for a `token` service, given here (never to the applet); and what the shell signed for it, as the native side
// wrote it down.
import { useEffect, useState } from "react";
import type { AppletEntry } from "../applet/discovery";
import { hostWords, type Service } from "../applet/services";
import { nativeNow, type LogLine } from "../services/native";

const when = (s: number) => new Date(s * 1000).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function TokenFor({ subject, service }: { subject: string; service: Service }) {
  const [has, setHas] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [err, setErr] = useState("");
  const read = () => nativeNow().then((n) => (n ? n.tokenHas(subject, service) : false)).then(setHas, () => setHas(false));
  useEffect(() => { void read(); }, [subject, service.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const keep = async (token: string | null) => {
    setErr("");
    try { const n = await nativeNow(); if (!n) throw new Error("tokens are kept by the Parachute app on a device"); await n.tokenSet(subject, service, token); setValue(""); setOpen(false); await read(); }
    catch (e) { setErr(e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : "it wasn't kept"); }
  };
  return <div className="service-token">
    <span>{has ? `A token for ${hostWords(service)} is kept here.` : `It needs a token for ${hostWords(service)}.`}</span>{" "}
    {!open && <button type="button" className="quiet-button" onClick={() => setOpen(true)}>{has ? "Change it" : "Give it a token"}</button>}
    {has && !open && <button type="button" className="quiet-button" onClick={() => keep(null)}>Forget it</button>}
    {open && <form onSubmit={(e) => { e.preventDefault(); if (value.trim()) void keep(value.trim()); }}>
      <label>Token for {hostWords(service)} <input className="text-input" type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} /></label>
      <button type="submit" className="primary">Keep it</button> <button type="button" className="quiet-button" onClick={() => setOpen(false)}>Cancel</button>
      <p className="quiet">The app keeps it sealed on this device and adds it to this applet's requests. The applet never sees it.</p>
    </form>}
    {err && <p className="error" role="alert">{err}</p>}
  </div>;
}

export default function AppletServices({ subject, entry }: { subject: string; entry: AppletEntry }) {
  const [log, setLog] = useState<LogLine[] | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!shown) return;
    void nativeNow().then((n) => (n ? n.log(subject) : [])).then((l) => setLog([...l].sort((a, b) => b.at - a.at)), () => setLog([]));
  }, [shown, subject]);
  return <div className="applet-services">
    {entry.servicesError && <p className="quiet">It reaches no server: {entry.servicesError}.</p>}
    {entry.services.filter((s) => s.kind === "http" && s.auth === "token").map((s) => <TokenFor key={s.id} subject={subject} service={s} />)}
    {entry.services.length > 0 && <details onToggle={(e) => setShown((e.target as HTMLDetailsElement).open)}>
      <summary>What the app signed for it</summary>
      {log === null ? <p className="quiet">Reading…</p> : !log.length ? <p className="quiet">Nothing yet.</p> :
        <ul className="plain" aria-label={`Signed for ${entry.manifest.name}`}>{log.slice(0, 100).map((l, i) => <li key={i}><span className="quiet">{when(l.at)}</span> {l.service}: {l.what}{l.count && l.count > 1 ? ` ×${l.count}` : ""}</li>)}</ul>}
    </details>}
  </div>;
}
