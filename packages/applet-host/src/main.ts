// @openparachute/applet-host: one Parachute applet as an MCP App view, the way the app runs it.
//
// The connector serves this page as `ui://parachute/applet/<id>` with the applet in it (payload.ts): its record and its
// code, which the connector lists only when the person approved that exact code (a signed approval from their device,
// checked against the hub's record of their keys). The view is the shell: it compiles the code as the app does
// (code.ts), and runs it in the app's sealed frame (srcdoc.ts: its own content policy, an opaque origin, no network),
// nested inside this view. The frame's only door is the app's contract session (session.ts), routed (router.ts) to the
// app's own vault module (modules/vault.ts), whose legs are the host's tools/call (mcpVault.ts). So the applet reaches
// only the record tools, only in its manifest's folders, exactly as in the app; it never sees the host's bridge.
import vaultClientSource from "virtual:vault-client-kit";
import reactKitSource from "virtual:react-kit";
import reactNoteKitSource from "virtual:react-note-kit";
import { buildKitSource } from "../../../src/applet/kits";
import { buildSrcdoc, NO_DEVICES } from "../../../src/applet/srcdoc";
import { codeHash, codeKindOf, modulePage, transpile, usesNote, type CodeKind } from "../../../src/applet/code";
import { readApplet, resolvedOf, type AppletEntry } from "../../../src/applet/discovery";
import { createRouter } from "../../../src/applet/router";
import { createSession, type Session } from "../../../src/applet/session";
import { createVaultModule } from "../../../src/applet/modules/vault";
import { createThemeModule } from "../../../src/applet/modules/theme";
import { createSavedModule } from "../../../src/applet/modules/saved";
import { createBackModule } from "../../../src/applet/modules/back";
import { DEFAULT_THEME, cssOf, tokensOf, type Tokens } from "../../../src/theme/theme";
import { frameHead } from "../../../src/kit/frameCss";
import { connectHost, type Host } from "./host";
import { mcpVaultDeps } from "./mcpVault";
import { readPayload, type Payload } from "./payload";
import { asksFor } from "./asks";

declare const __HOST_VERSION__: string;
const root = document.getElementById("root")!;

/** A line of words in place of the applet (loading, or why it can't run). */
function say(words: string) {
  root.replaceChildren(Object.assign(document.createElement("p"), { className: "say", textContent: words }));
}

const tokensFor = (host: Host): Tokens => tokensOf(DEFAULT_THEME, host.context().theme === "dark");

/** What runs in the frame: an HTML applet as written, a TSX/JSX one as its compiled module with React. */
async function pageOf(kind: CodeKind, code: string, name: string): Promise<{ ok: true; html: string } | { ok: false; why: string }> {
  if (kind === "html") return { ok: true, html: code };
  const out = await transpile(code, kind);
  if (!out.ok) return { ok: false, why: `${name} couldn't be read: ${out.error}` };
  return { ok: true, html: modulePage(out.js, usesNote(code) ? reactNoteKitSource : reactKitSource, [], name) };
}

