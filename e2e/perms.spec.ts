// A first run with the four applets a person's own Parachute brings (Rooms, Mail, Journal, Claude accounts, from
// applets/ as scripts/install-applets.ts puts them in), at phone size, approved-code mode (Android): each asks on one
// short card (face.ts), its risky asks in bold words on the face, the exact lines folded under Show details, Allow on
// the first screen. Then the asks again: changed code that asks for nothing new says so; an applet that asks for more
// marks what is new. The servers are fakes (e2e/services/servers.ts); Uni's key is on the device's trusted list.
// SHOTS=<dir>: screenshots of each card and the word counts, for PERMS.md.
import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { api, hubState, VAULT } from "./hub";
import { installApplet, ui } from "./helpers";
import { startHttp, startRelay } from "./services/servers";

test.use({ storageState: "e2e/.signed-in.json" });
const SHOTS = process.env.SHOTS;
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const card = (page: Page) => page.getByRole("region", { name: /is asking for access/ });
const face = (page: Page) => card(page).getByRole("list", { name: "What it would do" });

async function open(page: Page, label: RegExp) {
  await page.goto(`/v/${VAULT}`);
  await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: label }).click();
  await expect(card(page)).toBeVisible();
}
/** Allow is on the first screen: no scrolling to reach it (the bar at the bottom covers nothing of it). */
async function allowOnFirstScreen(page: Page) {
  const allow = card(page).getByRole("button", { name: /^Allow/ });
  await page.evaluate(() => window.scrollTo(0, 0));
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const box = (await allow.boundingBox())!;
  const nav = await page.locator("nav.home-bar").boundingBox().catch(() => null);
  expect(box.y + box.height).toBeLessThanOrEqual(nav?.y ?? page.viewportSize()!.height);
  return allow;
}
const stats: Record<string, unknown>[] = [];
async function measure(page: Page, name: string) {
  if (!SHOTS) return;
  const words = async (sel: string) => (await page.locator(sel).evaluateAll((els) => els.map((e) => (e as HTMLElement).innerText).join(" "))).split(/\s+/).filter(Boolean).length;
  stats.push({ card: name, faceWords: await words(".grant-card > :not(.grant-details)"), detailWords: await words(".grant-card .grant-details"), faceLines: await card(page).locator(".grant-face li").count() });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

test("first run: four applets, four short cards; changed code says whether it asks for anything new", async ({ page }) => {
  test.setTimeout(120_000);
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  const relay = await startRelay(); const http = await startHttp();
  const sk = generateSecretKey(); const uni = getPublicKey(generateSecretKey());
  await page.addInitScript(([k, u]) => { if (window !== window.top) return; const w = window as unknown as Record<string, unknown>; w.__parachuteE2EKey = k; w.__parachuteE2EApprovers = [{ name: "Uni", pubkey: u }]; }, [hex(sk), uni] as const);
  const vars = { relay: relay.url, mail: `${http.origin}/mail/`, uni, push: `${http.origin}/push/` };
  const made: { id: string; remove: () => Promise<void> }[] = [];
  try {
    for (const n of ["rooms", "mail", "journal", "accounts"]) made.push(await installApplet(n, vars));
    const relayHost = new URL(relay.url.replace(/^ws/, "http")).host;

    // Rooms: what it does as you, the approval key and the push gateway each on a line of their own, in bold words
    await open(page, /Rooms/);
    await expect(card(page).getByRole("heading")).toHaveText("Allow Rooms?");
    await expect(face(page).getByText(`As you on ${relayHost} on this device`)).toBeVisible();
    await expect(face(page).locator("strong", { hasText: "High risk, with your approval key:" })).toBeVisible();
    await expect(face(page)).toContainText("from Uni there (your approval key is your everyday key for now). Powerful ones ask for your device unlock.");
    await expect(face(page)).toContainText("which gets your public key and where to reach this phone");
    await expect(face(page).locator("strong", { hasText: "Opens web addresses" })).toBeVisible();
    await expect(card(page).getByText("Also: the microphone when you press record, files you pick, saving to Downloads, 256 KB for drafts")).toBeVisible();
    await expect(card(page).getByText("On this device an applet could send what it reads to the internet: allow only code you trust.")).toBeVisible();
    // the exact lines are there, folded: hidden until Show details
    const exact = card(page).getByText(`With your everyday key: sign in to ${relayHost} on this device as you`);
    await expect(exact).toBeHidden();
    await measure(page, "rooms");
    await card(page).getByRole("button", { name: "Show details" }).click();
    await expect(exact).toBeVisible();
    await expect(card(page).getByText("Keep private notes there (read-state:…), sealed to your key: other apps of yours may share them")).toBeVisible();
    await card(page).getByRole("button", { name: "Hide details" }).click();
    await (await allowOnFirstScreen(page)).click();
    await expect(page.locator("iframe.applet-frame")).toHaveCount(1);

    await open(page, /Mail/);
    await expect(face(page).locator("strong", { hasText: "High risk, with your approval key:" })).toBeVisible();
    await expect(face(page)).toContainText("sends send.approve requests to");
    await measure(page, "mail");
    await (await allowOnFirstScreen(page)).click();
    await expect(page.locator("iframe.applet-frame")).toHaveCount(1);

    await open(page, /Journal/);
    await expect(face(page).getByText("Read, add and change notes in Journal/")).toBeVisible();
    await expect(card(page).getByText("Also: opens journal notes you tap, the microphone when you press record")).toBeVisible();
    await measure(page, "journal");
    await (await allowOnFirstScreen(page)).click();
    await expect(page.locator("iframe.applet-frame")).toHaveCount(1);

    await open(page, /Claude accounts/);
    await expect(face(page).getByText("Read notes outside its own folder, in System/")).toBeVisible();
    await measure(page, "accounts");
    await (await allowOnFirstScreen(page)).click();
    await expect(page.locator("iframe.applet-frame")).toHaveCount(1);

    // Journal's code changes, its asks don't: the card says so, and nothing is marked new
    const st = hubState();
    const journal = await api(st, "GET", `notes?id=${made[2].id}`);
    await api(st, "PATCH", `notes/${made[2].id}`, { content: `${journal.content}\n// a new line of code`, if_updated_at: journal.updatedAt });
    await open(page, /Journal/);
    await expect(card(page).getByRole("heading")).toHaveText("Journal changed");
    await expect(card(page).getByRole("status")).toHaveText("This applet's code changed since you allowed it. On this device an applet could send what it reads to the internet, so only code you've approved runs. It asks for no new permissions.");
    await expect(card(page).locator(".grant-new")).toHaveCount(0);
    await expect(page.locator("iframe.applet-frame")).toHaveCount(0);
    await measure(page, "journal-code-changed");
    await (await allowOnFirstScreen(page)).click();
    await expect(page.locator("iframe.applet-frame")).toHaveCount(1);

    // Claude accounts asks for more: the new line is marked, and nothing runs until Allow
    const accounts = await api(st, "GET", `notes?id=${made[3].id}`);
    const applet = { ...accounts.metadata.applet, access: [{ vault: "here", allow: [{ path: "System/", verbs: ["read"] }, { path: "Workers/", verbs: ["read", "update"] }] }] };
    await api(st, "PATCH", `notes/${made[3].id}`, { metadata: { ...accounts.metadata, applet }, if_updated_at: accounts.updatedAt });
    await open(page, /Claude accounts/);
    await expect(card(page).getByRole("heading")).toHaveText("Claude accounts asks again");
    await expect(card(page).getByRole("status")).toHaveText("It now asks for something other than what you allowed. What is new is marked New.");
    await expect(face(page).locator(".grant-fresh .grant-row-line")).toHaveText("New Read and change notes in Workers/");
    await expect(face(page).locator(".grant-fresh")).toHaveCount(1);
    await expect(page.locator("iframe.applet-frame")).toHaveCount(0);
    await measure(page, "accounts-asks-more");
    await (await allowOnFirstScreen(page)).click();
    await expect(page.locator("iframe.applet-frame")).toHaveCount(1);
  } finally {
    if (SHOTS) writeFileSync(`${SHOTS}/stats.json`, JSON.stringify(stats, null, 1));
    for (const m of made.reverse()) await m.remove();
    await relay.close(); await http.close();
  }
});
