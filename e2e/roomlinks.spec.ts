// A note link in a Room message (applets/room.tsx through the kit's Linked and Link), against our real Buzz relay: Uni
// writes `<vault>:<ULID>` in chat; alice taps it and the note opens in the applet that opens its kind. The message's
// text is left as Uni wrote it. Services workflow only, as rooms.spec.ts (e2e/services/README.md): BUZZ_RELAY and BUZZ_KEYS.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { getPublicKey } from "nostr-tools/pure";
import { api, hubState, VAULT } from "./hub";
import { installApplet, ui } from "./helpers";
import { person } from "./services/client";

const RELAY = process.env.BUZZ_RELAY;
const KEYS = process.env.BUZZ_KEYS ?? "";
test.skip(!RELAY || !KEYS, "needs our Buzz relay (BUZZ_RELAY, BUZZ_KEYS): e2e/services/README.md");
test.use({ storageState: "e2e/.signed-in.json" });

const secret = (n: string) => readFileSync(join(KEYS, `${n}.hex`), "utf8").trim();
// the applet on screen (the app keeps one it left running, hidden)
const frame = (page: Page) => page.frameLocator("iframe.applet-frame:visible");
const chip = async (page: Page, name: RegExp) => {
  await page.goto(`/v/${VAULT}?with=vault`);
  await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name }).click();
};

test("Uni's kitchen:<ULID> in a room is a link: a tap opens the recipe in the Recipe box; an unknown vault stays text", async ({ page }) => {
  test.setTimeout(120_000);
  const toast = (await api(hubState(), "GET", `notes?id=${encodeURIComponent("Recipes/Tomato toast")}`)).id as string;
  const alice = getPublicKey(Uint8Array.from(Buffer.from(secret("alice"), "hex")));
  const uni = await person(RELAY!, secret("bob"));
  const stamp = Date.now().toString(36);
  const owner = await person(RELAY!, secret("owner"));
  const room = crypto.randomUUID();
  for (const p of [alice, uni.pubkey]) await owner.publish({ kind: 9030, tags: [["p", p]] });
  expect((await owner.publish({ kind: 9007, tags: [["h", room], ["name", `Pantry ${stamp}`], ["visibility", "private"], ["channel_type", "stream"]] })).ok).toBe(true);
  for (const p of [alice, uni.pubkey]) expect((await owner.publish({ kind: 9000, tags: [["h", room], ["p", p]] })).ok).toBe(true);
  owner.close();
  const said = `Saved the toast recipe as \`${VAULT}:${toast}\`. Also filed under ${VAULT}:${toast} and journal:${toast} ${stamp}.`;
  expect((await uni.publish({ kind: 9, content: said, tags: [["h", room]] })).ok).toBe(true);
  uni.close();
  await page.addInitScript((k) => { if (window === window.top) (window as unknown as { __parachuteE2EKey: string }).__parachuteE2EKey = k; }, secret("alice"));
  const made = await installApplet("rooms", { relay: RELAY!, uni: uni.pubkey });
  try {
    await chip(page, /Recipe box/);
    await page.getByRole("button", { name: "Allow" }).click();
    await expect(frame(page).locator("#opened")).toBeVisible();

    await chip(page, /Rooms/);
    await expect(page.getByRole("region", { name: /asking for access/ })).toContainText("Take you to a note or an applet when you tap, see which note links lead to a note, and know its vault's web address");
    await page.getByRole("button", { name: "Allow" }).click();
    const app = frame(page);
    await app.getByRole("region", { name: "Your rooms" }).getByRole("button", { name: new RegExp(`Pantry ${stamp}`) }).click({ timeout: 30_000 });
    const msg = app.getByRole("log").locator("article", { hasText: stamp });
    await expect(msg.getByRole("link", { name: `${VAULT}:${toast}` })).toHaveCount(2, { timeout: 20_000 });
    // the text is as Uni wrote it; a vault this device doesn't hold is plain text
    await expect(msg).toContainText(`Also filed under ${VAULT}:${toast} and journal:${toast} ${stamp}.`);
    await expect(msg.getByRole("link", { name: /journal:/ })).toHaveCount(0);

    await msg.getByRole("link", { name: `${VAULT}:${toast}` }).first().click();
    await expect(frame(page).locator("#opened")).toHaveText("Opened: Recipes/Tomato toast");
  } finally { await made.remove(); }
});

test("off the tailnet: Uni's link to a note the hub can't be asked for right now is still a link, and a tap opens it (T-476)", async ({ page }) => {
  test.setTimeout(120_000);
  // Aaron's relay is public and his hub is on his tailnet: his rooms come in before his hub answers. A fresh note (never
  // read on this device, so no copy of it is kept) whose read fails as a hub off the network does
  const note = (await api(hubState(), "POST", "notes", { path: `Checklists/Shed move ${Date.now()}`, content: "# Shed move\n\n- Empty the shelves\n- Book the trailer" })).id as string;
  const alice = getPublicKey(Uint8Array.from(Buffer.from(secret("alice"), "hex")));
  const uni = await person(RELAY!, secret("bob"));
  const stamp = Date.now().toString(36);
  const owner = await person(RELAY!, secret("owner"));
  const room = crypto.randomUUID();
  for (const p of [alice, uni.pubkey]) await owner.publish({ kind: 9030, tags: [["p", p]] });
  expect((await owner.publish({ kind: 9007, tags: [["h", room], ["name", `Shed ${stamp}`], ["visibility", "private"], ["channel_type", "stream"]] })).ok).toBe(true);
  for (const p of [alice, uni.pubkey]) expect((await owner.publish({ kind: 9000, tags: [["h", room], ["p", p]] })).ok).toBe(true);
  owner.close();
  expect((await uni.publish({ kind: 9, content: `The full checklist is in the vault: ${VAULT}:${note} ${stamp}`, tags: [["h", room]] })).ok).toBe(true);
  uni.close();
  await page.addInitScript((k) => { if (window === window.top) (window as unknown as { __parachuteE2EKey: string }).__parachuteE2EKey = k; }, secret("alice"));
  const made = await installApplet("rooms", { relay: RELAY!, uni: uni.pubkey });
  // any read of that note (core 0.8 `notes`, 0.9 `records`; by `?id=` or in the path)
  const off = (url: URL) => url.pathname.startsWith(`/vault/${VAULT}/api/`) && (url.searchParams.get("id") === note || url.pathname.includes(`/${note}`));
  await page.route(off, (r) => r.abort("internetdisconnected"));
  try {
    await chip(page, /Rooms/);
    await page.getByRole("button", { name: "Allow" }).click();
    const app = frame(page);
    await app.getByRole("region", { name: "Your rooms" }).getByRole("button", { name: new RegExp(`Shed ${stamp}`) }).click({ timeout: 30_000 });
    const msg = app.getByRole("log").locator("article", { hasText: stamp });
    await expect(msg).toContainText(`The full checklist is in the vault: ${VAULT}:${note}`);
    await expect(msg.getByRole("link", { name: `${VAULT}:${note}` })).toBeVisible({ timeout: 20_000 });
    // the hub is back: one tap opens the note
    await page.unroute(off);
    await msg.getByRole("link", { name: `${VAULT}:${note}` }).click();
    await expect(page).toHaveURL(new RegExp(`record=${note}|/n/${note}`));
    await expect(page.frameLocator("iframe.applet-frame:visible").getByText("Book the trailer")).toBeVisible({ timeout: 20_000 });
  } finally { await page.unroute(off).catch(() => {}); await made.remove(); await api(hubState(), "DELETE", `notes/${note}`).catch(() => {}); }
});
