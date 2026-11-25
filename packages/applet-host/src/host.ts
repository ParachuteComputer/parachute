// The view's side of the MCP Apps protocol (SEP-1865, stable 2026-01-26): JSON-RPC over postMessage with the host
// (Claude, ChatGPT, the ext-apps reference host). The few messages this view needs, by hand, so it ships no SDK:
//   ui/initialize → result {hostContext, hostCapabilities}; then ui/notifications/initialized
//   tools/call (proxied by the host to the connector this view came from)
//   ui/notifications/size-changed (inline: the height the view wants)
//   from the host: ui/notifications/tool-input, tool-result, host-context-changed, tool-cancelled; requests
//   ui/resource-teardown and ping (answered {}); any other request: method not found.
// Only messages from `window.parent` (the host's sandbox proxy) are read: the applet's own frame inside this view posts
// to this window too, and its messages go to the sealed session, never here (main.ts).
import { Refusal } from "./mcpVault";

export const PROTOCOL_VERSION = "2026-01-26";
type Json = Record<string, unknown>;
export type HostContext = { theme?: "light" | "dark"; displayMode?: string; availableDisplayModes?: string[]; containerDimensions?: Json; styles?: Json; [k: string]: unknown };
export type ToolResult = { content?: { type: string; text?: string }[]; structuredContent?: unknown; isError?: boolean };

export type Host = {
  /** The host's context as it is now (theme, display mode). */
  context(): HostContext;
  /** One tool on the connector, through the host: its JSON reply (structuredContent, else the first text block parsed), or a thrown Refusal. */
  callTool(name: string, args: Json): Promise<unknown>;
  /** Ask the host for full screen (only from a person's click: hosts refuse it otherwise). */
  requestDisplayMode(mode: "inline" | "fullscreen"): Promise<string | null>;
  sizeChanged(height: number): void;
};

/** What a tools/call result means: its JSON, or the refusal it is (core's one shape; an older door's text). */
export function replyOf(r: ToolResult): unknown {
  const text = (r.content ?? []).find((b) => b.type === "text")?.text;
  if (r.isError) {
    const sc = r.structuredContent as Json | undefined;
    if (sc && typeof sc.error_type === "string") { const { error_type, message, ...rest } = sc; throw new Refusal(error_type, String(message ?? error_type), rest); }
    throw new Refusal("refused", text ?? "the vault refused");
  }
  if (r.structuredContent !== undefined) return r.structuredContent;
  try { return JSON.parse(text ?? "null"); } catch { return text; }
}

export async function connectHost(on: { context?(c: HostContext): void; toolResult?(r: ToolResult): void; toolInput?(args: Json): void; teardown?(): void }, info: { name: string; version: string }): Promise<Host> {
  let next = 1;
  const pending = new Map<number, { ok: (v: unknown) => void; no: (e: unknown) => void }>();
  let ctx: HostContext = {};
  const post = (m: Json) => window.parent.postMessage({ jsonrpc: "2.0", ...m }, "*");
  const request = (method: string, params: Json) => new Promise<unknown>((ok, no) => { const id = next++; pending.set(id, { ok, no }); post({ id, method, params }); });
  const notify = (method: string, params: Json) => post({ method, params });
  window.addEventListener("message", (e) => {
    if (e.source !== window.parent) return;
    const m = e.data as Json | null;
    if (!m || m.jsonrpc !== "2.0") return;
    if (m.id !== undefined && m.method === undefined) {
      const p = pending.get(m.id as number);
      if (!p) return;
      pending.delete(m.id as number);
      if (m.error) { const err = m.error as Json; const data = err.data as Json | undefined;
        // an older door said a refusal as a JSON-RPC error with data.error_type
        p.no(data && typeof data.error_type === "string" ? new Refusal(data.error_type, String(err.message ?? "").replace(/^(MCP error -?\d+:\s*)?(\[[a-z0-9_]+\]\s*)?/, ""), data) : new Error(String(err.message ?? "the host refused")));
      } else p.ok(m.result);
      return;
    }
    const params = (m.params ?? {}) as Json;
    switch (m.method) {
      case "ui/notifications/tool-input": on.toolInput?.((params.arguments ?? {}) as Json); return;
      case "ui/notifications/tool-result": on.toolResult?.(params as ToolResult); return;
      case "ui/notifications/host-context-changed": ctx = { ...ctx, ...params }; on.context?.(ctx); return;
      case "ui/resource-teardown": on.teardown?.(); post({ id: m.id, result: {} }); return;
      case "ping": post({ id: m.id, result: {} }); return;
      default: if (m.id !== undefined) post({ id: m.id, error: { code: -32601, message: `Method not found: ${String(m.method)}` } });
    }
  });
  const init = (await request("ui/initialize", { protocolVersion: PROTOCOL_VERSION, appInfo: info, appCapabilities: { availableDisplayModes: ["inline", "fullscreen"] } })) as Json;
  ctx = (init.hostContext ?? {}) as HostContext;
  notify("ui/notifications/initialized", {});
  return {
    context: () => ctx,
    callTool: async (name, args) => replyOf((await request("tools/call", { name, arguments: args })) as ToolResult),
    requestDisplayMode: async (mode) => { try { return String(((await request("ui/request-display-mode", { mode })) as Json).mode ?? "") || null; } catch { return null; } },
    sizeChanged: (height) => notify("ui/notifications/size-changed", { height: Math.ceil(height) }),
  };
}
