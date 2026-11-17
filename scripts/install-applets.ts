// Put applets from applets/ into a vault, and lay out the app around them, in one go: the records, then the person's
// settings note (Parachute/Settings: the bar, the home applet, their servers). Shows what it would do and writes
// nothing unless asked (--apply). Run with Node (it strips the types):
//
//   node scripts/install-applets.ts --hub https://hub.example --vault home --token-file ~/token \
//     --applet rooms --applet mail --applet journal --set relay=wss://relay.example --set mail=https://mail.example/mail/ \
//     --bar rooms,mail,journal --start rooms --service "Rooms=nostr-relay:wss://relay.example" \
//     --service "Mail=http:https://mail.example/mail/" [--apply]
//
// The token is a vault write token (`parachute auth mint-token --scope vault:<vault>:write`). A record already at an
// applet's path is updated in place (its code and fields), so running it again changes only what changed. Each applet
// still asks the person on its card before it runs; changed code or a changed server asks again.
import { readFileSync } from "node:fs";
import { appletRecord, type AppletRecord } from "../applets/record.ts";

type Args = { hub: string; vault: string; token: string; applets: string[]; vars: Record<string, string>; bar: string[] | null; start: string | null; services: { name: string; kind: string; url: string }[]; apply: boolean };

function args(argv: string[]): Args {
  const a: Args = { hub: "", vault: "", token: "", applets: [], vars: {}, bar: null, start: null, services: [], apply: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    const take = () => { i++; if (v === undefined) throw new Error(`${k} needs a value`); return v; };
    if (k === "--hub") a.hub = take().replace(/\/$/, "");
    else if (k === "--vault") a.vault = take();
    else if (k === "--token-file") a.token = readFileSync(take().replace(/^~/, process.env.HOME ?? "~"), "utf8").trim();
    else if (k === "--applet") a.applets.push(take());
    else if (k === "--set") { const [name, ...rest] = take().split("="); a.vars[name] = rest.join("="); }
    else if (k === "--bar") a.bar = take().split(",").filter(Boolean);
    else if (k === "--start") a.start = take();
    else if (k === "--service") { const m = /^([^=]+)=(nostr-relay|http):(.+)$/.exec(take()); if (!m) throw new Error("--service is Name=kind:url"); a.services.push({ name: m[1], kind: m[2], url: m[3] }); }
    else if (k === "--apply") a.apply = true;
    else throw new Error(`unknown ${k}`);
  }
  if (!a.hub || !a.vault || !a.token) throw new Error("--hub, --vault and --token-file are needed");
  return a;
}

type Row = { id: string; path: string; updatedAt?: string; content?: string; metadata?: Record<string, unknown>; tags?: string[] };

function hubApi(a: Args) {
  const base = `${a.hub}/vault/${a.vault}`;
  const auth = { authorization: `Bearer ${a.token}` };
  async function call(tool: string, args: Record<string, unknown>) {
    const r = await fetch(`${base}/mcp`, { method: "POST", headers: { ...auth, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } }) });
    const b = await r.json() as { result?: { isError?: boolean; content: { text: string }[] }; error?: unknown };
    if (r.status >= 300 || b.error || b.result?.isError) throw new Error(`${tool}: ${r.status} ${JSON.stringify(b).slice(0, 300)}`);
    return JSON.parse(b.result!.content[0].text);
  }
  let toolNames: Set<string> | null = null;
  const tools = async () => toolNames ??= new Set((await (await fetch(`${base}/mcp`, { method: "POST", headers: { ...auth, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }) })).json() as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name));
  return {
    async find(path: string): Promise<Row | null> {
      const r = await fetch(`${base}/api/notes?path_prefix=${encodeURIComponent(path)}&include_content=true&include_metadata=true&limit=20`, { headers: auth });
      if (!r.ok) throw new Error(`reading ${path}: ${r.status}`);
      return ((await r.json()) as Row[]).find((x) => x.path === path || x.path === `${path}.md`) ?? null;
    },
    async findTag(tag: string): Promise<Row[]> {
      const r = await fetch(`${base}/api/notes?tag=${encodeURIComponent(tag)}&include_metadata=true&limit=20`, { headers: auth });
      if (!r.ok) throw new Error(`reading #${tag}: ${r.status}`);
      return r.json() as Promise<Row[]>;
    },
    /** Create or update in record words where the hub has them (0.9), else note words (0.8). */
    async write(verb: "create" | "update", x: Record<string, unknown>) {
      const record = (await tools()).has(`${verb}-record`);
      if (record) return call(`${verb}-record`, x);
      const { body, fields, ...rest } = x;
      return call(`${verb}-note`, { ...rest, ...(body !== undefined ? { content: body } : {}), ...(fields !== undefined ? { metadata: fields } : {}) });
    },
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function main() {
  const a = args(process.argv.slice(2));
  const api = hubApi(a);
  const say = (s: string) => console.log(a.apply ? s : `(would) ${s}`);
  const records: Record<string, AppletRecord> = Object.fromEntries(a.applets.map((n) => [n, appletRecord(n, a.vars)]));
  for (const [name, rec] of Object.entries(records)) {
    const was = await api.find(rec.path);
    if (!was) { say(`add ${name} at ${rec.path}`); if (a.apply) await api.write("create", { ...rec }); continue; }
    const fieldsWere = { ...(was.metadata ?? {}) };
    if (was.content === rec.body && same(fieldsWere.applet, rec.fields.applet) && same(fieldsWere.services, rec.fields.services) && same(fieldsWere.opens, rec.fields.opens)) { console.log(`${name}: unchanged`); continue; }
    say(`update ${name} at ${rec.path} (its card will ask again)`);
    if (a.apply) await api.write("update", { id: was.id, body: rec.body, fields: { ...fieldsWere, ...rec.fields }, ...(was.updatedAt ? { if_updated_at: was.updatedAt } : {}) });
  }
  // the settings note: only what was asked changes; everything else in it stays
  const place = (n: string) => { const r = records[n] ?? (() => { try { return appletRecord(n, new Proxy({}, { has: () => true, get: () => "" })); } catch { return null; } })(); if (!r) throw new Error(`no applet ${n}`); return { vault: a.vault, applet: r.path }; };
  const rows = await api.findTag("parachute-settings");
  if (rows.length > 1) throw new Error(`the vault has ${rows.length} settings notes; keep one`);
  const was = rows[0] ?? null;
  const p = { ...((was?.metadata?.parachute as Record<string, unknown> | undefined) ?? {}) };
  const next = { ...p };
  if (a.bar) next.bar = a.bar.map(place);
  if (a.start) next.start = place(a.start);
  if (a.services.length) {
    const kept = Array.isArray(p.services) ? (p.services as { url?: string }[]).filter((s) => !a.services.some((n) => n.url === s.url)) : [];
    next.services = [...kept, ...a.services];
  }
  if (same(p, next)) console.log("settings: unchanged");
  else {
    for (const k of ["bar", "start", "services"] as const) if (!same(p[k], next[k])) say(`settings ${k}: ${JSON.stringify(next[k])}`);
    if (a.apply) {
      if (was) await api.write("update", { id: was.id, fields: { ...(was.metadata ?? {}), parachute: next }, ...(was.updatedAt ? { if_updated_at: was.updatedAt } : {}) });
      else await api.write("create", { path: "Parachute/Settings", body: "The bar, the home applet, the Parachutes and the servers of the Parachute app. See docs/NAVIGATION.md.", tags: ["parachute-settings"], fields: { parachute: next } });
    }
  }
  if (!a.apply) console.log("Nothing written. Run again with --apply to write it.");
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
