// The grant card: the one place the person allows an applet anything, drawn by the app outside any frame. Its face
// (face.ts) says what the applet would do by what it means to a person: what it does as you, and anything that could
// send what it reads elsewhere, each on its own line in bold words; the small everyday asks on one "Also" line. Below the
// buttons, "Show details" (beside them: on a page, opening it never moves Allow; on a sheet, Allow settles again) unfolds every exact line (grant.ts `grantLines`); what isn't on the card is refused at runtime.
// When it asks again, the card says why first: its code changed (and whether it asks for anything new), its year ran
// out, or it asks for something else, with what is new marked. Every sentence is the app's. The only text from a note is
// the applet's name, shown quoted and marked unverified. Nothing runs until Allow, and only a real tap counts
// (`isTrusted`). From the Uni app's GrantCard, reworded for this app.
import { useId, useState, type MouseEvent } from "react";
import { grantLines, type Grant } from "./grant";
import type { LineOptions } from "./services";
import { importLines, type Imported } from "./resolveImports";
import { alsoLine, askedOf, changeOf, DETAIL, faceOf, faceText } from "./face";
import type { Asked } from "./grants";
import { useSettledPress } from "../ui/press";

export const CODE_CHANGED_LINE = "This applet's code changed since you allowed it. On this device an applet could send what it reads to the internet, so only code you've approved runs.";
/** Sealed: the frame can't reach the internet, so the line says only what changed. */
export const CODE_CHANGED_SEALED_LINE = "This applet's code changed since you allowed it. Only the version you allow runs.";
export const APPROVED_CODE_LINE = "On this device an applet could send what it reads to the internet (Android's webview can't switch that off), so it is only as safe as its code. Allow it only if you trust it.";
/** The face's short form of it. */
export const APPROVED_CODE_SHORT = "On this device an applet could send what it reads to the internet: allow only code you trust.";
export const NOTHING_NEW = "It asks for no new permissions.";
export const MODE_CHANGED_LINE = "You allowed it when applets here were sealed. This device now runs approved code only, so it asks again.";
export const EXPIRED_LINE = "A year has passed since you allowed it, so it asks again.";

export type Runs = "sealed" | "approved-code";

const day = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });

/** The heading when the code changed since it was brought into the person's Parachute (a pointer's pin). */
export const broughtChangedLine = (vault: string, name: string) => `${vault} changed «${name}» since you brought it in. Only the version you allow runs.`;
export const ASKS_OTHER_LINE = "It now asks for something other than what you allowed.";
export const FRESH_LINE = `${ASKS_OTHER_LINE} What is new is marked New.`;
/** Only lines under Show details are new (a private note on a relay, say). */
export const FRESH_DETAILS_LINE = `${ASKS_OTHER_LINE} What is new is marked New under Show details.`;

/** The props a page hands a component, as the card shows them: every one, in full. */
export const handedLine = (props: Record<string, unknown>) => `Your page hands it: ${Object.entries(props).map(([k, v]) => `${k} ${JSON.stringify(v)}`).join(", ")}.`;

export const IMPORTS_CHANGED_LINE = "This applet's code, or what it imports, changed since you allowed it. Only the version you allow runs.";

