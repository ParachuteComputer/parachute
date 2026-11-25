import { useEffect, useState } from "react";
import { hostOf } from "../vault/store";
import type { VaultPick } from "../vault/signInFlow";

/** Before the hub's consent (docs/design/SCOPES.md): on a hub the person runs, which of its vaults are theirs; and which
 *  one Parachute reads now: the home, on a Parachute of theirs. The others are asked for one at a time, later. */
export default function PickVaults({ pick, onError, onCancel }: { pick: VaultPick; onError: (e: unknown) => void; onCancel: () => void }) {
  const [mine, setMine] = useState<string[]>(pick.mine);
  const [first, setFirst] = useState<string>(pick.first);
  const [busy, setBusy] = useState(false);
  const flip = (v: string) => setMine((m) => (m.includes(v) ? m.filter((x) => x !== v) : [...m, v]));
  // the home is one of the person's own; on someone else's Parachute, any vault they reach
  const choices = pick.home ? (pick.askMine ? pick.vaults.filter((v) => mine.includes(v)) : pick.mine) : pick.vaults;
  const chosen = choices.includes(first) ? first : choices[0] ?? "";
  // TEMP (T-520): a fixed overlay, outside the layout, so the probe itself moves nothing
  const t520 = (m: string) => {
    let box = document.getElementById("t520");
    if (!box) { box = document.createElement("div"); box.id = "t520"; box.setAttribute("style", "position:fixed;left:0;top:0;width:100%;pointer-events:none;font-size:9px;z-index:99999;background:rgba(255,255,200,.85)"); document.documentElement.appendChild(box); }
    const p = document.createElement("p"); p.textContent = `[T520] ${m}`; box.appendChild(p);
  };
  useEffect(() => {
    const cont = () => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent === "Continue"); const r = b?.getBoundingClientRect(); return r ? `cont=${Math.round(r.top)}-${Math.round(r.bottom)}` : "cont=none"; };
    const vv = () => `doc.h=${document.documentElement.scrollHeight} scrollY=${window.scrollY} ${cont()}`;
    t520(`pick mounted ${vv()}`);
    const at = (e: Event) => { const t = (e as TouchEvent).changedTouches?.[0]; const m = e as MouseEvent; t520(`${e.type} y=${t ? t.clientY : m.clientY} on "${(e.target as HTMLElement)?.textContent?.slice(0, 12)}" ${vv()}`); };
    for (const k of ["touchstart", "touchend", "click"]) document.addEventListener(k, at, true);
    const mo = new MutationObserver((ms) => { for (const r of ms) for (const n of r.addedNodes) if (n instanceof HTMLElement && n.id !== "t520" && !n.closest("#t520")) t520(`added <${n.tagName.toLowerCase()} class="${n.className}"> "${n.textContent?.slice(0, 30)}" in <${(r.target as HTMLElement).tagName?.toLowerCase()} class="${(r.target as HTMLElement).className}"> ${vv()}`); });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => { mo.disconnect(); for (const k of ["touchstart", "touchend", "click"]) document.removeEventListener(k, at, true); t520("pick unmounted"); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function go() {
    t520(`go chosen=${chosen}`);
    if (!chosen) return;
    setBusy(true);
    t520(`go secure=${window.isSecureContext} subtle=${typeof crypto?.subtle}`);
    try { const u = await pick.go(mine, chosen); t520(`to ${u.slice(0, 60)}`); window.location.assign(u); } catch (e) { t520(`failed ${e instanceof Error ? `${e.name}: ${e.message}` : JSON.stringify(e)}`); setBusy(false); onError(e); }
  }
  return (
    <div className="stack">
      {pick.askMine && <fieldset className="plain">
        <legend>Which vaults on {hostOf(pick.hub)} are yours?</legend>
        {pick.vaults.map((v) => (
          <label key={v} className="line"><span><input type="checkbox" checked={mine.includes(v)} onChange={() => flip(v)} /> {v}</span></label>
        ))}
        <p className="small quiet">The others are someone else's: their applets can't ask the app for anything, show things from elsewhere, or be your home.</p>
      </fieldset>}
      {choices.length > 1 && <fieldset className="plain">
        <legend>{pick.home ? "Which one is your home?" : "Which vault do you want to open?"}</legend>
        {choices.map((v) => (
          <label key={v} className="line"><span><input type="radio" name="first" checked={chosen === v} onChange={() => setFirst(v)} /> {v}</span></label>
        ))}
      </fieldset>}
      <p className="small quiet">{pick.home ? "Parachute reads and writes your home now. Your other vaults are asked for one at a time, when you open one or allow an applet in it." : "Parachute reads this one now. The others are asked for one at a time, when you open them."}</p>
      <button className="primary" type="button" disabled={busy || !chosen} onClick={() => void go()}>{busy ? "Signing in…" : "Continue"}</button>
      <button className="quiet-button" type="button" disabled={busy} onClick={() => { t520("back"); onCancel(); }}>Back</button>
    </div>
  );
}
