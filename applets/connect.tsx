// Connect an AI: one of Parachute's own applets (docs/design/PARACHUTE-SOURCE.md). The address to paste into Claude,
// ChatGPT or any app that speaks MCP, and how. It leads with the hub's one address (`<hub>/mcp`, T-476): the AI then
// reaches every vault the person gives it on the hub's page, names one on each call, and may make new ones. Each
// vault's own address (`<vault>/mcp`) stays, under "Just one vault". A hub that has no one address (an older hub,
// Parachute Cloud today) shows each vault's own, as before. The AI asks the person on their hub's page, so nothing here
// grants anything. It reads which vaults this device holds and their hubs (`vaults`) and copies on a tap (`copy`); then
// what to ask the AI for: an applet, with the guide's address, also to copy.
import { useEffect, useRef, useState } from "react";
import { app, Button, List, Loading, Page, Problem, vaults } from "parachute";

type Held = { key: string; name: string; mine: boolean; home: boolean; connector?: string };
type Hub = { host: string; address: string | null; vaults: string[] };

/** The guide an AI reads to write an applet (the released app's: main). A cold AI connected by its address finds no
 *  word of applets in the vault (T-476 stranger walk: it made a record type, not an applet), so the person hands it this.
 *  The blank is last: after the paste, the person just keeps typing what they want. */
const GUIDE = "https://github.com/ParachuteComputer/parachute/blob/main/docs/WRITE-AN-APPLET.md";
const ASK = `How to write a Parachute applet: ${GUIDE}\nMake me one in my Parachute app that `;

const CSS = `
.cnx .addr { font: var(--fs-small) var(--mono); overflow-wrap: anywhere; user-select: all; -webkit-user-select: all; }
.cnx .how { margin: calc(var(--gap) * 1.5) 0 0; }
.cnx .how h2, .cnx .one h2 { margin: 0 0 4px; font: 600 var(--fs-body) var(--sans); }
.cnx .how p { margin: 0 0 var(--gap); }
.cnx .one { margin: calc(var(--gap) * 2) 0 0; }
.cnx .one > p { margin: 0 0 var(--gap); }
.cnx .ask { white-space: pre-line; }
.cnx .small { font: var(--fs-small) var(--sans); color: var(--muted); }
`;

