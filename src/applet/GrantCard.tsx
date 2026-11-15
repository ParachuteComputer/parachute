// The grant card: the one place the person allows an applet anything, drawn by the app outside any frame. It names
// exactly what is granted, row by row (grant.ts `grantLines`); what isn't on the card is refused at runtime. Every
// sentence is the app's. The only text from a note is the applet's name, shown quoted and marked unverified. Nothing
// runs until Allow, and only a real tap counts (`isTrusted`). From the Uni app's GrantCard, reworded for this app.
import type { MouseEvent } from "react";
import type { CardLine } from "./grant";

export const CODE_CHANGED_LINE = "This applet's code changed since you allowed it. On this device an applet could send what it reads to the internet, so only code you've approved runs.";
export const APPROVED_CODE_LINE = "On this device an applet could send what it reads to the internet (Android's webview can't switch that off), so it is only as safe as its code. Allow it only if you trust it.";
export type Runs = "sealed" | "approved-code";

const day = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });

export default function GrantCard({ name, glyph, vault, runs, lines, fingerprint, expires, codeChanged, onAllow, onNotNow }: {
  name: string; glyph: string; vault: string; runs: Runs; lines: CardLine[]; fingerprint: string; expires: Date; codeChanged: boolean;
  onAllow: () => void; onNotNow: () => void;
}) {
  const tap = (f: () => void) => (e: MouseEvent) => { if (e.isTrusted) f(); };
  return (
    <section className="card grant-card" role="region" aria-label={`${name} is asking for access`}>
      <header className="grant-head">
        <span className="grant-glyph" aria-hidden="true">{glyph}</span>
        <h2>An applet asks for access</h2>
      </header>
      {codeChanged && <p className="grant-changed" role="status"><strong>{CODE_CHANGED_LINE}</strong></p>}
      <p>The applet <q className="grant-name" data-untrusted="true">{name}</q> (a name from its note, not verified) would run in a sealed frame. In the <strong>{vault}</strong> vault it would:</p>
      {lines.length ? <ul className="grant-lines">{lines.map((l, i) => <li key={i} className={l.stress ? "grant-stress" : undefined}>{l.text}</li>)}</ul> : <p className="quiet">Nothing outside itself.</p>}
      <p className="grant-rest">{runs === "approved-code"
        ? <><strong>{APPROVED_CODE_LINE}</strong> It can't delete notes or change notes anywhere else.</>
        : <><strong>Nothing else.</strong> It can't delete notes, change notes anywhere else, or reach the internet.</>}</p>
      <p className="grant-meta quiet">Lasts until {day.format(expires)}, or until you revoke it · Grant <code>{fingerprint}</code></p>
      <div className="grant-actions">
        <button type="button" className="quiet-button" onClick={tap(onNotNow)}>Not now</button>
        <button type="button" className="primary" onClick={tap(onAllow)}>{codeChanged ? "Allow this version" : "Allow"}</button>
      </div>
    </section>
  );
}
