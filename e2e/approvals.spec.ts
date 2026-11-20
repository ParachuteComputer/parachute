// Approvals inside an applet (docs/design/KEYRING.md), against our real Buzz relay: a synthetic Uni posts a powerful
// sealed card and a secret request; alice answers both from the Rooms applet. The answer is opened and checked the way
// Uni checks it (e2eCards.openAnswer: the seal is alice's, rumor 46042 naming the card, rid and digest). The web build
// has no Rust: its test signer stands in for the native side (e2eNative.ts), with the device's trusted list and the
// unlock set by the test. The native side's own checks are cargo's (src-tauri/src/approvals), and the emulator's.
// Local only, as rooms.spec.ts: BUZZ_RELAY and BUZZ_KEYS (owner.hex, alice.hex, bob.hex).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import * as nip44 from "nostr-tools/nip44";
import * as nip19 from "nostr-tools/nip19";
import { VAULT } from "./hub";
import { installApplet, ui } from "./helpers";
import { person } from "./services/client";
import { makeCard, openAnswer, sealPub } from "../src/services/e2eCards";

const RELAY = process.env.BUZZ_RELAY;
const KEYS = process.env.BUZZ_KEYS ?? "";
test.skip(!RELAY || !KEYS, "needs our Buzz relay (BUZZ_RELAY, BUZZ_KEYS): e2e/services/README.md");
test.use({ storageState: "e2e/.signed-in.json" });

const secret = (n: string) => readFileSync(join(KEYS, `${n}.hex`), "utf8").trim();
const bytes = (h: string) => Uint8Array.from(Buffer.from(h, "hex"));
const frame = (page: Page) => page.frameLocator("iframe.applet-frame");
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

