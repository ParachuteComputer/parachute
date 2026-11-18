// Connect an AI (docs/SIMPLE.md): each vault's connector address, to paste into Claude, ChatGPT or any app that speaks
// MCP, and how. The address is the vault's own (`<vault>/mcp`, as Parachute Cloud's Connect page gives it); the AI then
// asks the person on their hub's page, so nothing here grants anything.
import { useEffect, useState } from "react";
import { Bar } from "../ui/Bar";
import { useVaults } from "../vault/hooks";
import { vaultUrlOf, type VaultRecord } from "../vault/store";
import { isMine } from "../vault/whose";

/** A vault's connector address: where an AI's MCP client connects. */
export const connectorAddress = (r: Pick<VaultRecord, "issuer" | "vault" | "url">) => `${vaultUrlOf(r).replace(/\/$/, "")}/mcp`;

function Address({ r }: { r: VaultRecord }) {
  const [copied, setCopied] = useState<"no" | "yes" | "failed">("no");
  const address = connectorAddress(r);
  useEffect(() => { if (copied !== "yes") return; const t = setTimeout(() => setCopied("no"), 2500); return () => clearTimeout(t); }, [copied]);
  const copy = () => {
    if (!navigator.clipboard) { setCopied("failed"); return; }
    navigator.clipboard.writeText(address).then(() => setCopied("yes"), () => setCopied("failed"));
  };
  return (
    <li className="connect-vault">
      <span className="connect-name">{r.vault}</span>
      <code className="connect-address">{address}</code>
      <button type="button" className="secondary connect-copy" aria-label={`${copied === "yes" ? "Copied" : "Copy"} the address of ${r.vault}`} onClick={copy}>
        {copied === "yes" ? "Copied" : "Copy"}
      </button>
      {copied === "failed" && <span className="small error connect-failed" role="alert">This device didn't let the app copy it: press and hold the address to select it.</span>}
    </li>
  );
}

export default function Connect() {
  const vaults = useVaults();
  // the person's own first; another's vault can be connected too, if they may reach it
  const list = [...vaults].sort((a, b) => Number(isMine(b)) - Number(isMine(a)) || a.vault.localeCompare(b.vault));
  return (
    <main className="screen connect">
      <Bar title="Connect an AI" back={true} />
      <p className="lead">Claude, ChatGPT and other AIs read and write a vault through its address. Copy one, paste it into your AI, and allow it on Parachute's page.</p>
      <ul className="plain connect-list" aria-label="Your vaults' addresses">
        {list.map((r) => <Address key={r.key} r={r} />)}
      </ul>
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