export default function Connect() {
  const [list, setList] = useState<Held[] | null>(null);
  const [hubs, setHubs] = useState<Hub[] | null>(null);
  const [failed, setFailed] = useState<unknown>(null);
  const [copied, setCopied] = useState<Record<string, "yes" | "failed">>({});
  const [askCopied, setAskCopied] = useState<"yes" | "failed" | null>(null);
  const askTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(askTimer.current), []);
  // each row's "Copied" goes back after a moment, on its own; a new copy restarts it, and leaving clears them
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(() => {
    vaults.list().then((l: Held[]) => setList([...l].sort((a, b) => Number(b.mine) - Number(a.mine) || Number(b.home) - Number(a.home) || a.name.localeCompare(b.name))), setFailed);
    // an older app has no `hubs`: each vault's own address, as before
    const ask = (vaults as { hubs?: () => Promise<Hub[]> }).hubs;
    if (typeof ask !== "function") { setHubs([]); return; }
    ask().then((h) => setHubs(Array.isArray(h) ? h : []), () => setHubs([]));
  }, []);
  // an older app has no copy: the address is selected whole on a press, and the line says so
  const canCopy = typeof (app as { copy?: unknown }).copy === "function";
  const copy = async (key: string, text: string) => {
    const ok = canCopy ? await (app as { copy(t: string): Promise<boolean> }).copy(text).catch(() => false) : false;
    setCopied((c) => ({ ...c, [key]: ok ? "yes" : "failed" }));
    clearTimeout(timers.current.get(key));
    if (ok) timers.current.set(key, setTimeout(() => setCopied((c) => { const n = { ...c }; if (n[key] === "yes") delete n[key]; return n; }), 2500));
  };
  const copyAsk = async () => {
    const ok = canCopy ? await (app as { copy(t: string): Promise<boolean> }).copy(ASK).catch(() => false) : false;
    setAskCopied(ok ? "yes" : "failed");
    clearTimeout(askTimer.current);
    if (ok) askTimer.current = setTimeout(() => setAskCopied((c) => (c === "yes" ? null : c)), 2500);
  };
  if (failed) return <Page title="Connect an AI"><Problem error={failed}>Your vaults couldn't be read</Problem></Page>;
  if (!list || !hubs) return <Page title="Connect an AI"><Loading /></Page>;

  const ones = hubs.filter((h): h is Hub & { address: string } => typeof h.address === "string" && h.address.length > 0);
  // the vaults reached through a hub's one address; the others keep their own address as the only one
  const covered = new Set(ones.flatMap((h) => h.vaults));
  const own = list.filter((v) => v.connector);
  const rest = own.filter((v) => !covered.has(v.key));
  const row = (key: string, title: string, address: string, label: string) => ({
    key, title,
    meta: <span className="addr">{address}</span>,
    aside: canCopy ? <Button small aria-label={`${copied[key] === "yes" ? "Copied" : "Copy"} the address of ${label}`} onClick={() => void copy(key, address)}>{copied[key] === "yes" ? "Copied" : "Copy"}</Button> : undefined,
    under: copied[key] === "failed" || !canCopy ? <span className="small">Press and hold the address to select it.</span> : undefined,
  });
  const vaultRow = (v: Held) => row(v.key, v.name, v.connector!, v.name);
  // "on <host>" whenever another hub's vaults are in the same list
  const several = ones.length > 1 || rest.length > 0;
  const hubRow = (h: Hub & { address: string }) => {
    const title = several ? `All your vaults on ${h.host}` : "All your vaults";
    return row(`hub:${h.host}`, title, h.address, several ? `all your vaults on ${h.host}` : "all your vaults");
  };
  const how = (
    <>
      <section className="how" aria-label="Claude">
        <h2>Claude</h2>
        <p>On claude.ai: <b>Customize → Connectors → + Add → Add custom connector</b>. Paste the address, press Continue, and allow it when Parachute asks.</p>
      </section>
      <section className="how" aria-label="ChatGPT">
        <h2>ChatGPT</h2>
        <p>In Settings, <b>Apps &amp; Connectors</b>: create a custom connector (an MCP server) and paste the same address. It needs a paid plan, and may need Developer mode.</p>
      </section>
    </>
  );
  const askFor = (
    <section className="how" aria-label="Then ask it for an applet">
      <h2>Then ask it for an applet</h2>
      <p>Your AI can make you an applet: a small app here that keeps what it needs in your vault. Copy this, paste it to your AI, and finish the sentence with what you want:</p>
      <p className="addr ask">{ASK}</p>
      {canCopy && <Button small aria-label={askCopied === "yes" ? "Copied what to ask" : "Copy what to ask"} onClick={() => void copyAsk()}>{askCopied === "yes" ? "Copied" : "Copy"}</Button>}
      {(askCopied === "failed" || !canCopy) && <p className="small">Press and hold the line to select it.</p>}
    </section>
  );

  if (ones.length === 0) {
    return (
      <Page title="Connect an AI" className="cnx">
        <style>{CSS}</style>
        <p>Claude, ChatGPT and other AIs read and write a vault through its address. Copy one, paste it into your AI, and allow it on Parachute's page, with write if it should save things there.</p>
        <List label="Your vaults' addresses" hideLabel rows={own.map(vaultRow)} />
        {how}
        <p className="small">Each address reaches that one vault only. Cursor, Claude Code and any other MCP app take the same address.</p>
        {askFor}
      </Page>
    );
  }
  return (
    <Page title="Connect an AI" className="cnx">
      <style>{CSS}</style>
      <p>Claude, ChatGPT and other AIs reach your vaults through one address. Copy it, paste it into your AI, and choose its vaults when Parachute asks: <b>Write</b> for each one it should save to, so it can remember things there.</p>
      <List label="Your address for AIs" hideLabel rows={[...ones.map(hubRow), ...rest.map(vaultRow)]} />
      {how}
      <p className="small">Cursor, Claude Code and any other MCP app take the same address.</p>
      {askFor}
      {own.some((v) => covered.has(v.key)) ? (
        <section className="one" aria-label="Just one vault">
          <h2>Just one vault</h2>
          <p className="small">To give an AI one vault only, paste that vault's own address instead.</p>
          <List label="Each vault's own address" hideLabel rows={own.filter((v) => covered.has(v.key)).map(vaultRow)} />
        </section>
      ) : null}
    </Page>
  );
}
