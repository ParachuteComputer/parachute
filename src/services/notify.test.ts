import { describe, expect, it } from "vitest";
import { entriesFrom, pushPlan, type NotifyEntry } from "./notify";

const e = (x: Partial<NotifyEntry>): NotifyEntry => ({ relay: "wss://relay.example", me: "a".repeat(64), rooms: null, mentions: true, from: [], subject: "/v/k/a/n", name: "Rooms", ...x });

describe("which gateways to register with", () => {
  it("registers each gateway the list names once per relay, and unregisters the ones no grant names any more", () => {
    const plan = pushPlan(
      [e({ gateway: "https://push.example/" }), e({ gateway: "https://push.example/", subject: "/v/k/a/m" }), e({}), e({ gateway: "https://push.example/", relay: "wss://other.example" })],
      [{ gateway: "https://push.example/", relay: "wss://relay.example" }, { gateway: "https://gone.example/", relay: "wss://relay.example" }],
    );
    expect(plan.register).toEqual([{ gateway: "https://push.example/", relay: "wss://relay.example" }, { gateway: "https://push.example/", relay: "wss://other.example" }]);
    expect(plan.unregister).toEqual([{ gateway: "https://gone.example/", relay: "wss://relay.example" }]);
    expect(pushPlan([], [{ gateway: "https://push.example/", relay: "wss://relay.example" }]).unregister).toHaveLength(1);
  });
});

describe("the list from what was read", () => {
  const me = "a".repeat(64);
  const k = { everyday: "", approval: "", same: true, seal_pub: "", approvers: [{ pubkey: "b".repeat(64), name: "Uni" }] };
  const rooms = { kind: "nostr-relay", url: "ws://localhost:3871", rooms: [{ id: "garden", name: "Garden" }], notify: { mentions: true, from: ["b".repeat(64), "c".repeat(64)], gateway: "https://push.example/" } };
  // a granted applet that imports a component: its keys are the ones the applet screen computes (with its imports)
  const read = { skipped: 0, entries: [{ noteId: "n1", manifest: { name: "Rooms" }, keys: { scope: "s", html: "tsx+imports:abc" }, services: [rooms] }] } as never;
  const granted = (subject: string, scope: string, html: string) => (subject.endsWith("n1") && scope === "s" && html === "tsx+imports:abc" ? "ok" as const : "none" as const);
  it("makes an entry for a granted applet, with its gateway, room names and only trusted `from` keys", async () => {
    const { npubEncode } = await import("nostr-tools/nip19");
    const out = entriesFrom({ ...k, everyday: npubEncode(me) }, [{ key: "uni", read }], granted);
    expect(out).toEqual([{ relay: "ws://localhost:3871", me, rooms: ["garden"], mentions: true, from: ["b".repeat(64)], subject: "/v/uni/a/n1", name: "Rooms", gateway: "https://push.example/", names: { garden: "Garden" } }]);
    expect(entriesFrom({ ...k, everyday: npubEncode(me) }, [{ key: "uni", read }], () => "updated")).toEqual([]);
  });
  it("sends nothing when the key or a vault couldn't be read (an empty list would stop every notification)", async () => {
    const { npubEncode } = await import("nostr-tools/nip19");
    expect(entriesFrom(null, [{ key: "uni", read }], granted)).toBeNull();
    expect(entriesFrom({ ...k, everyday: npubEncode(me) }, [{ key: "uni", read }, { key: "work", read: null }], granted)).toBeNull();
  });
});
