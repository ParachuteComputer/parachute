// The kit's Tabs on a phone: more places than fit stay on one line and scroll sideways, the one shown kept in view
// (Mail's Inbox · 5, Waiting · 2, Later, Drafts, Sent, Junk wrapped to two lines before).
import { expect, test } from "@playwright/test";
import { api, hubState, record, VAULT } from "./hub";

test.use({ storageState: "e2e/.signed-in.json" });

const stamp = Date.now().toString(36);
const CODE = `import { useState } from "react";
import { Page, Tabs } from "parachute";
const PLACES = [["inbox", "Inbox", 5], ["waiting", "Waiting", 2], ["later", "Later"], ["drafts", "Drafts"], ["sent", "Sent"], ["junk", "Junk"], ["archive", "Archive"]];
export default function Places() {
  const [at, setAt] = useState("archive");
  return <Page title="Places"><Tabs label="Places" current={at} onChange={setAt} tabs={PLACES.map(([key, label, count]) => ({ key, label, count }))} /><p>At {at}</p></Page>;
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
  await expect(nav).toBeVisible({ timeout: 20_000 });
  const tops = await nav.getByRole("button").evaluateAll((bs) => bs.map((b) => Math.round(b.getBoundingClientRect().top)));
  expect(new Set(tops).size, `tops ${tops}`).toBe(1);
  // more than fit: it scrolls, and the one shown (the last) is in view
  expect(await nav.evaluate((n) => n.scrollWidth > n.clientWidth)).toBe(true);
  const inView = async (name: RegExp) => nav.evaluate((n, src) => {
    const b = [...n.querySelectorAll("button")].find((x) => new RegExp(src).test(x.textContent ?? ""))!.getBoundingClientRect(), r = n.getBoundingClientRect();
    return b.left >= r.left - 1 && b.right <= r.right + 1;
  }, name.source);
  expect(await inView(/^Archive$/)).toBe(true);
  await nav.evaluate((n) => { n.scrollLeft = 0; });
  await app.getByRole("button", { name: "Inbox · 5" }).click();
  await expect(app.getByText("At inbox")).toBeVisible();
  expect(await inView(/^Inbox/)).toBe(true);
});
