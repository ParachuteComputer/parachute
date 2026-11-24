// Techne in applets (docs/design/TECHNE.md): an applet acts on Techne as the person, with the key the app holds, one
// permission at a time. It names Techne in `fields.techne` ({at, can}); the shell talks to the AppView for it, signing
// each request with the person's key (the services broker's NIP-98, in Rust); the applet never sees the key or a token.
// `read` is granted on the card; each write capability is asked the first time it is used, and the person's yes is a
// signed approval naming exactly that capability (techneGrants.ts). Every method belongs to one capability in the table
// below, in the shell: a method that isn't in it is never signed, for any applet. Pure.
import { normalUrl, type HttpService } from "./services.ts";
import { hasHidden, hasOnly, plain } from "./contract.ts";

export const TECHNE_CAPS = ["read", "post", "follow"] as const;
export type TechneCap = (typeof TECHNE_CAPS)[number];
/** Granted on the card (Allow). Every other capability is a write, asked the first time. */
export const CARD_CAPS: readonly TechneCap[] = ["read"];
export const isWrite = (c: TechneCap) => !CARD_CAPS.includes(c);

export type Techne = { at: string; can: TechneCap[] };

/** Each method the shell may sign for an applet, the capability it needs, and how it is called (an atproto query is a
 *  GET, a procedure a POST). Shapes are the AppView's lexicons (Techne MCP describe_method, 11-23). */
export const METHODS: Readonly<Record<string, { cap: TechneCap; http: "GET" | "POST" }>> = Object.freeze({
  "social.scenius.getProfile": { cap: "read", http: "GET" },
  "pub.techne.draft.query.listRecords": { cap: "read", http: "GET" },
  "pub.techne.draft.query.getRecords": { cap: "read", http: "GET" },
  "pub.techne.draft.query.countRecords": { cap: "read", http: "GET" },
  "social.scenius.listCirclePosts": { cap: "read", http: "GET" },
  "social.scenius.getCircleThread": { cap: "read", http: "GET" },
  "social.scenius.listCircleProfiles": { cap: "read", http: "GET" },
  // creating only: deleteCirclePost deletes any of the person's posts in a circle, not only this applet's, so deleting
  // is a capability of its own when it comes (TECHNE.md)
  "social.scenius.createCirclePost": { cap: "post", http: "POST" },
  "social.scenius.offerConnection": { cap: "follow", http: "POST" },
});
/** Who the shell signs in as (`techne.me()`): the shell's own call, not the applet's. Assumed (TECHNE.md). */
export const WHO_AM_I = "com.atproto.server.getSession";

/** Techne's own hosts: never an applet's plain service (it would get every call signed, past the capabilities). */
export const TECHNE_HOSTS = ["techne.computer", "techne.town", "pds.techne.town", "auth.pds.techne.town"];

const fail = (error: string) => ({ ok: false as const, error });

/** `fields.techne`: absent is none; anything wrong refuses it whole (the applet opens and reaches nothing on Techne).
 *  `isHub`: is this origin a Parachute hub (never Techne). */
export function parseTechne(raw: unknown, isHub: (origin: string) => boolean = () => false): { ok: true; techne: Techne | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, techne: null };
  if (!plain(raw) || !hasOnly(raw, ["at", "can"])) return fail("techne is {at, can}");
  const u = normalUrl(raw.at, ["https", "http"], false);
  if (!u.ok) return fail(`techne.at: ${u.error}`);
  if (u.value.pathname !== "/") return fail("techne.at is the AppView's origin, with no path");
  if (isHub(u.value.origin)) return fail("techne.at is a Parachute hub, not Techne");
  const can = raw.can;
  if (!Array.isArray(can) || !can.length || can.length > TECHNE_CAPS.length || new Set(can).size !== can.length
    || can.some((c) => typeof c !== "string" || hasHidden(c) || !(TECHNE_CAPS as readonly string[]).includes(c)))
    return fail(`techne.can is a list of ${TECHNE_CAPS.join(", ")}, each once`);
  return { ok: true, techne: { at: `${u.value.origin}/`, can: TECHNE_CAPS.filter((c) => can.includes(c)) } };
}

/** Is `origin` Techne for this applet (its own `at`, or one of Techne's hosts)? A service there is refused. */
export function isTechneOrigin(origin: string, t: Techne | null): boolean {
  try {
    const u = new URL(origin);
    return (t !== null && new URL(t.at).origin === u.origin) || TECHNE_HOSTS.includes(u.hostname.replace(/\.$/, ""));
  } catch { return false; }
}

export const techneHost = (t: Techne) => new URL(t.at).host;

/** What each write capability is, in the card's words (after "Will ask you once before it can …"). */
const WRITE_WORDS: Record<Exclude<TechneCap, "read">, string> = { post: "post as you in your circles", follow: "follow people as you (anyone can see who you follow)" };
const ASK_WORDS: Record<Exclude<TechneCap, "read">, { title: string; body: string; line: string }> = {
  post: { title: "post as you on Techne", body: "In your circles at {host}, using your Techne account.", line: "Posts as you on Techne" },
  follow: { title: "follow people as you on Techne", body: "At {host}, using your Techne account. Anyone can see who you follow.", line: "Follows people as you on Techne" },
};