test("the rooms applet approves Uni's powerful card behind the unlock, gives a secret on the shell's sheet, and refuses a card from another key", async ({ page }) => {
  test.setTimeout(180_000);
  const aliceSk = bytes(secret("alice"));
  const alice = getPublicKey(aliceSk);
  const uniSk = generateSecretKey();
  const stamp = Date.now().toString(36);
  const owner = await person(RELAY!, secret("owner"));
  const room = crypto.randomUUID();
  const bobKey = secret("bob");
  const bob = await person(RELAY!, bobKey);
  for (const p of [alice, getPublicKey(uniSk), bob.pubkey]) await owner.publish({ kind: 9030, tags: [["p", p]] });
  expect((await owner.publish({ kind: 9007, tags: [["h", room], ["name", `Ops ${stamp}`], ["visibility", "private"], ["channel_type", "stream"]] })).ok).toBe(true);
  for (const p of [alice, getPublicKey(uniSk), bob.pubkey]) expect((await owner.publish({ kind: 9000, tags: [["h", room], ["p", p]] })).ok).toBe(true);
  owner.close();
  const uni = await person(RELAY!, hex(uniSk));

  // Uni's powerful card, sealed to alice's sealing key (her approval key is her everyday key here), and a secret request
  const card = makeCard({ uni: uniSk, sealPubHex: sealPub(aliceSk), room, credential: "cloudflare-dns", action: "job.cloudflare", scope: `Change one DNS record ${stamp}`, payload: { v: 1, zone: "example.org" }, class: "powerful", ttl_s: 600 });
  expect((await uni.send(card.event)).ok).toBe(true);
  // the same card's fields, but posted by bob: not from a key this device trusts
  const forged = makeCard({ uni: bytes(bobKey), sealPubHex: sealPub(aliceSk), room, credential: "forged-cred", action: "job.x", scope: "Not from Uni", payload: {}, class: "routine", ttl_s: 60 });
  expect((await bob.send(forged.event)).ok).toBe(true);
  const rsk = generateSecretKey();
  const rid = hex(generateSecretKey()).slice(0, 32);
  const req = { v: 1, rid, name: "garden-api", label: `The garden API token ${stamp}`, purpose: "To read the soil sensors", store: "Uni's secret folder", keep_days: 30, expires: Math.floor(Date.now() / 1000) + 3600, rpk: getPublicKey(rsk) };
  const asked = await uni.publish({ kind: 9, content: `I need the garden API token.\n\n\`\`\`uni-secret-request\n${JSON.stringify(req)}\n\`\`\``, tags: [["h", room], ["p", alice]] });
  expect(asked.ok).toBe(true);

  await page.addInitScript(([k, u]) => {
    if (window !== window.top) return;
    const w = window as unknown as Record<string, unknown>;
    w.__parachuteE2EKey = k;
    // the device's trusted list, as Settings keeps it; the unlock fails until the test says it passes
    w.__parachuteE2EApprovers = [{ name: "Uni", pubkey: u }];
    w.__parachuteE2EUnlock = "fail";
  }, [secret("alice"), getPublicKey(uniSk)] as const);
  const made = await installApplet("rooms", { relay: RELAY!, uni: getPublicKey(uniSk) });
  try {
    await page.goto(`/v/${VAULT}`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Rooms/ }).click();
    const grant = page.getByRole("region", { name: /asking for access/ });
    await expect(grant).toContainText("High risk. With your approval key: answer approval cards and secret requests there from Uni (your approval key is your everyday key for now). Powerful ones ask for your device unlock");
    await expect(grant).toContainText("With your everyday key: post as you in your rooms there");
    await page.getByRole("button", { name: "Allow" }).click();
    const app = frame(page);
    await app.getByRole("region", { name: "Your rooms" }).getByRole("button", { name: new RegExp(`Ops ${stamp}`) }).click({ timeout: 30_000 });
    const log = app.getByRole("log");

    // the forged card shows no buttons
    await expect(log.getByRole("group", { name: "Uni's card" }).filter({ hasText: "Not signed by Uni." })).toBeVisible({ timeout: 20_000 });

    // the powerful card: a plain tap does nothing; a hold asks for the unlock; a failed unlock sends nothing
    const sealed = log.getByRole("group", { name: "Uni asks to use a credential" });
    await expect(sealed).toContainText(`Change one DNS record ${stamp}`);
    const hold = sealed.getByRole("button", { name: "Hold to approve" });
    await hold.click();
    expect(await page.evaluate(() => (window as unknown as { __parachuteE2EUnlocks?: string[] }).__parachuteE2EUnlocks ?? [])).toEqual([]);
    const holdIt = async () => { const b = await hold.boundingBox(); await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2); await page.mouse.down(); await page.waitForTimeout(1200);
      await page.mouse.up(); };
    await holdIt();
    await expect(sealed.getByRole("alert")).toContainText(/unlock was cancelled or failed/);
    expect(await page.evaluate(() => (window as unknown as { __parachuteE2EUnlocks: string[] }).__parachuteE2EUnlocks)).toEqual(["powerful cloudflare-dns"]);
    await page.evaluate(() => { (window as unknown as { __parachuteE2EUnlock: string }).__parachuteE2EUnlock = "pass"; });
    await page.waitForTimeout(5100); // a tap pays for one answer, and the same card waits out the cancel's cooldown
    await holdIt();
    await expect(sealed).toContainText(/Approved · open until/, { timeout: 20_000 });
    await expect(sealed).not.toContainText("not sent yet");

    // Uni has the answer, and it checks as Uni checks it: the seal is alice's, the data key the one in the box
    const wraps = await uni.query({ kinds: [1059], "#p": [getPublicKey(uniSk)], since: Math.floor(Date.now() / 1000) - 1200 });
    const answers = wraps.flatMap((w) => { try { return [openAnswer(w as never, card.rsk, alice, { id: card.event.id, rid: card.fields.rid, requestDigest: card.requestDigest })]; } catch { return []; } });
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({ v: 1, decision: "approve", dek: card.dek, rid: card.fields.rid });

    // the secret: typed on the shell's own sheet, outside the frame; Uni opens it with its one-time key
    const ask = log.getByRole("group", { name: "Uni asks for a secret" });
    await expect(ask).toContainText(`The garden API token ${stamp}`);
    await page.waitForTimeout(5100);
    await ask.getByRole("button", { name: "Give it…" }).click();
    const sheet = page.getByRole("dialog", { name: "Uni asks for a secret" });
    await expect(sheet).toContainText("Uni says it keeps it in Uni's secret folder for 30 days");
    await sheet.getByLabel("The secret").fill(`soil-${stamp}`);
    await sheet.getByRole("button", { name: "Send sealed" }).click();
    await expect(ask).toContainText("Sent sealed. Only Uni can open it.", { timeout: 20_000 });
    const delivered = (await uni.query({ kinds: [1059], "#p": [getPublicKey(uniSk)], since: Math.floor(Date.now() / 1000) - 1200 })).flatMap((w) => {
      try {
        const seal = JSON.parse(nip44.decrypt(w.content, nip44.getConversationKey(rsk, w.pubkey)));
        const rumor = JSON.parse(nip44.decrypt(seal.content, nip44.getConversationKey(rsk, seal.pubkey)));
        return seal.pubkey === alice && rumor.kind === 46040 ? [JSON.parse(rumor.content)] : [];
      } catch { return []; }
    });
    expect(delivered).toEqual([{ value: `soil-${stamp}`, v: 1, rid, name: "garden-api" }]);
    // the frame never had it
    expect(await app.locator("body").innerText()).not.toContain(`soil-${stamp}`);
  } finally {
    uni.close(); bob.close();
    await made.remove();
  }
});

