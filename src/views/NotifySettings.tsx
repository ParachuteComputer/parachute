// Settings → Notifications while Parachute is closed (docs/design/SERVICES.md, "Notifications through an open push
// service"). The phone's push service (a UnifiedPush distributor: ntfy, from F-Droid, or another) delivers what an
// applet's push gateway sends. Without one (a de-Googled phone with nothing installed yet), Parachute keeps its own
// connection to the relay: on unless turned off here; it costs battery, so ntfy is offered first. Android only.
import { useEffect, useState } from "react";
import { syncNotify, type PushStatus } from "../services/notify";
import { inShell } from "../vault/oauth";
import { openLinkOut } from "../shell/device";

/** ntfy on F-Droid: a UnifiedPush distributor that needs no Google, and talks to any ntfy server (ours). */
export const NTFY_FDROID = "https://f-droid.org/packages/io.heckel.ntfy/";

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}
const said = (e: unknown) => (e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e));
const host = (url: string) => { try { return new URL(url).host; } catch { return url; } };

export default function NotifySettings() {
  const [s, setS] = useState<PushStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const read = () => invoke<PushStatus>("push_status").then(setS, () => setS(null));
  useEffect(() => { if (inShell()) void read(); }, []);
  if (!s?.available) return null;
  const run = (f: () => Promise<unknown>) => { setError(null); f().then(() => syncNotify()).then(read, (e: unknown) => setError(said(e))); };
  const ds = s.distributors ?? [];
  const using = ds.find((d) => d.id === s.distributor);
  return (
    <section className="card" aria-labelledby="s-notify">
      <h2 id="s-notify">Notifications while closed</h2>
      {!ds.length ? <>
        <p>{s.fallback ? "Parachute keeps its own connection open for this. It uses more battery than a push service." : "Off: install a push service, or turn on Parachute's own connection below."}</p>
        <div className="row-buttons"><button type="button" className="primary" onClick={() => void openLinkOut(NTFY_FDROID).catch((e: unknown) => setError(said(e)))}>Get ntfy</button></div>
        <p className="small quiet">ntfy (from F-Droid) delivers without Google. Then set its server to your own and come back here.</p>
      </>
        : using ? <p>Through <strong>{using.name}</strong>{s.endpoint ? "" : ", not connected yet"}.</p>
        : <p>Pick the push service to use.</p>}
      {ds.length > 1 || (ds.length === 1 && !using) ? <div className="row-buttons">
        {ds.map((d) => <button key={d.id} type="button" className="quiet-button" aria-pressed={d.id === s.distributor} onClick={() => run(() => invoke("push_setup", { distributor: d.id }))}>{d.name}</button>)}
      </div> : null}
      {s.registered?.length ? <p className="small quiet">Registered with {[...new Set(s.registered.map((r) => host(r.gateway)))].join(", ")}.</p> : null}
      <label className="line"><span><input type="checkbox" checked={!!s.fallback} onChange={(e) => run(() => invoke("push_setup", { fallback: e.target.checked }))} /> Parachute's own connection, for what no push service delivers (uses more battery)</span></label>
      {error ? <p className="error" role="alert">{error}</p> : null}
    </section>
  );
}
