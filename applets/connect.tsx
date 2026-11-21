// Connect an AI: one of Parachute's own applets (docs/design/PARACHUTE-SOURCE.md). Each vault's connector address, to
// paste into Claude, ChatGPT or any app that speaks MCP, and how. The address is the vault's own (`<vault>/mcp`, as
// Parachute Cloud's Connect page gives it); the AI then asks the person on their hub's page, so nothing here grants
// anything. It reads which vaults this device holds (`vaults`) and copies an address on a tap (`copy`); then what to ask
// the AI for: an applet, with the guide's address, also to copy.
import { useEffect, useRef, useState } from "react";
import { app, Button, List, Loading, Page, Problem, vaults } from "parachute";

type Held = { key: string; name: string; mine: boolean; home: boolean; connector?: string };

/** The guide an AI reads to write an applet (the released app's: main). A cold AI connected by its address finds no
 *  word of applets in the vault (T-476 stranger walk: it made a record type, not an applet), so the person hands it this.
 *  The blank is last: after the paste, the person just keeps typing what they want. */
const GUIDE = "https://github.com/ParachuteComputer/parachute/blob/main/docs/WRITE-AN-APPLET.md";
const ASK = `How to write a Parachute applet: ${GUIDE}\nMake me one in my Parachute app that `;

const CSS = `
.cnx .addr { font: var(--fs-small) var(--mono); overflow-wrap: anywhere; user-select: all; -webkit-user-select: all; }
.cnx .how { margin: calc(var(--gap) * 1.5) 0 0; }
.cnx .how h2 { margin: 0 0 4px; font: 600 var(--fs-body) var(--sans); }
.cnx .how p { margin: 0 0 var(--gap); }
.cnx .ask { white-space: pre-line; }
.cnx .small { font: var(--fs-small) var(--sans); color: var(--muted); }
`;

export default function Connect() {
  const [list, setList] = useState<Held[] | null>(null);
  const [failed, setFailed] = useState<unknown>(null);
  const [copied, setCopied] = useState<Record<string, "yes" | "failed">>({});
  const [askCopied, setAskCopied] = useState<"yes" | "failed" | null>(null);
  const askTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(askTimer.current), []);
  // each row's "Copied" goes back after a moment, on its own; a new copy restarts it, and leaving clears them
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(() => { vaults.list().then((l: Held[]) => setList([...l].sort((a, b) => Number(b.mine) - Number(a.mine) || Number(b.home) - Number(a.home) || a.name.localeCompare(b.name))), setFailed); }, []);
  // an older app has no copy: the address is selected whole on a press, and the line says so
  const canCopy = typeof (app as { copy?: unknown }).copy === "function";
  const copy = async (v: Held) => {
    const ok = canCopy && v.connector ? await (app as { copy(t: string): Promise<boolean> }).copy(v.connector).catch(() => false) : false;
    setCopied((c) => ({ ...c, [v.key]: ok ? "yes" : "failed" }));
    clearTimeout(timers.current.get(v.key));
    if (ok) timers.current.set(v.key, setTimeout(() => setCopied((c) => { const n = { ...c }; if (n[v.key] === "yes") delete n[v.key]; return n; }), 2500));
  };
  const copyAsk = async () => {
    const ok = canCopy ? await (app as { copy(t: string): Promise<boolean> }).copy(ASK).catch(() => false) : false;
    setAskCopied(ok ? "yes" : "failed");
    clearTimeout(askTimer.current);
    if (ok) askTimer.current = setTimeout(() => setAskCopied((c) => (c === "yes" ? null : c)), 2500);
  };
  if (failed) return <Page title="Connect an AI"><Problem error={failed}>Your vaults couldn't be read</Problem></Page>;
  if (!list) return <Page title="Connect an AI"><Loading /></Page>;
  return (
    <Page title="Connect an AI" className="cnx">
      <style>{CSS}</style>
      <p>Claude, ChatGPT and other AIs read and write a vault through its address. Copy one, paste it into your AI, and allow it on Parachute's page.</p>
      <List label="Your vaults' addresses" hideLabel rows={list.filter((v) => v.connector).map((v) => ({
        key: v.key, title: v.name,
        meta: <span className="addr">{v.connector}</span>,
        aside: canCopy ? <Button small aria-label={`${copied[v.key] === "yes" ? "Copied" : "Copy"} the address of ${v.name}`} onClick={() => void copy(v)}>{copied[v.key] === "yes" ? "Copied" : "Copy"}</Button> : undefined,
        under: copied[v.key] === "failed" || !canCopy ? <span className="small">Press and hold the address to select it.</span> : undefined,
      }))} />
      <section className="how" aria-label="Claude">
        <h2>Claude</h2>
        <p>On claude.ai: <b>Customize → Connectors → + Add → Add custom connector</b>. Paste the address, press Continue, and allow it when Parachute asks.</p>
      </section>
      <section className="how" aria-label="ChatGPT">
        <h2>ChatGPT</h2>
        <p>In Settings, <b>Apps &amp; Connectors</b>: create a custom connector (an MCP server) and paste the same address. It needs a paid plan, and may need Developer mode.</p>
      </section>
      <p className="small">Each address reaches that one vault only. Cursor, Claude Code and any other MCP app take the same address.</p>
      <section className="how" aria-label="Then ask it for an applet">
        <h2>Then ask it for an applet</h2>
        <p>Your AI can make you an applet: a small app here that keeps what it needs in your vault. Copy this, paste it to your AI, and finish the sentence with what you want:</p>
        <p className="addr ask">{ASK}</p>
        {canCopy && <Button small aria-label={askCopied === "yes" ? "Copied what to ask" : "Copy what to ask"} onClick={() => void copyAsk()}>{askCopied === "yes" ? "Copied" : "Copy"}</Button>}
        {(askCopied === "failed" || !canCopy) && <p className="small">Press and hold the line to select it.</p>}
      </section>
    </Page>
  );
}
