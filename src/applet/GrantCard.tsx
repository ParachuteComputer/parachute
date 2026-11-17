// The grant card: the one place the person allows an applet anything, drawn by the app outside any frame. It names
// exactly what is granted, row by row (grant.ts `grantLines`); what isn't on the card is refused at runtime. Every
// sentence is the app's. The only text from a note is the applet's name, shown quoted and marked unverified. Nothing
// runs until Allow, and only a real tap counts (`isTrusted`). From the Uni app's GrantCard, reworded for this app.
import type { MouseEvent } from "react";
import type { CardLine } from "./grant";
import { useSettledPress } from "../ui/press";

export const CODE_CHANGED_LINE = "This applet's code changed since you allowed it. On this device an applet could send what it reads to the internet, so only code you've approved runs.";
/** Sealed: the frame can't reach the internet, so the line says only what changed. */
export const CODE_CHANGED_SEALED_LINE = "This applet's code changed since you allowed it. Only the version you allow runs.";
export const APPROVED_CODE_LINE = "On this device an applet could send what it reads to the internet (Android's webview can't switch that off), so it is only as safe as its code. Allow it only if you trust it.";
export type Runs = "sealed" | "approved-code";

const day = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });

/** The heading when the code changed since it was brought into the person's Parachute (a pointer's pin). */
export const broughtChangedLine = (vault: string, name: string) => `${vault} changed «${name}» since you brought it in. Only the version you allow runs.`;
export const ASKS_OTHER_LINE = "It now asks for something other than what you allowed.";

/** The props a page hands a component, as the card shows them: every one, in full. */
export const handedLine = (props: Record<string, unknown>) => `Your page hands it: ${Object.entries(props).map(([k, v]) => `${k} ${JSON.stringify(v)}`).join(", ")}.`;

export const IMPORTS_CHANGED_LINE = "This applet's code, or what it imports, changed since you allowed it. Only the version you allow runs.";

export default function GrantCard({ name, glyph, vault, whose = "mine", host, runs, lines, fingerprint, expires, codeChanged, broughtChanged = false, asksOther = false, onAllow, onNotNow, what = "applet", handed, settle, withImports = false }: {
  name: string; glyph: string; vault: string; runs: Runs; lines: CardLine[]; fingerprint: string; expires: Date; codeChanged: boolean;
  /** whose the vault is (vault/whose.ts), and its hub's host: someone else's is said so */
  whose?: "mine" | "theirs" | "trusted"; host?: string;
  /** the code differs from what a pointer brought in; or a grant was here and what it asks changed */
  broughtChanged?: boolean; asksOther?: boolean;
  onAllow: () => void; onNotNow: () => void;
  /** A component, embedded in a page (docs/design/EMBED.md), with the props its page hands it. */
  what?: "applet" | "component"; handed?: Record<string, unknown>;
  /** On a sheet over a page where frames run: Allow counts only for a press that began this long after it showed. */
  settle?: number;
  /** It imports components: a code change may be in them. */
  withImports?: boolean;
}) {
  const tap = (f: () => void) => (e: MouseEvent) => { if (e.isTrusted) f(); };
  const press = useSettledPress(settle ?? 0);
  const allow = (e: MouseEvent) => { if (settle ? press.counts(e) : e.isTrusted) onAllow(); };
  const where = whose !== "mine" ? <> (someone else's{host ? `, at ${host}` : ""})</> : null;
  return (
    <section className="card grant-card" role="region" aria-label={`${name} is asking for access`}>
      <header className="grant-head">
        <span className="grant-glyph" aria-hidden="true">{glyph}</span>
        <h2>{what === "component" ? "A component asks for access" : "An applet asks for access"}</h2>
      </header>
      {broughtChanged ? <p className="grant-changed" role="status"><strong>{broughtChangedLine(vault, name)}</strong></p>
        : codeChanged ? <p className="grant-changed" role="status"><strong>{withImports ? IMPORTS_CHANGED_LINE : runs === "approved-code" ? CODE_CHANGED_LINE : CODE_CHANGED_SEALED_LINE}</strong></p>
        : asksOther ? <p className="grant-changed" role="status"><strong>{ASKS_OTHER_LINE}</strong></p> : null}
      {what === "component"
        ? <p>The component <q className="grant-name" data-untrusted="true">{name}</q> (a name from its record, not verified), from <strong>{vault}</strong>{where}, would run in its own sealed frame on your page. In the {vault} vault it would:</p>
        : <p>The applet <q className="grant-name" data-untrusted="true">{name}</q> (a name from its note, not verified) would run in a sealed frame. In the <strong>{vault}</strong> vault{where} it would:</p>}
      {lines.length ? <ul className="grant-lines">{lines.map((l, i) => <li key={i} className={l.stress ? "grant-stress" : undefined}>{l.text}</li>)}</ul> : <p className="quiet">Nothing outside itself.</p>}
      {handed && Object.keys(handed).length > 0 && <p className="grant-handed">{handedLine(handed)}</p>}
      <p className="grant-rest">{runs === "approved-code"
        ? <><strong>{APPROVED_CODE_LINE}</strong> It can't delete notes or change notes anywhere else.</>
        : <><strong>Nothing else.</strong> It can't delete notes, change notes anywhere else, or reach the internet.</>}
        {whose !== "mine" && <> It acts as you in {vault}, with your sign-in there. It sees nothing in your own vaults.</>}
        {whose !== "mine" && what === "component" && <> Your page and it could pass words between them, and those could reach {vault}.</>}
        {whose === "mine" && what === "component" && <> It reads only that vault.</>}</p>
      <p className="grant-meta quiet">Lasts until {day.format(expires)}, or until you revoke it · Grant <code>{fingerprint}</code></p>
      <div className="grant-actions">
        <button type="button" className="quiet-button" onClick={tap(onNotNow)}>Not now</button>
        <button type="button" className="primary" {...(settle ? press.bind : {})} onClick={allow}>{codeChanged || broughtChanged ? "Allow this version" : "Allow"}</button>
      </div>
    </section>
  );
}
