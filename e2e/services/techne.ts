// A stand-in for Techne's AppView, for the Techne applet tests (docs/design/TECHNE.md): on loopback, with the real
// methods' shapes (social.scenius.getProfile, pub.techne.draft.query.listRecords, social.scenius.createCirclePost,
// social.scenius.offerConnection, as Techne's MCP describes them, 11-23) and made-up people and posts.
//
// ASSUMED until the Techne team says (TECHNE.md "How an applet signs in"): a program signs each request with its Nostr
// key as NIP-98, and the platform finds the account for that key and refuses it unless "Programs can sign in with this
// key" is on; `com.atproto.server.getSession` answers who that is. It checks NIP-98 as a server should (signature, kind,
// u, method, payload hash, a minute's window, each event once) and records every request it gets, signed or not.
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { verifyEvent } from "nostr-tools/pure";
import { cors, decode, listen, read, sha, tag } from "./servers";

export type Account = { did: string; handle: string; displayName: string; bio: string; programs: boolean };
export type TechneSeen = { method: string; nsid: string; pubkey: string | null; error: string | null; body: string };
type Post = { uri: string; cid: string; author: string; collection: string; value: Record<string, unknown>; time: string };

export async function startTechne(accounts: Record<string, Account>) {
  const seen: TechneSeen[] = [];
  const used = new Set<string>();
  const posts: Post[] = [];
  const connections: { from: string; subject: string }[] = [];
  let origin = "", n = 0;
  const cid = () => `bafyrei${randomBytes(20).toString("hex").slice(0, 40)}`;
  const tid = () => `3m${(Date.now() + n++).toString(36)}`;
  // made up: two earlier posts of each account's, so "recent posts" has something to show
  for (const a of Object.values(accounts))
    for (const [i, text] of ["Seed swap at the library on Saturday. Bring what you saved.", "The bike co-op needs two more volunteers for Thursday."].entries())
      posts.push({ uri: `at://${a.did}/pub.techne.draft.post/${tid()}`, cid: cid(), author: a.did, collection: "pub.techne.draft.post", value: { $type: "pub.techne.draft.post", text, createdAt: new Date(Date.now() - (i + 1) * 3_600_000).toISOString() }, time: new Date(Date.now() - (i + 1) * 3_600_000).toISOString() });

  const server = createServer(async (req, res) => {
    if (cors(req, res)) return;
    const body = await read(req);
    const url = `${origin}${req.url}`;
    const u = new URL(url);
    const nsid = u.pathname.startsWith("/xrpc/") ? u.pathname.slice(6) : u.pathname;
    const json = (status: number, x: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(x));
    // not a hub: the shell asks before its first signed request (docs/design/SERVICES.md "Hubs are not services")
    if (u.pathname.startsWith("/.well-known/")) { res.writeHead(404).end(); return; }
    const e = decode(req.headers.authorization);
    let error: string | null = null;
    if (!e) error = "no NIP-98";
    else if (!verifyEvent(e) || e.kind !== 27235) error = "bad signature";
    else if (tag(e, "u") !== url) error = `signed for ${tag(e, "u")}`;
    else if (tag(e, "method") !== req.method) error = "signed for another method";
    else if (body.length && tag(e, "payload") !== sha(body)) error = "signed another body";
    else if (Math.abs(e.created_at - Date.now() / 1000) > 60) error = "too old";
    else if (used.has(e.id)) error = "used before";
    const who = e && !error ? accounts[e.pubkey] : undefined;
    if (e && !error) { used.add(e.id); if (!who) error = "no account has this key"; else if (!who.programs) error = "programs can't sign in with this key"; }
    seen.push({ method: req.method ?? "", nsid, pubkey: e && !error ? e.pubkey : null, error, body: body.toString("utf8") });
    if (error) { json(401, { error: "AuthenticationRequired", message: error }); return; }
    const me = who!;
    const input = (() => { try { return JSON.parse(body.toString("utf8") || "{}") as Record<string, unknown>; } catch { return null; } })();
    const want = (m: string) => { if (req.method !== m) { json(400, { error: "InvalidRequest", message: `${nsid} is a ${m}` }); return false; } return true; };
    switch (nsid) {
      case "com.atproto.server.getSession":
        if (want("GET")) json(200, { did: me.did, handle: me.handle });
        return;
      case "social.scenius.getProfile": {
        if (!want("GET")) return;
        const a = Object.values(accounts).find((x) => x.did === u.searchParams.get("did"));
        if (!a) { json(404, { error: "NotFound" }); return; }
        json(200, { did: a.did, handle: a.handle, kind: "person", displayName: a.displayName, bio: a.bio, publicContacts: [] });
        return;
      }
      case "pub.techne.draft.query.listRecords": {
        if (!want("GET")) return;
        let q: { where?: { all?: Record<string, { is?: string }>[] } };
        try { q = JSON.parse(u.searchParams.get("query") ?? ""); } catch { json(400, { error: "InvalidRequest", message: "query is a pub.techne.draft.query as JSON" }); return; }
        const leaves = q.where?.all ?? [];
        const type = leaves.find((l) => l.type)?.type?.is, author = leaves.find((l) => l.author)?.author?.is;
        const limit = Math.min(Number(u.searchParams.get("limit") ?? 50) || 50, 100);
        const records = posts.filter((p) => (!type || p.collection === type) && (!author || p.author === (author === "$viewer" ? me.did : author)))
          .sort((a, b) => b.time.localeCompare(a.time) || a.uri.localeCompare(b.uri)).slice(0, limit);
        json(200, { records });
        return;
      }
      case "social.scenius.createCirclePost": {
        if (!want("POST")) return;
        const post = input?.post as { text?: unknown; createdAt?: unknown } | undefined;
        if (typeof input?.collective !== "string" || !input.collective.startsWith("did:") || !post || typeof post.text !== "string" || !post.text.trim() || typeof post.createdAt !== "string") {
          json(400, { error: "InvalidRequest", message: "collective (a DID) and post {text, createdAt}" }); return;
        }
        const p: Post = { uri: `at://${me.did}/pub.techne.draft.post/${tid()}`, cid: cid(), author: me.did, collection: "pub.techne.draft.post", value: { $type: "pub.techne.draft.post", text: post.text, createdAt: post.createdAt }, time: new Date().toISOString() };
        posts.push(p);
        json(200, { uri: p.uri, cid: p.cid });
        return;
      }
      case "social.scenius.offerConnection": {
        if (!want("POST")) return;
        if (typeof input?.subject !== "string") { json(400, { error: "InvalidRequest" }); return; }
        connections.push({ from: me.did, subject: input.subject });
        json(200, { uri: `at://${me.did}/pub.techne.draft.connection/${tid()}`, cid: cid() });
        return;
      }
      default:
        json(501, { error: "MethodNotImplemented" });
    }
  });
  const port = await listen(server);
  origin = `http://127.0.0.1:${port}`;
  return { origin, seen, posts, connections, close: () => new Promise<void>((r) => server.close(() => r())) };
}