function run(host: Host, p: Payload, entry: AppletEntry, html: string) {
  let tokens = tokensFor(host);
  const saved: Record<string, unknown> = {};
  const router = createRouter([
    createVaultModule(mcpVaultDeps((name, args) => host.callTool(name, args)), { opens: entry.opens, name: p.vault, emit: (event, data) => session?.sendEvent(event, data) }),
    createThemeModule({ theme: () => tokens }),
    // what the kit saves as the person goes (drafts, where it was): kept while this view is open
    createSavedModule({ all: async () => ({ ...saved }), put: async (entries) => { Object.assign(saved, entries); return "ok"; } }),
    createBackModule(() => {}),
  ]);
  const grant = resolvedOf(entry.manifest);
  const doc = buildSrcdoc(html, { kitSource: buildKitSource({ vaultClientSource }), headExtra: frameHead(cssOf(tokens)) });
  const frame = document.createElement("iframe");
  frame.title = entry.manifest.name;
  frame.className = "applet";
  // the app's seal: scripts only, an opaque origin (no storage, no reach into this view), no devices, no referrer
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("allow", NO_DEVICES);
  frame.referrerPolicy = "no-referrer";
  let session: Session | null = createSession({ post: (m) => frame.contentWindow?.postMessage(m, "*"), router, grant });
  // only the frame's own window talks to its session (the host's messages come from window.parent: host.ts)
  window.addEventListener("message", (e) => { if (e.source !== null && e.source === frame.contentWindow) session?.handle(e.data); });
  let loaded = false;
  frame.addEventListener("load", () => {
    // a second load of the frame is a navigation away from its document: stopped, as the app stops it
    if (loaded) { session?.close(); session = null; frame.remove(); say(`${entry.manifest.name} tried to leave its sandbox and was stopped.`); return; }
    loaded = true;
    session?.sendEvent("ready", { contract: 1, applet: { id: entry.manifest.id, name: entry.manifest.name }, access: entry.manifest.allow, services: [], shown: true, saved: { ...saved }, theme: tokens });
  });
  frame.srcdoc = doc;
  root.replaceChildren(frame);
  return {
    theme() { const t = tokensFor(host); if (JSON.stringify(t) !== JSON.stringify(tokens)) { tokens = t; session?.sendEvent("theme", t); } },
    stop() { session?.close(); session = null; },
  };
}

async function main() {
  say("Opening…");
  const payload = readPayload(document);
  let running: ReturnType<typeof run> | null = null;
  const look = (c: { displayMode?: string; theme?: string }) => { document.documentElement.dataset.mode = c.displayMode ?? "inline"; document.documentElement.style.colorScheme = c.theme ?? ""; };
  // outside a host nothing answers: say so rather than wait for good
  const alone = setTimeout(() => say("This is a Parachute applet's view. It opens inside an AI app that shows Parachute's applets, such as Claude."), 10_000);
  const host = await connectHost({
    context: (c) => { look(c); running?.theme(); },
    teardown: () => running?.stop(),
  }, { name: "Parachute", version: typeof __HOST_VERSION__ === "string" ? __HOST_VERSION__ : "dev" });
  clearTimeout(alone);
  look(host.context());
  if (!payload.ok) { say(payload.why); return; }
  const p = payload.payload;
  const a = readApplet({ id: p.record.id, path: p.record.path, tags: p.record.tags, metadata: p.record.fields }, p.vault, true);
  if (!a.ok) { say(`This applet can't open here: ${a.error}.`); return; }
  if (a.entry.newer) { say(`${a.entry.manifest.name} needs a newer Parachute.`); return; }
  const kind = codeKindOf(p.record);
  if (!kind) { say(`${a.entry.manifest.name} isn't code Parachute runs.`); return; }
  // the connector sent this code because the person approved its hash; the view checks the same hash itself
  if ((await codeHash(kind, p.code)) !== p.approval.code) { say(`${a.entry.manifest.name} changed since you approved it. Approve it again in Parachute.`); return; }
  // and what it asks for: its fields as they are now, hashed as the approving device hashed them
  const asks = await asksFor(p);
  if (!asks.ok) { say(`${a.entry.manifest.name} can't open here: ${asks.why}.`); return; }
  if (asks.scope !== p.approval.scope) { say(`${a.entry.manifest.name} asks for more than when you approved it. Approve it again in Parachute.`); return; }
  const page = await pageOf(kind, p.code, a.entry.manifest.name);
  if (!page.ok) { say(page.why); return; }
  running = run(host, p, a.entry, page.html);
  // inline, the host sizes the view to what it asks: a screen's worth (an applet is a page, not a card)
  if ((host.context().displayMode ?? "inline") === "inline") host.sizeChanged(640);
}

main().catch((e) => say(`Something went wrong: ${e instanceof Error ? e.message : String(e)}`));
