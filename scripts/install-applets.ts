// Put applets from applets/ into a vault, and lay out the app around them, in one go: the records, then the bar and the
// home applet (in a bundle record), then the person's settings note (Parachute/Settings: their servers, the bundle). Shows what it would do and writes
// nothing unless asked (--apply). Run with Node (it strips the types):
//
//   node scripts/install-applets.ts --hub https://hub.example --vault home --token-file ~/token \
//     --applet rooms --applet mail --applet journal --set relay=wss://relay.example --set mail=https://mail.example/mail/ \
//     --bar rooms,mail,journal --start rooms --service "Rooms=nostr-relay:wss://relay.example" \
//     --service "Mail=http:https://mail.example/mail/" [--apply]
//
// A component an applet imports (`import Room from "component:room"`, applets/room.json) goes in with it, before it.
// --bar and --start go in a bundle record (docs/design/APP-RECORD.md): --bundle's, else the one the settings note names,
// else Everything. --bundle uni [--bundle-name Uni] makes Parachute/Bundles/uni if it isn't there: every applet in the
// vault (and each --source: "*" for every vault on the hub, a vault, or vault/applet path), and makes it the bundle a
// device opens. A bundle the app ships (src/shell/default-bundles.json) is written with only what changes (and its
// name); the rest stays the app's. As the app does, a new record takes the names the vault already uses (the older
// ones, which builds from before 11-20 read, until one is under the newer). (--app and --app-name are their older names, read until 2026-12-20.)
// An area's applet (applets/area.json) is one per area: --applet area --set area=Garden --set area_id=garden
// --set area_room=<the room's id> (with relay and uni), again with other values for the next area.
//
// The token is a vault write token (`parachute auth mint-token --scope vault:<vault>:write`). A record already at an
// applet's path is updated in place (its code and fields), so running it again changes only what changed. Each applet
// still asks the person on its card before it runs; changed code or a changed server asks again.
import { readFileSync } from "node:fs";
import { appletRecord, withImports, type AppletRecord } from "../applets/record.ts";
const defaults = JSON.parse(readFileSync(new URL("../src/shell/default-bundles.json", import.meta.url), "utf8")) as { id: string; name?: string; bar?: unknown[] }[];
const shipped = defaults.map((b) => b.id);

type Args = { hub: string; vault: string; token: string; applets: string[]; vars: Record<string, string>; bar: string[] | null; start: string | null; services: { name: string; kind: string; url: string }[]; apply: boolean; bundle: string | null; bundleName: string | null; sources: string[] };