/** The card's lines: reading is stressed (it is as you, private circles too); the writes it may ask for, on one. */
export function techneLines(t: Techne): { text: string; stress: boolean }[] {
  const host = techneHost(t);
  const out: { text: string; stress: boolean }[] = [];
  if (t.can.includes("read")) out.push({ text: `Read what you see on Techne at ${host}, your private circles included, as you (with your key)`, stress: true });
  const writes = t.can.filter(isWrite) as Exclude<TechneCap, "read">[];
  if (writes.length) {
    const w = writes.map((c) => WRITE_WORDS[c]);
    out.push({ text: `Will ask you once before it can ${w.length === 1 ? w[0] : `${w.slice(0, -1).join(", ")}, or ${w[w.length - 1]}`} at ${host}`, stress: true });
  }
  return out;
}

/** The card's line when what it reads on Techne could leave through a server it also declares (services.ts). */
export const techneOutLine = (hosts: readonly string[]) => ({ text: `What it reads on Techne, your private circles too, could reach ${hosts.length === 1 ? hosts[0] : `${hosts.slice(0, -1).join(", ")} and ${hosts[hosts.length - 1]}`}`, stress: true });

/** The card's face for Techne (face.ts): what it does there as the person, the writes it asks for first, and where
 *  what it reads could go. Each keeps its host, as every stressed line does. */
export function techneFace(t: Techne, outHosts: readonly string[]): { lead: string; rest: string; risky: boolean }[] {
  const host = techneHost(t);
  const out: { lead: string; rest: string; risky: boolean }[] = [];
  if (t.can.includes("read")) out.push({ lead: `As you on Techne at ${host}`, rest: " (your key): reads what you see there, your private circles included.", risky: true });
  const writes = t.can.filter(isWrite) as Exclude<TechneCap, "read">[];
  if (writes.length) {
    const w = writes.map((c) => WRITE_WORDS[c]);
    out.push({ lead: "Asks you first", rest: `, once, before it can ${w.length === 1 ? w[0] : `${w.slice(0, -1).join(", ")}, or ${w[w.length - 1]}`} at ${host}.`, risky: true });
  }
  if (t.can.includes("read") && outHosts.length) out.push({ lead: "What it reads on Techne can leave", rest: `: your private circles too, to ${outHosts.length === 1 ? outHosts[0] : `${outHosts.slice(0, -1).join(", ")} and ${outHosts[outHosts.length - 1]}`}.`, risky: true });
  return out;
}

/** The shell's sheet the first time a write capability is used: what Allow grants, and that it lasts. */
export function askOf(name: string, t: Techne, cap: Exclude<TechneCap, "read">): { title: string; body: string; act: string } {
  const a = ASK_WORDS[cap];
  return { title: `«${name}» wants to ${a.title}`, body: `${a.body.replace("{host}", techneHost(t))} Once you allow it, it does this without asking again. Take it back any time in Settings → Applets.`, act: "Allow from now on" };
}
/** A held capability's line in Settings. */
export const heldLine = (cap: Exclude<TechneCap, "read">) => ASK_WORDS[cap].line;

/** Its part of the grant's key: only when declared, so every other key stays as it was. */
export const techneKeyPart = (t: Techne | null | undefined) => (t ? { at: t.at, can: [...t.can].sort() } : undefined);

/** The AppView as the broker reaches it: an http service whose every request is signed (NIP-98). Its id isn't one an
 *  applet can name: the shell opens it on a broker of its own, and only the techne module calls it. */
export const TECHNE_SERVICE_ID = "techne-appview";
export const techneService = (t: Techne): HttpService => ({ id: TECHNE_SERVICE_ID, kind: "http", url: `${t.at}xrpc/`, auth: "nip98" });

const NSID = /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+\.[a-zA-Z][a-zA-Z0-9]{0,62}$/;

export type Check =
  | { ok: true; cap: TechneCap; http: "GET" | "POST" }
  /** a write capability it declared and doesn't hold yet: the shell asks (after a tap) */
  | { ok: false; ask: Exclude<TechneCap, "read"> }
  | { ok: false; refused: string };

/** May this applet call `nsid` now? `held`: the write capabilities it holds (read is the card's). The one check. */
export function checkCall(t: Techne, held: ReadonlySet<TechneCap>, nsid: unknown): Check {
  if (typeof nsid !== "string" || !NSID.test(nsid)) return { ok: false, refused: "that isn't a method name" };
  const m = Object.prototype.hasOwnProperty.call(METHODS, nsid) ? METHODS[nsid] : undefined;
  if (!m) return { ok: false, refused: `${nsid} isn't a method Parachute signs for an applet` };
  if (!t.can.includes(m.cap)) return { ok: false, refused: `its card doesn't ask to ${m.cap === "read" ? "read" : WRITE_WORDS[m.cap as Exclude<TechneCap, "read">]} on Techne` };
  if (isWrite(m.cap) && !held.has(m.cap)) return { ok: false, ask: m.cap as Exclude<TechneCap, "read"> };
  return { ok: true, cap: m.cap, http: m.http };
}

/** A capability's signed approval sits beside the applet's own (approvals.ts): its record and its scope name it. The
 *  scope also names the applet's own approval it was given under (its number, `n`): Revoke then Allow again makes a
 *  new one, so a write given before the Revoke doesn't come back with it. */
export const capRecord = (record: string, cap: TechneCap) => `${record}.techne.${cap}`;
export const capScope = (scope: string, cap: TechneCap, under: number) => `techne:${cap}:${under}:${scope}`;
