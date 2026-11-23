// Which vaults an applet reaches (docs/ACCESS.md proposal 5), as the person sees it: the ticks (on an applet's card, or
// on the shell's sheet), the line the shell draws over one of Parachute's own (*Vault reaches kitchen · Change*), and the
// line for a vault it was given that this device doesn't hold (*letters isn't on this device · Open*). Every word here is
// the app's; the applet never sees the list it was picked from.
import { useEffect, useRef, useState } from "react";
import { useSettledPress } from "../ui/press";
import { listedVaults } from "../vault/newVaults";
import { hostOf, listVaults, originOf } from "../vault/store";
import { isMine, whoseSaid } from "../vault/whose";
import { homeVault } from "../shell/frameSource";
import { namesLine, refKey, sameRef, sortPick, type VaultRef } from "../applet/vaultPick";

/** One vault to tick: every vault this device holds, and every other the person reaches on those hubs. */
export type Choice = { ref: VaultRef; name: string; host: string; held: boolean; theirs: boolean; home: boolean };

/** The vaults on offer, home first: each held vault, then the others the hubs listed. A vault's name alone, or with its
 *  hub's host where two hubs hold one of that name. */
export function pickChoices(): Choice[] {
  const held = listVaults();
  const home = homeVault();
  const out: Choice[] = held.map((v) => ({ ref: { hub: originOf(v.issuer), vault: v.vault }, name: v.vault, host: hostOf(v.issuer), held: true, theirs: !isMine(v), home: home?.key === v.key }));
  for (const hub of [...new Set(held.map((v) => originOf(v.issuer)))]) {
    for (const name of listedVaults(hub)) {
      if (out.some((c) => c.ref.hub === hub && c.ref.vault === name)) continue;
      out.push({ ref: { hub, vault: name }, name, host: hostOf(hub), held: false, theirs: whoseSaid({ issuer: hub, vault: name }) !== "mine", home: false });
    }
  }
  const twice = new Set(out.filter((c, i) => out.findIndex((d) => d.name === c.name) !== i).map((c) => c.name));
  return out.map((c) => (twice.has(c.name) ? { ...c, name: `${c.name} on ${c.host}` } : c))
    .sort((a, b) => Number(b.home) - Number(a.home) || Number(b.held) - Number(a.held) || a.name.localeCompare(b.name));
}

/** The names of these vaults, as the ticks call them. */
export function namesOf(refs: readonly VaultRef[], choices: readonly Choice[] = pickChoices()): string[] {
  return sortPick(refs).map((r) => choices.find((c) => sameRef(c.ref, r))?.name ?? r.vault);
}
export const reachLine = (applet: string, refs: readonly VaultRef[], choices?: readonly Choice[]) => `${applet} reaches ${namesLine(namesOf(refs, choices))}`;

/** The ticks: one per vault on offer; `one`: a choice of one. */
export function PickTicks({ choices, ticked, onChange, legend = "Which vaults may it reach?", one = false }: {
  choices: readonly Choice[]; ticked: readonly VaultRef[]; onChange: (next: VaultRef[]) => void; legend?: string; one?: boolean }) {
  const on = (r: VaultRef) => ticked.some((t) => sameRef(t, r));
  const flip = (r: VaultRef) => onChange(one ? [r] : on(r) ? ticked.filter((t) => !sameRef(t, r)) : [...ticked, r]);
  return (
    <fieldset className="plain pick-ticks">
      <legend>{legend}</legend>
      {choices.map((c) => (
        <label key={refKey(c.ref)} className="line"><span>
          <input type={one ? "radio" : "checkbox"} name={one ? "pick-one" : undefined} checked={on(c.ref)} onChange={() => flip(c.ref)} /> {c.name}
          {(c.home || c.theirs || !c.held) && <span className="quiet"> · {[c.home ? "your home" : null, c.theirs ? "someone else's" : null, c.held ? null : "not on this device yet"].filter(Boolean).join(" · ")}</span>}
        </span></label>
      ))}
      <p className="small quiet">Only the vaults you tick. A vault you add later isn't in it until you tick it here.</p>
    </fieldset>
  );
}