test("an applet without the approvals grant answers no card and can't post a bot's /approve", async ({ page }) => {
  test.setTimeout(120_000);
  const aliceSk = bytes(secret("alice"));
  const alice = getPublicKey(aliceSk);
  const uniSk = generateSecretKey();
  const stamp = Date.now().toString(36);
  const owner = await person(RELAY!, secret("owner"));
  const room = crypto.randomUUID();
  for (const p of [alice, getPublicKey(uniSk)]) await owner.publish({ kind: 9030, tags: [["p", p]] });
  expect((await owner.publish({ kind: 9007, tags: [["h", room], ["name", `Plain ${stamp}`], ["visibility", "private"], ["channel_type", "stream"]] })).ok).toBe(true);
  for (const p of [alice, getPublicKey(uniSk)]) expect((await owner.publish({ kind: 9000, tags: [["h", room], ["p", p]] })).ok).toBe(true);
  owner.close();
  const uni = await person(RELAY!, hex(uniSk));
  const card = makeCard({ uni: uniSk, sealPubHex: sealPub(aliceSk), room, credential: "cloudflare-dns", action: "job.cloudflare", scope: `No grant ${stamp}`, payload: {}, class: "routine", ttl_s: 60 });
  expect((await uni.send(card.event)).ok).toBe(true);
  expect((await uni.publish({ kind: 9, content: "**Hermes wants to run a command that needs your OK**\n```\nls\n```\nWhy it was flagged: test\n\nReply `/approve` to run it once, or `/deny` to cancel.", tags: [["h", room]] })).ok).toBe(true);
  await page.addInitScript(([k, u]) => { if (window === window.top) Object.assign(window, { __parachuteE2EKey: k, __parachuteE2EApprovers: [{ name: "Uni", pubkey: u }], __parachuteE2EUnlock: "pass" }); }, [secret("alice"), getPublicKey(uniSk)] as const);
  // the Rooms applet without its approvals line
  const made = await installApplet("rooms", { relay: RELAY!, uni: getPublicKey(uniSk) }, (r) => {
    delete (r.fields.services as { approvals?: unknown }[])[0].approvals;
    return { ...r, path: `Applets/Plain rooms ${stamp}` };
  });
  try {
    await page.goto(`/v/${VAULT}`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Rooms/ }).last().click();
    const grant = page.getByRole("region", { name: /asking for access/ });
    await expect(grant).not.toContainText("approval key");
    await page.getByRole("button", { name: "Allow" }).click();
    const app = frame(page);
    await app.getByRole("region", { name: "Your rooms" }).getByRole("button", { name: new RegExp(`Plain ${stamp}`) }).click({ timeout: 30_000 });
    const log = app.getByRole("log");
    await expect(log.getByRole("group", { name: "Uni's card" })).toContainText("This applet isn't allowed to answer approvals.", { timeout: 20_000 });
    await log.getByRole("group", { name: "Hermes asks to run a command" }).getByRole("button", { name: "Approve once" }).click();
    await expect(log.getByRole("group", { name: "Hermes asks to run a command" })).not.toContainText("You said /approve");
    await page.waitForTimeout(1500);
    const posted = await uni.query({ kinds: [9], "#h": [room], authors: [alice] });
    expect(posted.filter((e) => /\/approve/.test(e.content))).toEqual([]);
    expect(await uni.query({ kinds: [1059], "#p": [getPublicKey(uniSk)] })).toEqual([]);
  } finally {
    uni.close();
    await made.remove();
  }
});

