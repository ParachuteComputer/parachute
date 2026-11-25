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
  // TEMP (T-520): what moves the pick on the iPhone, in a fixed overlay that moves nothing
  useEffect(() => {
    const say = (m: string) => {
      let box = document.getElementById("t520");
      if (!box) { box = document.createElement("div"); box.id = "t520"; box.setAttribute("style", "position:fixed;left:0;top:0;width:100%;pointer-events:none;font-size:9px;z-index:99999;background:rgba(255,255,200,.85)"); document.documentElement.appendChild(box); }
      const p = document.createElement("p"); p.textContent = `[T520] ${m}`; box.appendChild(p);
    };
    const look = (when: string) => {
      const sec = document.querySelector("section.card.stack"), cs = getComputedStyle(document.body);
      const kids = sec ? [...sec.querySelectorAll(":scope > div > *")].map((k) => `${k.tagName.toLowerCase()}${Math.round(k.getBoundingClientRect().top)}+${Math.round(k.getBoundingClientRect().height)}`).join(" ") : "";
      say(`${when} fonts=${document.fonts.status} bodypad=${cs.paddingTop} sec=${Math.round(sec?.getBoundingClientRect().top ?? -1)} ${kids}`);
    };
    look("mount");
    const ts = [1000, 2000, 4000].map((ms) => setTimeout(() => look(`+${ms}`), ms));
    const at = (e: Event) => look(e.type);
    for (const k of ["touchstart", "click"]) document.addEventListener(k, at, true);
    document.fonts.addEventListener?.("loadingdone", () => look("fonts loaded"));
    return () => { ts.forEach(clearTimeout); for (const k of ["touchstart", "click"]) document.removeEventListener(k, at, true); };
  }, []);
  async function go() {
    if (!chosen) return;
    setBusy(true);
    try { window.location.assign(await pick.go(mine, chosen)); } catch (e) { setBusy(false); onError(e); }
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
      <button className="quiet-button" type="button" disabled={busy} onClick={onCancel}>Back</button>
    </div>
  );
}