/** The shell's own sheet to change what an applet reaches: over the applet, answered by a real tap. */
export function PickSheet({ name, initial, onSave, onCancel, error, passcode, one = false }: {
  name: string; initial: readonly VaultRef[]; onSave: (picked: VaultRef[]) => void; onCancel: () => void; error?: string | null;
  /** the passcode's box, when approving here asks it (levels) */ passcode?: { value: string; set: (v: string) => void } | null; one?: boolean }) {
  const [choices] = useState(pickChoices);
  const [ticked, setTicked] = useState<VaultRef[]>(() => sortPick(initial));
  const cancel = useRef<HTMLButtonElement>(null);
  const press = useSettledPress(700);
  useEffect(() => { cancel.current?.focus(); const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); }; addEventListener("keydown", esc); return () => removeEventListener("keydown", esc); }, [onCancel]);
  return (
    <div className="sheet-scrim sheet-over-frames" role="presentation">
      <section className="sheet" role="dialog" aria-modal="true" aria-label={`Vaults ${name} reaches`}>
        <h2>Vaults {name} reaches</h2>
        <PickTicks choices={choices} ticked={ticked} onChange={setTicked} one={one} legend={one ? `Which vault does ${name} keep its notes in?` : `Which vaults may ${name} reach?`} />
        {passcode && <label className="line passcode-line"><span>Your passcode, to approve it</span> <input type="password" autoComplete="off" aria-label="Your passcode" value={passcode.value} onChange={(e) => passcode.set(e.target.value)} /></label>}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="grant-actions">
          <button ref={cancel} type="button" className="quiet-button" onClick={onCancel}>Cancel</button>
          <button type="button" className="primary" disabled={!ticked.length} {...press.bind} onClick={(e) => { if (press.counts(e) && ticked.length) onSave(sortPick(ticked)); }}>Save</button>
        </div>
      </section>
    </div>
  );
}

/** The line over one of Parachute's own: what it reaches, and Change. It never blocks the applet. */
export function PickLine({ text, onChange, onDismiss, act = "Change" }: { text: string; onChange: () => void; onDismiss?: () => void; act?: string }) {
  return (
    <p className="pick-line" role="note">
      <span>{text}</span> · <button type="button" className="link-button" onClick={(e) => { if (e.isTrusted) onChange(); }}>{act}</button>
      {onDismiss && <button type="button" className="link-button pick-line-x" aria-label="Hide this line" onClick={onDismiss}>×</button>}
    </p>
  );
}

/** A vault it was given that this device doesn't hold: Open asks its hub for it (one page). */
export function MissingLine({ refs, onOpen, choices }: { refs: readonly VaultRef[]; onOpen: (r: VaultRef) => void; choices?: readonly Choice[] }) {
  if (!refs.length) return null;
  const r = refs[0];
  const [name] = namesOf([r], choices);
  return (
    <p className="pick-line" role="note">
      <span>{name} isn't on this device{refs.length > 1 ? ` (and ${refs.length - 1} more)` : ""}</span> · <button type="button" className="link-button" onClick={(e) => { if (e.isTrusted) onOpen(r); }}>Open</button>
    </p>
  );
}

// the line over one of Parachute's own, hidden with its ×: on this device, until it is picked for
const HIDDEN_KEY = "parachute.pickline.hidden.v1";
const hiddenNow = (): string[] => { try { const v = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]") as unknown; return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(-100) : []; } catch { return []; } };
export const lineHidden = (d: string) => hiddenNow().includes(d);
export const hideLine = (d: string) => { try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hiddenNow().filter((x) => x !== d), d])); } catch { /* this session */ } };
