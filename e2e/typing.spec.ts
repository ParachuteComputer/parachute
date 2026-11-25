// What you type shows at once (Aaron, 11-23: "the typing takes a long time to show up… Being able to see text come
// through quickly in all our interfaces is incredibly important"). In a real browser at phone size with the CPU slowed
// to a phone's (CDP throttling), each keystroke's time from the key to the next paint (the browser's Event Timing) is
// measured in a long journal, and in a plain box of the kit's own (a Page holding one Write) in the same run: the
// journal may add at most two frames, or half the plain box's time on a slow machine, to what the plain box takes (the
// frame's own floor, and this machine's, is in both). Before the fix the journal took twice the plain box and more.
import { expect, test, type Page } from "./test";
import { api, hubState, record, VAULT } from "./hub";
import { ui } from "./helpers";
import { appletRecord } from "../applets/record.ts";

test.use({ storageState: "e2e/.signed-in.json" });

const SLOWDOWN = 4;
const FRAME = 16;
const WORDS = "the kale is up and the frost held off";
const stamp = Date.now().toString(36);
const PLAIN = `import { useState } from "react";
import { Page, Write } from "parachute";
export default function Plain() { const [t, setT] = useState(""); return <Page title="Plain"><Write label="A plain box" value={t} onChange={setT} /></Page>; }
`;

/** Types WORDS into a box in an applet's frame, the CPU slowed; each key's key-to-paint, in ms, sorted. */
async function keysIn(page: Page, title: string, box: string): Promise<number[]> {
  const app = page.frameLocator(`iframe[title="${title}"]`);
  await app.getByLabel(box).click();
  const frame = (await (await page.locator(`iframe[title="${title}"]`).elementHandle())!.contentFrame())!;
  await frame.evaluate(() => {
    const w = window as unknown as { __keys: number[] };
    w.__keys = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (["keydown", "keypress", "input"].includes(e.name)) w.__keys.push(e.duration); })
      .observe({ type: "event", durationThreshold: 16 } as PerformanceObserverInit);
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: SLOWDOWN });
  try { await page.keyboard.type(WORDS, { delay: 60 }); await page.waitForTimeout(500); } finally { await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 }); }
  await expect(app.getByLabel(box)).toHaveValue(WORDS);
  return (await frame.evaluate(() => (window as unknown as { __keys: number[] }).__keys.slice())).sort((a, b) => a - b);
}
const p90 = (k: number[]) => (k.length ? k[Math.min(k.length - 1, Math.floor(k.length * 0.9))] : 0);

async function open(page: Page, id: string, name: string) {
  await page.goto(`/v/${VAULT}/a/${id}`);
  const start = page.getByRole("button", { name: `Open ${name}` });
  await start.or(page.getByRole("button", { name: "Allow" })).first().waitFor();
  if (await start.isVisible()) await start.click();
  const allow = page.getByRole("button", { name: "Allow" });
  if (await allow.isVisible().catch(() => false)) await allow.click();
}

test("typing in a long journal shows each key about as fast as in a plain box (two frames at most), on a phone's CPU", async ({ page }) => {
  test.setTimeout(240_000);
  const plain = await record(hubState(), "create", { path: `Applets/Plain ${stamp}`, extension: "tsx", tags: ["applet"], body: PLAIN, fields: { needs: 7, applet: { contract: 2, id: `plain-${stamp}`, name: "Plain", glyph: "❦", access: [] } } });
  const made: string[] = [plain.id, (await record(hubState(), "create", appletRecord("journal"))).id];
  const now = new Date(), pad = (n: number) => String(n).padStart(2, "0");
  // sixty entries (what Journal reads at first) over the last days, with markdown in them
  for (let i = 0; i < 60; i++) {
    const d = new Date(now.getTime() - Math.floor(i / 6) * 86400_000);
    const path = `Journal/${d.getFullYear()}/${pad(d.getMonth() + 1)}-${pad(d.getDate())}/${pad(8 + (i % 6) * 2)}-${pad(i)} Entry ${i} ${stamp}`;
    const content = `Entry ${i} ${stamp}. The **beds** want turning before the frost; see [[Garden]] and the list:\n\n- garlic\n- leeks\n- *onions*\n\n` + "A longer thought about the season and what it asks of the garden. ".repeat(4);
    made.push(((await api(hubState(), "POST", "notes", { path, tags: ["journal"], content })) as { id: string }).id);
  }
  try {
    await open(page, plain.id, "Plain");
    const floor = await keysIn(page, "Plain", "A plain box");
    await page.goto(`/v/${VAULT}?with=vault`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Journal/ }).click();
    await page.getByRole("button", { name: "Allow" }).click();
    await expect(page.frameLocator('iframe[title="Journal"]').getByText(`Entry 59 ${stamp}.`)).toBeAttached({ timeout: 20_000 });
    const journal = await keysIn(page, "Journal", "Write in your journal");
    console.log(`key to paint, p90 (ms): plain box ${p90(floor)}, journal ${p90(journal)}`);
    // (a key under 16 ms isn't reported: on a fast machine the plain box's floor is a frame)
    const base = Math.max(FRAME, p90(floor));
    expect(p90(journal), `journal ${journal.join(" ")}\nplain ${floor.join(" ")}`).toBeLessThanOrEqual(base + Math.max(2 * FRAME, base / 2));
  } finally {
    for (const id of made) await api(hubState(), "DELETE", `notes/${id}`).catch(() => {});
  }
});
