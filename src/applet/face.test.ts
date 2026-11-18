// @vitest-environment node
import { describe, expect, it } from "vitest";
import { appletRecord } from "../../applets/record";
import { readApplet } from "./discovery";
import { grantLines, grantOf, type Grant } from "./grant";
import { changeOf, faceOf, faceTexts, othersOf } from "./face";
import type { Imported } from "./resolveImports";
import { importLines } from "./resolveImports";
import type { LineOptions } from "./services";

const UNI = "a".repeat(64);
const vars = { relay: "wss://buzz.example.org", mail: "https://mail.example.org/mail/", uni: UNI, push: "https://push.example.org/" };
const trusted: LineOptions = { approvalSame: true, approverName: (h) => (h === UNI ? "Uni" : null) };

function grantFor(name: string, change: (f: Record<string, unknown>) => Record<string, unknown> = (f) => f): { g: Grant; folder: string | null } {
  const r = appletRecord(name, vars);
  const a = readApplet({ id: "n1", path: r.path, tags: r.tags, metadata: change(r.fields) }, "v");
  if (!a.ok) throw new Error(a.error);
  const e = a.entry;
  return { g: grantOf(e.manifest, "v", e.opens, e.app, e.services), folder: e.path.includes("/") ? `${e.path.split("/").slice(0, -1).join("/")}/` : null };
}

/** What in a stressed line changes the risk: hosts, folders, keys named, quoted names, and the words that say how. */
const facts = (line: string): string[] => [
  ...(line.match(/npub1[a-z0-9]+/g) ?? []),
  ...(line.match(/«[^»]+»(?: \([^)]+\))?/g) ?? []),
  ...(line.match(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?(?: on this device)?/gi) ?? []).filter((h) => !/^e\.g$/.test(h)),
  ...(line.match(/\b[A-Z][\w ]*\//g) ?? []),
  ...["everyday key", "approval key", "High risk", "device unlock", "public key", "where to reach this phone", "web addresses", "every vault", "named by the applet", "only in", "delete", "files", "signed as you", "token", "your approval key is your everyday key for now"].filter((w) => line.toLowerCase().includes(w.toLowerCase())).map((w) => w.toLowerCase()),
];

/** Every line the details stress has its facts on the face. */
function holds(g: Grant, folder: string | null, opts: LineOptions = {}, imports: Imported[] = []) {
  const face = faceOf(g, folder, opts, imports);
  const text = faceTexts(face).join("\n").toLowerCase();
  const stressed = [...grantLines(g, folder, opts), ...importLines(imports)].filter((l) => l.stress);
  for (const l of stressed) for (const f of facts(l.text)) expect(text, `«${f}» from «${l.text}»`).toContain(f.toLowerCase());
  // every server: what it reads can go there, on the face
  for (const s of g.services ?? []) expect(text).toMatch(new RegExp(`${new URL(s.url).host.replace(/\./g, "\\.")}[^\\n]*what it reads can go there`));
  if (stressed.length) expect(face.lines.some((l) => l.risky)).toBe(true);
  return face;
}

describe("the face keeps every stressed line's facts", () => {
  it("Aaron's four applets, Uni trusted", () => {
    for (const n of ["rooms", "mail", "journal", "accounts"]) { const { g, folder } = grantFor(n); holds(g, folder, trusted); }
  });
  it("an approver this device doesn't trust is named by its whole key", () => {
    const { g, folder } = grantFor("rooms");
    const face = holds(g, folder, { approvalSame: false });
    expect(faceTexts(face).join(" ")).toContain("a key you haven't trusted on this device (npub1");
  });
  it("rooms the applet names, a token, a plain server, every vault, links, someone else's page and code", () => {
    const { g, folder } = grantFor("rooms", (f) => ({ ...f, app: ["links", "recent"], services: [{ id: "r", kind: "nostr-relay", url: "wss://xn--bcher-kva.example/", publish: [9, 5], media: false, rooms: [{ id: "abcdef0123456789", name: "Garden" }] },
      { id: "t", kind: "http", url: "https://matrix.example.org/", auth: "token" }, { id: "n", kind: "http", url: "https://plain.example.org/", auth: "none" }] }));
    const imports: Imported[] = [{ id: "chart", name: "Chart", vault: "techne", host: "techne.example", own: false, whose: "trusted", kind: "tsx", source: "", hash: "" }];
    const face = holds({ ...g, embedsFrom: ["techne at techne.example"] }, folder, trusted, imports);
    const t = faceTexts(face).join("\n");
    expect(t).toContain("bücher.example (xn--bcher-kva.example)");
    expect(t).toContain("only in «Garden» (abcdef01…), named by the applet");
  });
  it("Rooms says in a few lines what the details say in fifteen", () => {
    const { g, folder } = grantFor("rooms");
    const face = faceOf(g, folder, trusted);
    expect(grantLines(g, folder, trusted).length).toBeGreaterThanOrEqual(14);
    expect(face.lines.length).toBe(4);
    expect(face.also).toEqual(["the microphone when you press record", "files you pick", "saving to Downloads", "256 KB for drafts"]);
  });
});

describe("why it asks again", () => {
  const now = (o: Partial<Parameters<typeof changeOf>[1]> = {}) => ({ scope: "s1", status: "updated" as const, face: ["A", "B"], others: [], ...o });
  it("never allowed: first", () => expect(changeOf(null, now({ status: "none" })).kind).toBe("first"));
  it("same asks, other code: nothing new", () => {
    const c = changeOf({ scope: "s1", asked: { face: ["A", "B"], others: [] } }, now());
    expect(c).toMatchObject({ kind: "code", nothingNew: true });
    expect(c.fresh?.size).toBe(0);
  });
  it("same asks, but a new import from someone else's vault: not nothing new", () => {
    expect(changeOf({ scope: "s1", asked: { face: ["A", "B"], others: [] } }, now({ others: ["x@techne"] })).nothingNew).toBe(false);
  });
  it("a grant from before this kept nothing: nothing new only when nothing is imported from elsewhere", () => {
    expect(changeOf({ scope: "s1", asked: null }, now()).nothingNew).toBe(true);
    expect(changeOf({ scope: "s1", asked: null }, now({ others: ["x@techne"] })).nothingNew).toBe(false);
    expect(changeOf({ scope: "s1", asked: null }, now()).fresh).toBeNull();
  });
  it("other asks: what is new is marked, what went is listed", () => {
    const c = changeOf({ scope: "s0", asked: { face: ["A", "C"], others: [] } }, now({ status: "none" }));
    expect(c.kind).toBe("asks");
    expect([...c.fresh!]).toEqual(["B"]);
    expect(c.gone).toEqual(["C"]);
  });
  it("the same asks, its year run out: expired", () => expect(changeOf({ scope: "s1", asked: { face: ["A", "B"], others: [] } }, now({ status: "none" })).kind).toBe("expired"));
  it("imports kept by vault and host", () => expect(othersOf([{ id: "c", name: "C", vault: "t", host: "h", own: false, whose: "trusted", kind: "tsx", source: "", hash: "" }])).toEqual(["c@t@h:trusted"]));
});
