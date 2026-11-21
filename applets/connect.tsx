// Connect an AI: one of Parachute's own applets (docs/design/PARACHUTE-SOURCE.md). Each vault's connector address, to
// paste into Claude, ChatGPT or any app that speaks MCP, and how. The address is the vault's own (`<vault>/mcp`, as
// Parachute Cloud's Connect page gives it); the AI then asks the person on their hub's page, so nothing here grants
// anything. It reads which vaults this device holds (`vaults`) and copies an address on a tap (`copy`).
import { useEffect, useState } from "react";
import { app, Button, List, Loading, Page, Problem, vaults } from "parachute";

type Held = { key: string; name: string; mine: boolean; home: boolean; connector?: string };

const CSS = `
.cnx .addr { font: var(--fs-small) var(--mono); overflow-wrap: anywhere; user-select: all; -webkit-user-select: all; }
.cnx .how { margin: calc(var(--gap) * 1.5) 0 0; }
.cnx .how h2 { margin: 0 0 4px; font: 600 var(--fs-body) var(--sans); }
.cnx .how p { margin: 0 0 var(--gap); }
.cnx .small { font: var(--fs-small) var(--sans); color: var(--muted); }
`;

export default function Connect() {
  const [list, setList] = useState<Held[] | null>(null);
  const [failed, setFailed] = useState<unknown>(null);
  const [copied, setCopied] = useState<Record<string, "yes" | "failed">>({});
  useEffect(() => { vaults.list().then((l: Held[]) => setList([...l].sort((a, b) => Number(b.mine) - Number(a.mine) || Number(b.home) - Number(a.home) || a.name.localeCompare(b.name))), setFailed); }, []);
  // an older app has no copy: the address is selected whole on a press, and the line says so
  const canCopy = typeof (app as { copy?: unknown }).copy === "function";
  const copy = async (v: Held) => {
    const ok = canCopy && v.connector ? await (app as { copy(t: string): Promise<boolean> }).copy(v.connector).catch(() => false) : false;
    setCopied((c) => ({ ...c, [v.key]: ok ? "yes" : "failed" }));
    if (ok) setTimeout(() => setCopied((c) => { const n = { ...c }; if (n[v.key] === "yes") delete n[v.key]; return n; }), 2500);
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
    </Page>
  );
}
