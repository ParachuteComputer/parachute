// Whose a vault is, in Settings (vault/whose.ts, docs/design/EMBED.md): shown beside each vault, and changed by the
// person. Making a vault count for more (mine, or trusted) is a card they read and a tap on its own button; making it
// count for less is one tap.
import { useState } from "react";
import { hostOf, type VaultRecord } from "../vault/store";
import { askedAbout, setWhose, useWhose, type Whose } from "../vault/whose";
import { settingsNow } from "../shell/homeSettings";

const LABEL: Record<Whose, string> = { mine: "Mine", trusted: "Someone else's, trusted", theirs: "Someone else's" };

/** What each value lets a vault's code do, as the card says it. */
export function whoseCard(v: Pick<VaultRecord, "vault" | "issuer">, to: Whose): { title: string; lines: string[]; act: string } | null {
  if (to === "mine") return { title: `Is ${v.vault} yours?`, act: `${v.vault} is mine`, lines: [
    `Its applets could then ask the app for things across your vaults (the titles of your newest notes, your bar), if their card says so.`,
    `Its applets could show things from other Parachutes on their page, and it could be your home.`,
    `Say so only for a vault that is yours, on a hub you trust (${hostOf(v.issuer)}).`] };
  if (to === "trusted") return { title: `Trust ${v.vault}?`, act: `Trust ${v.vault}`, lines: [
    `Code from ${v.vault} could then run inside your own applets, with everything they reach: your notes included.`,
    `Embedding is the safer way: it keeps ${v.vault}'s code in its own frame, seeing only ${v.vault}.`,
    `Trust only a Parachute whose people you'd let write code for you.`] };
  return null;
}

export function WhoseLine({ v }: { v: VaultRecord }) {
  const whose = useWhose()(v);
  const [asking, setAsking] = useState<Whose | null>(null);
  const card = asking ? whoseCard(v, asking) : null;
  const pick = (w: Whose) => { if (w === whose) return; if (whoseCard(v, w) && (w === "mine" || whose !== "mine")) setAsking(w); else setWhose(v, w); };
  return (
    <>
      <label className="whose-pick"><span className="quiet">Whose</span>{" "}
        <select aria-label={`Whose ${v.vault} is`} value={whose} onChange={(e) => pick(e.target.value as Whose)}>
          {(["mine", "theirs", "trusted"] as const).map((w) => <option key={w} value={w}>{LABEL[w]}</option>)}
        </select>
      </label>
      {card && asking && <WhoseSheet v={v} to={asking} onDone={() => setAsking(null)} />}
    </>
  );
}

/** The card for making a vault count for more: what it would let that vault's code do, and a tap on its own button. */
function WhoseSheet({ v, to, onDone }: { v: VaultRecord; to: Whose; onDone: () => void }) {
  const card = whoseCard(v, to)!;
  return (
    <div className="sheet-scrim" onClick={(e) => { if (e.target === e.currentTarget) onDone(); }}>
      <section className="sheet" role="dialog" aria-modal="true" aria-label={card.title}>
        <h2>{card.title}</h2>
        <ul className="grant-lines">{card.lines.map((l) => <li key={l}>{l}</li>)}</ul>
        <div className="grant-actions">
          <button type="button" className="quiet-button" onClick={onDone}>Not now</button>
          <button type="button" className="primary" onClick={(e) => { if (e.isTrusted) { setWhose(v, to); onDone(); } }}>{card.act}</button>
        </div>
      </section>
    </div>
  );
}

/** The vaults held before this was asked: "Are these yours?" until the person answers. */
export function AskWhose({ vaults }: { vaults: VaultRecord[] }) {
  useWhose();
  const [mine, setMine] = useState<VaultRecord | null>(null);
  // a vault that holds the home applet or a place on the bar first: those are what stop working until it is answered
  const named = new Set([...settingsNow().bar, ...(settingsNow().start ? [settingsNow().start!] : [])].map((p) => p.vault));
  const asked = askedAbout(vaults).sort((a, b) => Number(named.has(b.vault)) - Number(named.has(a.vault)));
  if (!asked.length) return null;
  return (
    <div className="notice" role="status">
      <p>Are these yours? Until you say, Parachute treats them as someone else's: their applets can't ask the app for anything, show things from elsewhere, or open on start.</p>
      <ul className="plain">{asked.map((v) => (
        <li key={v.key} className="line"><span><strong>{v.vault}</strong> <span className="quiet">on {hostOf(v.issuer)}</span></span>
          <span><button type="button" className="quiet-button" onClick={() => setMine(v)}>Mine</button>{" "}
            <button type="button" className="quiet-button" onClick={() => setWhose(v, "theirs")}>Someone else's</button></span></li>
      ))}</ul>
      {mine && <WhoseSheet v={mine} to="mine" onDone={() => setMine(null)} />}
    </div>
  );
}
