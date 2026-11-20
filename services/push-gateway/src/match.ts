// Which registrations a new message is for. Pure: the watcher hands it the event, the registrations on that relay and
// the rooms' member lists (kind 39002, as the relay keeps them).
import type { Reg } from "./registry.ts";

export type Why = "mention" | "from";
/** `to`: the key the registration was made for (hex), so a phone whose key changed drops what its old key still gets. */
export type Push = { v: 1; relay: string; room: string; event: string; kind: number; why: Why; to: string };
type Ev = { id: string; pubkey: string; kind: number; created_at: number; tags: string[][]; content?: string };

/** Clocks differ: a message stamped this much before a registration still counts. */
export const SKEW_S = 5;
/** A message naming more people than this is a broadcast, not a mention (it still counts for `from`). */
export const MAX_MENTIONS = 20;

const tagValues = (ev: Ev, name: string) => ev.tags.filter((t) => t[0] === name && typeof t[1] === "string").map((t) => t[1]);

/** For each registration this message is for, why. Never the author's own; only someone the room lists as a member;
 *  only the rooms the registration named (or any of theirs); nothing from before it was made. A mention counts only
 *  from an author the room lists too: a relay may take a post in an open room from a key that isn't its member, and
 *  naming people there must not reach them (an author the person chose to hear, `from`, still does). */
export function matches(ev: Ev, relay: string, regs: readonly Reg[], members: (room: string) => ReadonlySet<string> | undefined): { reg: Reg; push: Push }[] {
  if (ev.kind !== 9) return [];
  const rooms = tagValues(ev, "h");
  if (rooms.length !== 1) return [];
  const room = rooms[0];
  const inRoom = members(room);
  if (!inRoom) return [];
  const named = tagValues(ev, "p");
  const mentioned = new Set(named.length <= MAX_MENTIONS && inRoom.has(ev.pubkey) ? named : []);
  const out: { reg: Reg; push: Push }[] = [];
  for (const reg of regs) {
    if (reg.relay !== relay || reg.pubkey === ev.pubkey || !inRoom.has(reg.pubkey) || ev.created_at < reg.created - SKEW_S) continue;
    if (reg.rooms && !reg.rooms.includes(room)) continue;
    const why: Why | null = reg.mentions && mentioned.has(reg.pubkey) ? "mention" : reg.from.includes(ev.pubkey) ? "from" : null;
    if (why) out.push({ reg, push: { v: 1, relay, room, event: ev.id, kind: ev.kind, why, to: reg.pubkey } });
  }
  return out;
}

/** The members a kind 39002 lists (`p` tags). */
export const membersOf = (ev: Ev) => new Set(tagValues(ev, "p").filter((p) => /^[0-9a-f]{64}$/.test(p)));