export default function GrantCard({ name, glyph, vault, whose = "mine", host, runs, grant, ownFolder, keyring = {}, imports = [], scope, code, status, was, fingerprint, expires, broughtChanged = false, onAllow, onNotNow, what = "applet", handed, settle }: {
  name: string; glyph: string; vault: string; runs: Runs;
  /** what it asks (grant.ts), the folder its note is in, and the keyring's names for keys: the card's lines come from these */
  grant: Grant; ownFolder: string | null; keyring?: LineOptions;
  /** the components it imports (resolveImports.ts) */
  imports?: readonly Imported[];
  /** the grant's key and the code's hash now, the store's status for them, and the grant this device holds
   *  (grants.ts `record`), if any. Shown with a grant `ok`: it was allowed under sealed frames, and the device now runs
   *  approved code only. */
  scope: string; code: string; status: "none" | "ok" | "updated"; was: { scope: string; code: string; asked: Asked | null } | null;
  fingerprint: string; expires: Date;
  /** whose the vault is (vault/whose.ts), and its hub's host: someone else's is said so */
  whose?: "mine" | "theirs" | "trusted"; host?: string;
  /** the code differs from what a pointer brought in */
  broughtChanged?: boolean;
  /** `asked`: what this card said, for the store to keep */
  onAllow: (asked: Asked) => void; onNotNow: () => void;
  /** A component, embedded in a page (docs/design/EMBED.md), with the props its page hands it. */
  what?: "applet" | "component"; handed?: Record<string, unknown>;
  /** On a sheet over a page where frames run: Allow counts only for a press that began this long after it showed. */
  settle?: number;
}) {
  const tap = (f: () => void) => (e: MouseEvent) => { if (e.isTrusted) f(); };
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  // Show details can move Allow (a sheet anchored at the bottom grows upward): the press settles again after each toggle
  const press = useSettledPress(settle ?? 0, open);
  const face = faceOf(grant, ownFolder, keyring, imports);
  const lines = [...grantLines(grant, ownFolder, keyring), ...importLines(imports)];
  const asked: Asked = askedOf(grant, ownFolder, keyring, imports);
  const allow = (e: MouseEvent) => { if (settle ? press.counts(e) : e.isTrusted) onAllow(asked); };
  const change = changeOf(was, { scope, code, status, ...asked });
  const codeChanged = change.kind === "code" || (change.kind === "expired" && change.codeMoved);
  const reaches = (grant.services?.length ?? 0) > 0 || grant.app.includes("links");
  const isNew = (t: string) => !!change.fresh?.has(t);
  const New = ({ t }: { t: string }) => (isNew(t) ? <><span className="grant-new">New</span>{" "}</> : null);
  const freshOnFace = [...(change.fresh ?? [])].some((t) => !t.startsWith(DETAIL));
  const alsoText = face.also.length ? alsoLine(face.also) : "";
  const q = <q className="grant-name" data-untrusted="true">{name}</q>;
  const title = broughtChanged || codeChanged ? <>{q} changed</>
    : change.kind === "asks" ? <>{q} asks again</>
    : change.kind === "expired" ? <>Allow {q} again?</>
    : <>Allow {what === "component" ? "the component " : ""}{q}?</>;
  // "no new permissions" only when nothing it asks is new, and not where new code could reach the internet anyway
  const nothingNew = change.nothingNew ? ` ${NOTHING_NEW}` : "";
  const codeLine = imports.length ? IMPORTS_CHANGED_LINE : runs === "approved-code" ? CODE_CHANGED_LINE : CODE_CHANGED_SEALED_LINE;
  const notice = broughtChanged ? broughtChangedLine(vault, name)
    : change.kind === "code" ? `${codeLine}${nothingNew}`
    : change.kind === "expired" ? `${EXPIRED_LINE}${change.codeMoved ? ` ${codeLine}` : ""}${nothingNew}`
    : change.kind === "asks" ? (freshOnFace ? FRESH_LINE : change.fresh?.size ? FRESH_DETAILS_LINE : ASKS_OTHER_LINE)
    : change.kind === "mode" ? MODE_CHANGED_LINE : null;
  const where = whose !== "mine" ? <> (someone else's{host ? `, at ${host}` : ""})</> : null;
  return (
    <section className="card grant-card" role="region" aria-label={`${name} is asking for access`}>
      <header className="grant-head">
        <span className="grant-glyph" aria-hidden="true">{glyph}</span>
        <h2>{title}</h2>
      </header>
      <p className="grant-sub quiet">{what === "component" ? <>A component from <strong>{vault}</strong>, in its own sealed frame on your page, named by its record (not verified).</> : <>An applet in {whose === "mine" ? "your vault " : ""}<strong>{vault}</strong>, named by its note (not verified).</>}</p>
      {notice && <p className="grant-changed" role="status"><strong>{notice}</strong></p>}
      {whose !== "mine" && <p className="grant-whose"><strong>Someone else's vault{host ? `, at ${host}` : ""}.</strong> It acts as you in {vault}, with your sign-in there. It sees nothing in your own vaults.{what === "component" && <> Your page and it could pass words between them, and those could reach {vault}.</>}</p>}
      {face.lines.length ? <ul className="grant-face" aria-label="What it would do">{face.lines.map((l, i) => <li key={i} className={isNew(faceText(l)) ? "grant-fresh" : undefined}><New t={faceText(l)} />{l.risky ? <strong>{l.lead}</strong> : l.lead}{l.rest}</li>)}</ul>
        : !face.also.length ? <p className="quiet">Nothing outside itself.</p> : null}
      {alsoText && <p className="grant-also"><New t={alsoText} />{alsoText}</p>}
      {change.gone.some((t) => !t.startsWith(DETAIL)) && <p className="grant-gone quiet">No longer: {change.gone.filter((t) => !t.startsWith(DETAIL)).join("; ")}</p>}
      {handed && Object.keys(handed).length > 0 && <p className="grant-handed">{handedLine(handed)}</p>}
      <p className="grant-rest">{runs === "approved-code"
        ? <><strong>{APPROVED_CODE_SHORT}</strong> It can't delete notes.</>
        : reaches ? <><strong>Nothing else.</strong> It can't delete notes.</>
        : <><strong>Nothing else.</strong> It can't delete notes or reach the internet.</>}
        {whose === "mine" && what === "component" && <> It reads only that vault.</>}</p>
      <div className="grant-actions">
        <button type="button" className="grant-more" aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen((o) => !o)}>{open ? "Hide details" : "Show details"}</button>
        <button type="button" className="quiet-button" onClick={tap(onNotNow)}>Not now</button>
        <button type="button" className="primary" {...(settle ? press.bind : {})} onClick={allow}>{codeChanged || broughtChanged ? "Allow this version" : "Allow"}</button>
      </div>
      <div className="grant-details" id={detailsId} hidden={!open}>
        {what === "component"
          ? <p>The component <q className="grant-name" data-untrusted="true">{name}</q> (a name from its record, not verified), from <strong>{vault}</strong>{where}, would run in its own sealed frame on your page. In the {vault} vault it would:</p>
          : <p>The applet <q className="grant-name" data-untrusted="true">{name}</q> (a name from its note, not verified) would run in a sealed frame. In the <strong>{vault}</strong> vault{where} it would:</p>}
        {lines.length ? <ul className="grant-lines">{lines.map((l, i) => <li key={i} className={l.stress ? "grant-stress" : undefined}><New t={`${DETAIL}${l.text}`} />{l.text}</li>)}</ul> : <p className="quiet">Nothing outside itself.</p>}
        <p className="grant-rest">{runs === "approved-code"
          ? <><strong>{APPROVED_CODE_LINE}</strong> It can't delete notes or change notes anywhere else.</>
          : reaches ? <><strong>Nothing else.</strong> It can't delete notes or change notes anywhere else, and it reaches the internet only as the lines above say.</>
          : <><strong>Nothing else.</strong> It can't delete notes, change notes anywhere else, or reach the internet.</>}</p>
        <p className="grant-meta quiet">Lasts until {day.format(expires)}, or until you revoke it · Grant <code>{fingerprint}</code></p>
      </div>
    </section>
  );
}
