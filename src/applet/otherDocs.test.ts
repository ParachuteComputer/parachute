// docs/OTHER-PARACHUTES.md says what the code does: its sentences are the app's own, its records parse, its limits
// are the code's. (The worked example runs on two real hubs in e2e/worked.spec.ts.)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseComponent, MAX_PROPS_JSON } from "./component";
import { parsePointer } from "./pointer";
import { parseEmbeds, MAX_EMBEDS } from "./embeds";
import { embedsLine } from "./grant";
import { MAX_CODE_CHARS, MAX_REPLY_BYTES } from "../vault/limited";
import { whoseCard } from "../views/Whose";
import { EMBED_MAX, EMBED_MIN } from "../views/Embeds";

const doc = readFileSync(join(process.cwd(), "docs", "OTHER-PARACHUTES.md"), "utf8");
const flat = doc.replace(/\n> ?/g, " ").replace(/\s+/g, " ");
const blocks = [...doc.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => JSON.parse(m[1]));

describe("docs/OTHER-PARACHUTES.md", () => {
  it("its component is one the app reads, and its body is the code it lays out", () => {
    const comp = blocks.find((b) => b.tags?.includes("component"));
    const r = parseComponent(comp.fields.component);
    expect(r.ok).toBe(true);
    expect(comp.body).toBe(doc.match(/The body, laid out:\n\n```tsx\n([\s\S]*?)```/)![1]);
  });
  it("its pointer and its embed are what the app writes and reads", () => {
    const p = blocks.find((b) => b.tags?.includes("parachute-pointer"));
    const filled = { ...p.fields.pointer, record: "01M7KARHZC1VBJJPNSM13ZSW9C", code: `tsx:${"0".repeat(64)}` };
    expect(parsePointer(filled).ok).toBe(true);
    const e = blocks.find((b) => b.embeds);
    expect(parseEmbeds(e.embeds)).toEqual(e.embeds);
    expect(e.embeds[0].record).toBe(p.path);
  });
  it("its sentences are the app's", () => {
    expect(flat).toContain(embedsLine(["techne at techne.example"])!);
    const trust = whoseCard({ vault: "techne", issuer: "https://techne.example" }, "trusted")!;
    expect(flat).toContain(`**${trust.title}** ${trust.lines.join(" ")}`);
  });
  it("its limits are the code's", () => {
    expect(flat).toContain(`At most ${MAX_EMBEDS} embeds on a page`);
    expect(flat).toContain(`up to ${MAX_REPLY_BYTES / 1024 / 1024} MB`);
    expect(flat).toContain(`up to ${MAX_CODE_CHARS / 1000} KB`);
    expect(flat).toContain(`at most ${MAX_PROPS_JSON / 1024} KB`);
    expect(flat).toContain(`between ${EMBED_MIN} and ${EMBED_MAX} px`);
  });
});