test("on a device that doesn't trust Uni's key yet, Uni's card says so and offers it: one tap and the unlock, then it can be answered; another key's card gets no offer", async ({ page }) => {
  test.setTimeout(180_000);
  const aliceSk = bytes(secret("alice"));
  const alice = getPublicKey(aliceSk);
  const uniSk = generateSecretKey();
  const stamp = Date.now().toString(36);
  const owner = await person(RELAY!, secret("owner"));
  const room = crypto.randomUUID();
  const bobKey = secret("bob");
  const bob = await person(RELAY!, bobKey);
  for (const p of [alice, getPublicKey(uniSk), bob.pubkey]) await owner.publish({ kind: 9030, tags: [["p", p]] });
  expect((await owner.publish({ kind: 9007, tags: [["h", room], ["name", `Fresh ${stamp}`], ["visibility", "private"], ["channel_type", "stream"]] })).ok).toBe(true);
  for (const p of [alice, getPublicKey(uniSk), bob.pubkey]) expect((await owner.publish({ kind: 9000, tags: [["h", room], ["p", p]] })).ok).toBe(true);
  owner.close();
  const uni = await person(RELAY!, hex(uniSk));
  // a card as Uni's sealed broker posts it (kind 9, ```uni-sealed-approval, signed by Uni's key)
  const card = makeCard({ uni: uniSk, sealPubHex: sealPub(aliceSk), room, credential: "stripe-test", action: "job.stripe", scope: `Mint a test key ${stamp}`, payload: { v: 1 }, class: "routine", ttl_s: 600 });
  expect((await uni.send(card.event)).ok).toBe(true);
  // a second card from Uni: trusting the key from one card answers both, without leaving the room
  const second = makeCard({ uni: uniSk, sealPubHex: sealPub(aliceSk), room, credential: "mail-test", action: "job.mail", scope: `Read the test inbox ${stamp}`, payload: { v: 1 }, class: "routine", ttl_s: 600 });
  expect((await uni.send(second.event)).ok).toBe(true);
  const forged = makeCard({ uni: bytes(bobKey), sealPubHex: sealPub(aliceSk), room, credential: "forged-cred", action: "job.x", scope: `Not from Uni ${stamp}`, payload: {}, class: "routine", ttl_s: 60 });
  expect((await bob.send(forged.event)).ok).toBe(true);
  // a fresh install: nothing on the device's trusted list
  await page.addInitScript((k) => { if (window === window.top) Object.assign(window, { __parachuteE2EKey: k, __parachuteE2EApprovers: [], __parachuteE2EUnlock: "pass" }); }, secret("alice"));
  const made = await installApplet("rooms", { relay: RELAY!, uni: getPublicKey(uniSk) });
  try {
    await page.goto(`/v/${VAULT}`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Rooms/ }).click();
    await page.getByRole("button", { name: "Allow" }).click();
    const app = frame(page);
    await app.getByRole("region", { name: "Your rooms" }).getByRole("button", { name: new RegExp(`Fresh ${stamp}`) }).click({ timeout: 30_000 });
    const log = app.getByRole("log");
    const cards = log.getByRole("group", { name: "Uni's card" });
    // Uni's: what is missing, and the way to it; not "Not signed by Uni."
    const offered = cards.filter({ hasText: "This device doesn't trust the key that signed this card yet." });
    await expect(offered).toHaveCount(2, { timeout: 20_000 });
    // bob's: refused, and nothing to trust
    const refused = cards.filter({ hasText: "Not signed by Uni." });
    await expect(refused).toHaveCount(1);
    await expect(refused.getByRole("button")).toHaveCount(0);
    await page.waitForTimeout(5100); // a fresh tap
    // the shell's own sheet, over the applet: which applet, the whole key, and the name is the person's to give
    await offered.first().getByRole("button", { name: "Trust Uni's key…" }).click();
    const sheet = page.getByRole("dialog", { name: "Trust a key for approvals" });
    await expect(sheet).toContainText("Rooms shows a card signed by this key");
    await expect(sheet).toContainText(nip19.npubEncode(getPublicKey(uniSk)));
    await expect(sheet.getByRole("button", { name: "Trust it" })).toBeDisabled();
    // cancelled: nothing asked, nothing kept
    await sheet.getByRole("button", { name: "Cancel" }).click();
    await expect(sheet).toBeHidden();
    await expect(offered.first().getByRole("button", { name: "Trust Uni's key…" })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __parachuteE2EUnlocks?: string[] }).__parachuteE2EUnlocks ?? [])).toEqual([]);
    await page.waitForTimeout(5100);
    await offered.first().getByRole("button", { name: "Trust Uni's key…" }).click();
    await sheet.getByLabel("Whose key is it?").fill("Uni");
    await sheet.getByRole("button", { name: "Trust it" }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __parachuteE2EUnlocks?: string[] }).__parachuteE2EUnlocks ?? [])).toEqual(["trust Uni"]);
    expect(await page.evaluate(() => (window as unknown as { __parachuteE2EApprovers: { name: string; pubkey: string }[] }).__parachuteE2EApprovers)).toEqual([{ name: "Uni", pubkey: getPublicKey(uniSk) }]);
    // the card now reads as Uni's, with its buttons
    const sealed = log.getByRole("group", { name: "Uni asks to use a credential" });
    await expect(sealed).toHaveCount(2, { timeout: 20_000 });
    await expect(sealed.filter({ hasText: `Mint a test key ${stamp}` }).getByRole("button", { name: /Approve/ })).toBeVisible();
    // the other card of Uni's, in the same room, without leaving it
    await expect(sealed.filter({ hasText: `Read the test inbox ${stamp}` }).getByRole("button", { name: /Approve/ })).toBeVisible();
    await expect(offered).toHaveCount(0);
    await expect(refused).toHaveCount(1);
  } finally {
    uni.close(); bob.close();
    await made.remove();
  }
});