function args(argv: string[]): Args {
  const a: Args = { hub: "", vault: "", token: "", applets: [], vars: {}, bar: null, start: null, services: [], apply: false, bundle: null, bundleName: null, sources: [] };
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
    else if (k === "--bundle" || k === "--app") { a.bundle = take(); if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(a.bundle)) throw new Error(`${k} is an id: lower case, digits and dashes`); }
    else if (k === "--bundle-name" || k === "--app-name") a.bundleName = take();
    else if (k === "--source") a.sources.push(take());
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
  // the components they import first, each once, so an applet never opens before what it imports is there
  const parts = new Map<string, AppletRecord>();
  for (const n of a.applets) for (const r of withImports(n, a.vars).slice(0, -1)) parts.set(r.path, r);
  for (const [name, rec] of [...[...parts.values()].map((r) => [r.path, r] as const), ...Object.entries(records)]) {
    const was = await api.find(rec.path);
    if (!was) { say(`add ${name} at ${rec.path}`); if (a.apply) await api.write("create", { ...rec }); continue; }
    const fieldsWere = { ...(was.metadata ?? {}) };
    if (was.content === rec.body && same(fieldsWere.applet, rec.fields.applet) && same(fieldsWere.services, rec.fields.services) && same(fieldsWere.opens, rec.fields.opens) && same(fieldsWere.component, rec.fields.component) && same(fieldsWere.app, rec.fields.app) && same(fieldsWere.needs, rec.fields.needs)) { console.log(`${name}: unchanged`); continue; }
    const onlyNeeds = was.content === rec.body && same(fieldsWere.applet, rec.fields.applet) && same(fieldsWere.services, rec.fields.services) && same(fieldsWere.opens, rec.fields.opens) && same(fieldsWere.component, rec.fields.component) && same(fieldsWere.app, rec.fields.app);
    say(`update ${name} at ${rec.path}${onlyNeeds ? ` (needs ${rec.fields.needs ?? "nothing"} now)` : " (its card will ask again)"}`);
    // `needs` (the oldest app it runs on, docs/design/VERSIONS.md) is the code's: one it no longer says goes (the hub
    // merges fields, so it is removed with null)
    const dropNeeds = fieldsWere.needs !== undefined && rec.fields.needs === undefined ? { needs: null } : {};
    if (a.apply) await api.write("update", { id: was.id, body: rec.body, fields: { ...fieldsWere, ...dropNeeds, ...rec.fields }, ...(was.updatedAt ? { if_updated_at: was.updatedAt } : {}) });
  }
  const place = (n: string) => { const r = records[n] ?? (() => { try { return appletRecord(n, new Proxy({}, { has: () => true, get: () => "" })); } catch { return null; } })(); if (!r) throw new Error(`no applet ${n}`); return { vault: a.vault, applet: r.path }; };
  const rows = await api.findTag("parachute-settings");
  if (rows.length > 1) throw new Error(`the vault has ${rows.length} settings notes; keep one`);
  const was = rows[0] ?? null;
  const p = { ...((was?.metadata?.parachute as Record<string, unknown> | undefined) ?? {}) };

  // the bundle record: the bar and the home live there, never in the settings note
  const id = a.bundle ?? (typeof p.bundle === "string" ? p.bundle : typeof p.app === "string" ? p.app : "everything");
  if (a.bundle || a.bar || a.start) {
    const fresh = await api.find(`Parachute/Bundles/${id}`), old = fresh ? null : await api.find(`Parachute/Apps/${id}`);
    // a new record takes the names the vault already uses: the older ones (which builds from before 11-20 read) until one
    // is under the newer
    const newer = !!fresh || (!old && (await api.findTag("parachute-bundle")).length > 0);
    const had = fresh ?? old, path = had?.path ?? `Parachute/${newer ? "Bundles" : "Apps"}/${id}`, key = newer ? "bundle" : "app";
    const body = (had?.metadata?.[key] as Record<string, unknown> | undefined) ?? { contract: 1, id };
    // --source "*": every vault on this hub; "garden": every applet in garden; "garden/Applets/SeedLog": one applet
    const sources = [{ vault: a.vault, applet: "*" }, ...a.sources.map((x) => { if (x === "*") return { hub: new URL(a.hub).origin, vault: "*", applet: "*" }; const i = x.indexOf("/"); return i < 0 ? { vault: x, applet: "*" } : { vault: x.slice(0, i), applet: x.slice(i + 1) }; })];
    // a new bundle of the person's names itself and says where its applets come from; one the app ships says only what changes
    // (and its name, which a build from before 11-20 needs to read a record)
    const named = (x: string) => a.bundleName ?? x[0].toUpperCase() + x.slice(1);
    const made = had ? {} : !shipped.includes(id) ? { name: named(id), look: "launcher", sources } : { name: a.bundleName ?? defaults.find((d) => d.id === id)?.name ?? named(id) };
    const bundle = { ...body, ...made, ...(a.bundleName ? { name: a.bundleName } : {}), ...(a.sources.length ? { sources } : {}),
      // a bundle the app ships keeps its own places (Notes, Journal, Connect…) before the pins, as the app shows them,
      // every run (so running it again changes nothing)
      ...(a.bar ? { bar: [...(defaults.find((d) => d.id === id)?.bar ?? []), ...a.bar.map(place)] } : {}), ...(a.start ? { start: place(a.start) } : {}) };
    if (had && same(body, bundle)) console.log(`bundle ${id}: unchanged`);
    else {
      say(`${had ? "update" : "add"} the bundle ${id} at ${path}${old ? " (under its older names until it is moved)" : ""}: ${JSON.stringify(bundle)}`);
      if (a.apply) {
        if (had) await api.write("update", { id: had.id, fields: { ...(had.metadata ?? {}), [key]: bundle }, ...(had.updatedAt ? { if_updated_at: had.updatedAt } : {}) });
        else await api.write("create", { path, body: `The ${String(bundle.name ?? id)} bundle: where its applets come from, its bar and its home. See docs/design/APP-RECORD.md.`, tags: [newer ? "parachute-bundle" : "parachute-app"], fields: { [key]: bundle } });
      }
    }
  }

  // the settings note: only what was asked changes; everything else in it stays
  const next = { ...p };
  if (a.services.length) {
    const kept = Array.isArray(p.services) ? (p.services as { url?: string }[]).filter((s) => !a.services.some((n) => n.url === s.url)) : [];
    next.services = [...kept, ...a.services];
  }
  // under its older name too, which builds from before 11-20 read (until 2026-12-20)
  if (a.bundle) { next.bundle = a.bundle; next.app = a.bundle; }
  if (same(p, next)) console.log("settings: unchanged");
  else {
    for (const k of ["services", "bundle", "app"] as const) if (!same(p[k], next[k])) say(`settings ${k}: ${JSON.stringify(next[k] ?? null)}`);
    if (a.apply) {
      if (was) await api.write("update", { id: was.id, fields: { ...(was.metadata ?? {}), parachute: next }, ...(was.updatedAt ? { if_updated_at: was.updatedAt } : {}) });
      else await api.write("create", { path: "Parachute/Settings", body: "The Parachutes, the servers and the bundle of the Parachute app. See docs/NAVIGATION.md.", tags: ["parachute-settings"], fields: { parachute: next } });
    }
  }
  if (!a.apply) console.log("Nothing written. Run again with --apply to write it.");
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
