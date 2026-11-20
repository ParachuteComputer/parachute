// Move a vault's records to their names since 11-20 (docs/design/APP-RECORD.md "Bundles"), once:
//   an app record   Parachute/Apps/<id>, tagged parachute-app, under fields.app
//              →    Parachute/Bundles/<id>, tagged parachute-bundle, under fields.bundle (the same note, moved)
//   the settings note's `app` (which bundle a device opens) → `bundle`
// The app reads the older names until 2026-12-20 and moves a record itself the first time the person changes it; this
// does all of them at once. It shows what it would do and writes nothing unless asked (--apply); with --apply it first
// writes each note it changes, as read, to --backup (a folder, made if missing). Run with Node (it strips the types):
//
//   node scripts/migrate-bundles.ts --hub https://hub.example --vault home --token-file ~/token [--backup ./backups] [--apply]
//
// The token is a vault write token (`parachute auth mint-token --scope vault:<vault>:write`). A bundle already at the
// new path wins: the older record beside it is reported and left for the person to remove.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Row = { id: string; path: string; updatedAt?: string; metadata?: Record<string, unknown>; tags?: string[] };
type Args = { hub: string; vault: string; token: string; backup: string; apply: boolean };

function args(argv: string[]): Args {
  const a: Args = { hub: "", vault: "", token: "", backup: `backups-bundle-${new Date().toISOString().replace(/[:.]/g, "-")}`, apply: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    const take = () => { i++; if (v === undefined) throw new Error(`${k} needs a value`); return v; };
    if (k === "--hub") a.hub = take().replace(/\/$/, "");
    else if (k === "--vault") a.vault = take();
    else if (k === "--token-file") a.token = readFileSync(take().replace(/^~/, process.env.HOME ?? "~"), "utf8").trim();
    else if (k === "--backup") a.backup = take();
    else if (k === "--apply") a.apply = true;
    else throw new Error(`unknown ${k}`);
  }
  if (!a.hub || !a.vault || !a.token) throw new Error("--hub, --vault and --token-file are needed");
  return a;
}

const plain = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const bare = (p: string) => p.replace(/\.md$/, "");

async function main() {
  const a = args(process.argv.slice(2));
  const base = `${a.hub}/vault/${a.vault}/api`;
  const headers = { authorization: `Bearer ${a.token}`, "content-type": "application/json" };
  const tagged = async (tag: string): Promise<Row[]> => {
    const r = await fetch(`${base}/notes?tag=${encodeURIComponent(tag)}&include_metadata=true&limit=100`, { headers });
    if (!r.ok) throw new Error(`reading #${tag}: ${r.status}`);
    const b = await r.json() as Row[] | { notes: Row[] };
    return Array.isArray(b) ? b : b.notes;
  };
  const patch = async (n: Row, body: Record<string, unknown>) => {
    const r = await fetch(`${base}/notes/${encodeURIComponent(n.id)}`, { method: "PATCH", headers, body: JSON.stringify({ ...body, ...(n.updatedAt ? { if_updated_at: n.updatedAt } : { force: true }) }) });
    if (!r.ok) throw new Error(`writing ${n.path}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  };
  const say = (s: string) => console.log(a.apply ? s : `(would) ${s}`);
  const backup = (n: Row) => { mkdirSync(a.backup, { recursive: true }); writeFileSync(join(a.backup, `${bare(n.path).replace(/\//g, "_")}.json`), JSON.stringify(n, null, 2)); };

  const bundles = new Set((await tagged("parachute-bundle")).map((n) => bare(n.path)));
  let changes = 0;
  for (const n of await tagged("parachute-app")) {
    const body = plain(n.metadata) ? n.metadata.app : undefined;
    const id = plain(body) && typeof body.id === "string" ? body.id : null;
    if (!id || bare(n.path) !== `Parachute/Apps/${id}`) { console.log(`${n.path}: tagged parachute-app but not an app record at Parachute/Apps/<its id>; left as it is`); continue; }
    const to = `Parachute/Bundles/${id}`;
    if (bundles.has(to)) { console.log(`${n.path}: a bundle is already at ${to} and wins; this older record is left for you to remove`); continue; }
    changes++;
    say(`move ${n.path} → ${to} (tag parachute-bundle, fields.bundle)`);
    if (a.apply) {
      backup(n);
      // the hub merges fields: the older one goes with null
      await patch(n, { path: to, tags: { add: ["parachute-bundle"], remove: ["parachute-app"] }, metadata: { bundle: body, app: null } });
    }
  }
  const settings = await tagged("parachute-settings");
  for (const n of settings) {
    const p = plain(n.metadata) && plain(n.metadata.parachute) ? n.metadata.parachute : null;
    if (!p || p.app === undefined) continue;
    const { app, ...rest } = p;
    changes++;
    say(`${n.path}: app ${JSON.stringify(app)} → bundle${p.bundle !== undefined ? ` (it already says bundle ${JSON.stringify(p.bundle)}, which stays)` : ""}`);
    if (a.apply) {
      backup(n);
      await patch(n, { metadata: { parachute: { ...rest, bundle: p.bundle ?? app } } });
    }
  }
  if (!changes) console.log("Nothing to move.");
  else if (!a.apply) console.log("Nothing written. Run again with --apply to write it.");
  else console.log(`Done. Backups in ${a.backup}.`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
