// Connect an AI (docs/SIMPLE.md): each vault's connector address, to paste into Claude, ChatGPT or any app that speaks
// MCP, and how. The address is the vault's own (`<vault>/mcp`, as Parachute Cloud's Connect page gives it); the AI then
// asks the person on their hub's page, so nothing here grants anything.
import { useEffect, useRef, useState } from "react";
import { Bar } from "../ui/Bar";
import { useVaults } from "../vault/hooks";
import { vaultUrlOf, type VaultRecord } from "../vault/store";
import { isMine } from "../vault/whose";
import { List, type Row } from "../kit/parts";
import { Button, Problem } from "../kit/screen";

/** A vault's connector address: where an AI's MCP client connects. */
export const connectorAddress = (r: Pick<VaultRecord, "issuer" | "vault" | "url">) => `${vaultUrlOf(r).replace(/\/$/, "")}/mcp`;

/** Each vault's row, as the kit's List draws one: its name, its address (held, it selects whole), and Copy. */
function Addresses({ list }: { list: VaultRecord[] }) {
  const [copied, setCopied] = useState<Record<string, "yes" | "failed">>({});
  const was = (k: string, v: "yes" | "failed" | null) => setCopied((c) => { const n = { ...c }; if (v) n[k] = v; else delete n[k]; return n; });
  // "Copied" goes back to "Copy" after a moment, each row on its own
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const copied_ = (k: string) => {
    was(k, "yes");
    clearTimeout(timers.current.get(k));
    timers.current.set(k, setTimeout(() => was(k, null), 2500));
  };
  const copy = (r: VaultRecord) => {
    if (!navigator.clipboard) { was(r.key, "failed"); return; }
    navigator.clipboard.writeText(connectorAddress(r)).then(() => copied_(r.key), () => was(r.key, "failed"));
  };
  return <List label="Your vaults' addresses" hideLabel rows={list.map((r): Row => ({
    key: r.key, title: r.vault,
    meta: <code className="connect-address">{connectorAddress(r)}</code>,
    aside: <Button small aria-label={`${copied[r.key] === "yes" ? "Copied" : "Copy"} the address of ${r.vault}`} onClick={() => copy(r)}>{copied[r.key] === "yes" ? "Copied" : "Copy"}</Button>,
    under: copied[r.key] === "failed" ? <Problem>This device didn't let the app copy it: press and hold the address to select it.</Problem> : undefined,
  }))} />;
}

export default function Connect() {
  const vaults = useVaults();
  // the person's own first; another's vault can be connected too, if they may reach it
  const list = [...vaults].sort((a, b) => Number(isMine(b)) - Number(isMine(a)) || a.vault.localeCompare(b.vault));
  return (
    <main className="screen connect">
      <Bar title="Connect an AI" back={true} />
      <p className="lead">Claude, ChatGPT and other AIs read and write a vault through its address. Copy one, paste it into your AI, and allow it on Parachute's page.</p>
      <Addresses list={list} />
      <section className="card connect-how" aria-label="Claude">
        <h2>Claude</h2>
        <p>On claude.ai: <b>Customize → Connectors → + Add → Add custom connector</b>. Paste the address, press Continue, and allow it when Parachute asks.</p>
      </section>
      <section className="card connect-how" aria-label="ChatGPT">
        <h2>ChatGPT</h2>
        <p>In Settings, <b>Apps &amp; Connectors</b>: create a custom connector (an MCP server) and paste the same address. It needs a paid plan, and may need Developer mode.</p>
      </section>
      <p className="quiet small">Each address reaches that one vault only. Cursor, Claude Code and any other MCP app take the same address.</p>
    </main>
  );
}
