// Signals (docs/design/APP-RECORD.md "Signals"; src/services/signals.ts): an applet declares what counts as something
// for the person, and the bar shows the count while the applet is closed, counted without running it. Here Ideas
// counts notes someone else adds to Ideas/: the vault's own live subscription, against the real hub.
import { expect, test, type Page } from "@playwright/test";
import { ui } from "./helpers";
import { api, hubState, mintToken, record, VAULT } from "./hub";

test.use({ storageState: "e2e/.signed-in.json" });

const bar = (page: Page) => page.getByRole("navigation", { name: "Bar" });
const badge = (page: Page) => bar(page).getByRole("link", { name: /Ideas/ }).locator(".home-bar-badge");
const CODE = `export default function Ideas() { return <main><h1>Ideas</h1></main>; }\n`;
const IDEAS = { path: "Applets/Ideas", extension: "tsx", tags: ["applet"], body: CODE, fields: {
  applet: { contract: 2, id: "ideas", name: "Ideas", glyph: "✦", note: "a test applet", access: [{ vault: "here", allow: [{ path: "Ideas/", verbs: ["read", "create"] }] }] },
  signals: [{ id: "new", name: "new ideas from others", from: { vault: "here", path: "Ideas/", others: true } }],
} };

async function settingsNotes() {
  const rows = await api(hubState(), "GET", "notes?tag=parachute-settings&include_metadata=true");
  return (Array.isArray(rows) ? rows : rows.notes ?? []) as { id: string }[];
}

test("a note someone else adds to Ideas raises its count on the bar while Ideas is closed; opening it clears the count", async ({ page }) => {
  test.setTimeout(90_000);
  const stamp = Date.now().toString(36);
  const friend = { origin: hubState().origin, token: mintToken(`vault:${VAULT}:write`, hubState(), ["--service", "friend"]) };
  const me = { origin: hubState().origin, token: mintToken(`vault:${VAULT}:write`, hubState(), ["--user", "owner"]) };
  const made: string[] = [];
  const add = async (who: { origin: string; token: string }, path: string) => { made.push((await api(who, "POST", "notes", { path, content: `an idea ${stamp}` })).id); };
  const applet = await record(hubState(), "create", IDEAS);
  await api(hubState(), "POST", "notes", { path: "Parachute/Settings", content: "settings", tags: ["parachute-settings"], metadata: { parachute: { bar: [{ vault: VAULT, applet: "Applets/Ideas" }] } } });
  try {
    await page.goto("about:blank");
    await page.goto("/");
    await expect(bar(page).getByRole("link", { name: /Ideas/ })).toBeVisible();
    // before Allow nothing is counted
    await add(friend, `Ideas/Before ${stamp}`);
    await bar(page).getByRole("link", { name: /Ideas/ }).click();
    const card = page.getByRole("region", { name: /asking for access/ });
    await expect(card).toContainText("Show a count on the bar: new ideas from others (notes in Ideas/ that someone else added)");
    await page.getByRole("button", { name: "Allow" }).click();
    await expect(page.frameLocator("iframe.applet-frame").getByRole("heading", { name: "Ideas" })).toBeVisible();
    await bar(page).getByRole("link", { name: "Launcher" }).click();
    await expect(ui(page).getByRole("list", { name: `Applets in ${VAULT}` })).toBeVisible();
    await expect(badge(page)).toHaveCount(0);

    // someone else's idea: counted at once, with Ideas closed
    await add(friend, `Ideas/Bees on the roof ${stamp}`);
    await expect(badge(page)).toHaveText("1");
    await expect(bar(page).getByRole("link", { name: /Ideas.*1 new/ })).toBeVisible();
    // the person's own idea, and someone else's note elsewhere: not counted
    await add(me, `Ideas/Mine ${stamp}`);
    await add(friend, `Recipes/Not an idea ${stamp}`);
    await add(friend, `Ideas/Second ${stamp}`);
    await expect(badge(page)).toHaveText("2");
    // a restart: counted again from the vault
    await page.reload();
    await expect(badge(page)).toHaveText("2");

    // opening Ideas: its count goes, and stays gone after
    await bar(page).getByRole("link", { name: /Ideas/ }).click();
    await expect(page.frameLocator("iframe.applet-frame").getByRole("heading", { name: "Ideas" })).toBeVisible();
    await expect(badge(page)).toHaveCount(0);
    await bar(page).getByRole("link", { name: "Launcher" }).click();
    await expect(ui(page).getByRole("list", { name: `Applets in ${VAULT}` })).toBeVisible();
    await expect(badge(page)).toHaveCount(0);
  } finally {
    for (const id of made) await api(hubState(), "DELETE", `notes/${id}`).catch(() => {});
    for (const n of await settingsNotes()) await api(hubState(), "DELETE", `notes/${n.id}`).catch(() => {});
    await api(hubState(), "DELETE", `notes/${applet.id}`).catch(() => {});
  }
});
