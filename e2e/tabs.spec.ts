// The kit's Tabs on a phone: more places than fit stay on one line and scroll sideways, the one shown kept in view
// (Mail's Inbox · 5, Waiting · 2, Later, Drafts, Sent, Junk wrapped to two lines before).
import { expect, test } from "@playwright/test";
import { api, hubState, record, VAULT } from "./hub";

test.use({ storageState: "e2e/.signed-in.json" });

const stamp = Date.now().toString(36);
// the places arrive a moment after the first draw (as Mail's mailboxes do), the one shown already chosen: the last
const CODE = `import { useEffect, useState } from "react";
import { Page, Tabs } from "parachute";
const PLACES = [["inbox", "Inbox", 5], ["waiting", "Waiting", 2], ["later", "Later"], ["drafts", "Drafts"], ["sent", "Sent"], ["junk", "Junk"], ["archive", "Archive"]];
export default function Places() {
  const [at, setAt] = useState("archive");
  const [places, setPlaces] = useState([]);
  const [more, setMore] = useState(0);
  useEffect(() => { const t = setTimeout(() => setPlaces(PLACES), 400); return () => clearTimeout(t); }, []);
  return <Page title="Places"><Tabs label="Places" current={at} onChange={setAt} tabs={places.map(([key, label, count]) => ({ key, label, count: key === "inbox" ? count + more : count }))} /><p>At {at}</p><button onClick={() => setMore((m) => m + 7)}>More mail</button></Page>;
}
`;

let id = "";
test.beforeAll(async () => {
  id = (await record(hubState(), "create", { path: `Applets/Places ${stamp}`, extension: "tsx", tags: ["applet"], body: CODE,
    fields: { applet: { contract: 2, id: `places-${stamp}`, name: "Places", glyph: "❀" } } })).id;
});
test.afterAll(async () => { await api(hubState(), "DELETE", `notes/${id}`).catch(() => {}); });

test("tabs stay on one line on a phone, scroll sideways, and keep the one shown in view", async ({ page }) => {
  await page.goto(`/v/${VAULT}/a/${id}`);
  const start = page.getByRole("button", { name: "Open Places" });
  await start.or(page.getByRole("button", { name: "Allow" })).first().waitFor();
  if (await start.isVisible()) await start.click();
  const allow = page.getByRole("button", { name: "Allow" });
  if (await allow.isVisible().catch(() => false)) await allow.click();
  const app = page.frameLocator('iframe[title="Places"]');
  const nav = app.getByRole("navigation", { name: "Places" });
  await expect(nav.getByRole("button", { name: "Archive" })).toBeVisible({ timeout: 20_000 });
  const tops = await nav.getByRole("button").evaluateAll((bs) => bs.map((b) => Math.round(b.getBoundingClientRect().top)));
  expect(new Set(tops).size, `tops ${tops}`).toBe(1);
  // more than fit: it scrolls, and the one shown (the last, chosen before the places arrived) is brought into view
  expect(await nav.evaluate((n) => n.scrollWidth > n.clientWidth)).toBe(true);
  // in view and clear of a fade at either end
  const inView = (name: string) => nav.evaluate((n, want) => {
    const b = [...n.querySelectorAll("button")].find((x) => (x.textContent ?? "").startsWith(want))!.getBoundingClientRect(), r = n.getBoundingClientRect();
    const more = (n as HTMLElement).dataset.more ?? "";
    return b.left >= r.left + (more.includes("start") ? 31 : -1) && b.right <= r.right - (more.includes("end") ? 31 : -1);
  }, name);
  await expect.poll(() => inView("Archive")).toBe(true);
  // the start has more past it now: that end fades
  await expect(nav).toHaveAttribute("data-more", /start/);
  // the first chosen by a tap, after the row was scrolled away from it: brought back
  await app.getByText("At archive").click();
  await nav.evaluate((n) => { n.scrollLeft = n.scrollWidth; });
  await app.getByRole("button", { name: "Waiting · 2" }).evaluate((b) => (b as HTMLButtonElement).click());
  await expect(app.getByText("At waiting")).toBeVisible();
  await expect.poll(() => inView("Waiting")).toBe(true);
  // a tab half under the fade, chosen: brought clear of it
  await nav.evaluate((n) => { const s = [...n.querySelectorAll("button")].find((x) => x.textContent === "Sent")!; n.scrollLeft = s.offsetLeft + s.offsetWidth - n.clientWidth + 10; });
  await app.getByRole("button", { name: "Sent", exact: true }).evaluate((b) => (b as HTMLButtonElement).click());
  await expect(app.getByText("At sent")).toBeVisible();
  await expect.poll(() => inView("Sent")).toBe(true);
  // the row narrowed (a phone turned): the one shown is kept clear again
  await app.getByRole("button", { name: "Archive", exact: true }).evaluate((b) => (b as HTMLButtonElement).click());
  const frames = () => app.locator("body").evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await nav.evaluate((n) => { (n as HTMLElement).style.width = "640px"; });
  await frames();
  await nav.evaluate((n) => { (n as HTMLElement).style.width = ""; });
  await expect.poll(() => inView("Archive")).toBe(true);
  // a tap on the row, then at once the window widens and narrows again (a phone turned): the browser's clamp isn't the
  // person's scroll, so the shown tab is brought back clear
  const size = page.viewportSize()!;
  await nav.evaluate((n) => n.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
  await page.setViewportSize({ width: 900, height: size.height });
  await frames();
  await page.setViewportSize(size);
  await expect.poll(() => inView("Archive")).toBe(true);
  // the person scrolls the row away themselves; a count arriving (Inbox widens) leaves it where they put it
  await frames();
  await nav.evaluate((n) => { n.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); n.scrollLeft = 0; });
  await frames();
  const at = await nav.evaluate((n) => n.scrollLeft);
  expect(at).toBe(0);
  await app.getByRole("button", { name: "More mail" }).click();
  await expect(app.getByRole("button", { name: /^Inbox · 12$/ })).toBeVisible();
  await frames();
  expect(await nav.evaluate((n) => n.scrollLeft)).toBe(at);
  // nor does the row narrowing: it stays where they put it (a resize re-places only a row the kit placed)
  await nav.evaluate((n) => { (n as HTMLElement).style.width = "300px"; });
  await frames();
  expect(await nav.evaluate((n) => n.scrollLeft)).toBe(at);
  await nav.evaluate((n) => { (n as HTMLElement).style.width = ""; });
});
