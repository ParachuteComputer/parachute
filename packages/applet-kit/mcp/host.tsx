// T-476 Spike B: a Parachute applet as an MCP App view. The connector's `open-applet` tool names this view
// (ui://parachute/applet-host); the host (Claude, ChatGPT, basic-host) shows it and hands it the tool's result: the
// vault's applets, and which one to open. The view reads that applet's record through the host's tools/call, turns its
// TSX into JavaScript as the app does (code.ts transpile, sucrase), and runs it on the web kit (web.ts), whose vault is
// the connector (client.ts). One view for every applet: a new applet in the vault needs no build.
import { App } from "@modelcontextprotocol/ext-apps";
import * as React from "react";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import * as JsxRuntime from "react/jsx-runtime";
import * as Parachute from "../src/parachute.ts";
import { installWebKit, linkClient } from "../src/web.ts";
import { transpile, codeKindOf } from "../../../src/applet/code.ts";
import { mcpVaultClient, vaultError } from "./client.ts";

type Applet = { id: string; name: string; path: string; glyph?: string; note?: string };
type Opened = { applets?: Applet[]; open?: string | null; vault?: string };

const root = document.getElementById("root")!;
const app = new App({ name: "Parachute", version: "0.1.0" }, { availableDisplayModes: ["inline", "fullscreen"] });

// one tool call through the host; the vault's refusals (JSON-RPC errors, or isError replies) come back as vaultError
async function call(name: string, args: Record<string, unknown>): Promise<unknown> {
  let r;
  try { r = await app.callServerTool({ name, arguments: args }); }
  catch (e) { const x = e as { message?: string; data?: Record<string, unknown> }; throw vaultError(x.message ?? String(e), x.data); }
  const text = (r.content ?? []).find((b) => b.type === "text") as { text?: string } | undefined;
  if (r.isError) throw vaultError(text?.text ?? "the vault refused", r.structuredContent as Record<string, unknown> | undefined);
  if (r.structuredContent !== undefined) return r.structuredContent;
  try { return JSON.parse(text?.text ?? "null"); } catch { return text?.text; }
}

const MODULES: Record<string, unknown> = { react: React, "react-dom": ReactDOM, "react-dom/client": ReactDOMClient, "react/jsx-runtime": JsxRuntime, parachute: Parachute };
let reactRoot: ReactDOMClient.Root | null = null;
const show = (el: React.ReactNode) => { (reactRoot ??= ReactDOMClient.createRoot(root)).render(el); };
const plain = (t: string) => show(<p style={{ font: "15px/1.5 Georgia, serif", padding: 24, color: "var(--muted, #666)" }}>{t}</p>);

/** Read the applet's record, compile it, and run it in this page, on the web kit. */
async function run(a: Applet) {
  plain(`Opening ${a.name}…`);
  const rec = (await call("query-records", { id: a.path, include_body: true })) as { body?: string; extension?: string; path?: string; fields?: { applet?: { id?: string; name?: string } } };
  const kind = codeKindOf(rec);
  if (kind !== "tsx" && kind !== "jsx") { plain(`${a.name} is an HTML applet; this spike runs TSX and JSX applets.`); return; }
  const out = await transpile(rec.body ?? "", kind);
  if (!out.ok) { plain(`${a.name} couldn't be read: ${out.error}`); return; }
  installWebKit({ id: rec.fields?.applet?.id ?? a.id, name: rec.fields?.applet?.name ?? a.name });
  linkClient(mcpVaultClient(call), "claude");
  // the module runs as an inline script (the view's CSP allows inline scripts, not eval), CommonJS as the frame's loader runs it
  const w = window as unknown as { __parachuteModule?: (require: (n: string) => unknown, module: { exports: Record<string, unknown> }, exports: Record<string, unknown>) => void };
  const s = document.createElement("script");
  s.textContent = `window.__parachuteModule = function (require, module, exports) {\n${out.js}\n};`;
  document.head.appendChild(s);
  const mod = { exports: {} as Record<string, unknown> };
  w.__parachuteModule!((n) => { if (n in MODULES) return MODULES[n]; throw new Error(`${a.name} imports ${n}, which applets can't`); }, mod, mod.exports);
  const C = mod.exports.default as React.ComponentType | undefined;
  if (!C) { plain(`${a.name} has no default export to show.`); return; }
  show(<C />);
}

function Launcher({ applets, vault }: { applets: Applet[]; vault?: string }) {
  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: "20px 16px", font: "16px/1.45 Georgia, 'Iowan Old Style', serif" }}>
      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Parachute</h1>
      <p style={{ margin: "0 0 14px", opacity: 0.7, fontSize: 14 }}>{vault ? `Applets in ${vault}` : "Your applets"}</p>
      {applets.length === 0 ? <p>No applets in this vault yet.</p> : applets.map((a) => (
        <button key={a.path} onClick={() => run(a).catch(fail)} style={{ display: "flex", gap: 12, alignItems: "baseline", width: "100%", textAlign: "left", padding: "12px 4px", border: 0, borderTop: "1px solid #8884", background: "none", color: "inherit", font: "inherit", cursor: "pointer" }}>
          <span style={{ width: 22 }}>{a.glyph ?? "◇"}</span>
          <span><b style={{ fontWeight: 600 }}>{a.name}</b>{a.note ? <span style={{ display: "block", fontSize: 14, opacity: 0.7 }}>{a.note}</span> : null}</span>
        </button>
      ))}
    </main>
  );
}

const fail = (e: unknown) => plain(`Something went wrong: ${(e as Error)?.message ?? e}`);

app.ontoolresult = (result) => {
  const o = (result.structuredContent ?? {}) as Opened;
  const applets = o.applets ?? [];
  const pick = o.open ? applets.find((a) => a.path === o.open || a.id === o.open || a.name.toLowerCase() === String(o.open).toLowerCase()) : null;
  if (pick) run(pick).catch(fail); else show(<Launcher applets={applets} vault={o.vault} />);
};
app.onhostcontextchanged = (ctx) => { if (ctx.theme) document.documentElement.style.colorScheme = ctx.theme; };

plain("Loading…");
app.connect().then(() => {
  const ctx = app.getHostContext();
  if (ctx?.theme) document.documentElement.style.colorScheme = ctx.theme;
}).catch(fail);
