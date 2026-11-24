// Mail (applets/mail.tsx) against a real mail stack: a throwaway Stalwart behind a copy of the Uni app's mail gateway,
// two mailboxes. Alice in the app reads what bob sent, replies (save, review exactly what will go, send), and bob gets
// it, and saves the file bob sent with it. Services workflow only (e2e/services/README.md): MAIL_BRIDGE is the gateway's address, BUZZ_KEYS holds alice.hex and bob.hex
// (keys the gateway maps to the two mailboxes). The browser reaches the gateway through a pass-through that adds CORS on
// port 19952 (which the gateway must accept as an alias); the app itself sends from its native side. The second test
// needs Uni's account on that stack (seed.mjs makes it: uni@test.test, its key BUZZ_KEYS/unibot.hex, outbound rules that hold
// mail to bob for the owner, and alice's key given send.parked, send.approve, send.decline and flag there). Approve is
// an approve op: it passes this device's approvals level (the device unlock, by default) before the approval key signs
// it; the test's unlock is window.__parachuteE2EUnlock (src/services/e2eNative.ts), cancelled unless it says "pass".
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { api, hubState, record, VAULT } from "./hub";
import { ui } from "./helpers";
import { corsProxy, mailAs } from "./services/client";
import { appletRecord } from "../applets/record.ts";

const BRIDGE = process.env.MAIL_BRIDGE;
const KEYS = process.env.BUZZ_KEYS ?? "";
test.skip(!BRIDGE || !KEYS, "needs the mail stack (MAIL_BRIDGE, BUZZ_KEYS): e2e/services/README.md");
test.use({ storageState: "e2e/.signed-in.json" });
const secret = (n: string) => readFileSync(join(KEYS, `${n}.hex`), "utf8").trim();
const MAIL = "urn:ietf:params:jmap:mail";
const hex = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");

test("mail: alice reads what bob sent, replies after reviewing exactly what will go, and bob gets it", async ({ page }) => {
  test.setTimeout(120_000);
  const stamp = Date.now().toString(36);
  const bob = mailAs(BRIDGE!, secret("bob"));
  const proxy = await corsProxy(BRIDGE!, 19952);
  await page.addInitScript((k) => { if (window === window.top) (window as unknown as { __parachuteE2EKey: string }).__parachuteE2EKey = k; }, secret("alice"));
  const note = await record(hubState(), "create", appletRecord("mail", { mail: `${proxy.url}/mail/` }));
  try {
    const aliceAddr = (await mailAs(BRIDGE!, secret("alice")).post("session", {})).account as string;
    await bob.send(aliceAddr, `Tomato seedlings ${stamp}`, `Hi Alice,\n\nThe seedlings are ready to pick up on Saturday.\n\nBob`,
      [{ name: "seed-list.txt", type: "text/plain", bytes: Buffer.from(`seed list ${stamp}\ntomatoes, basil\n`) }]);

    await page.goto(`/v/${VAULT}?with=vault`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Mail/ }).click();
    const card = page.getByRole("region", { name: /asking for access/ });
    await expect(card).toContainText(`With your everyday key: send requests to 127.0.0.1:19952 on this device signed as you`);
    await page.getByRole("button", { name: "Allow" }).click();
    const app = page.frameLocator("iframe.applet-frame");
    const inbox = app.getByRole("region", { name: "Inbox" });
    const row = inbox.getByRole("button", { name: new RegExp(`Tomato seedlings ${stamp}`) });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toHaveClass(/pa-strong/);

    // read it: the thread, marked seen
    await row.click();
    await expect(app.getByRole("article", { name: `Tomato seedlings ${stamp}` })).toContainText("ready to pick up on Saturday");
    // its file, saved: the browser's own download (the app's Downloads on a device), with bob's bytes
    const download = page.waitForEvent("download");
    await app.getByRole("button", { name: "Save seed-list.txt" }).click();
    const dl = await download;
    expect(dl.suggestedFilename()).toBe("seed-list.txt");
    expect(readFileSync(await dl.path()).toString()).toContain(`seed list ${stamp}`);
    await expect(app.getByRole("status").filter({ hasText: "Saved to Downloads as seed-list.txt" })).toBeVisible();
    // reply: save, review what will go, send
    await app.getByRole("button", { name: "Reply" }).click();
    await expect(app.getByLabel("Subject")).toHaveValue(`Re: Tomato seedlings ${stamp}`);
    await app.getByLabel("Message").fill(`Saturday works. Thank you! ${stamp}`);
    await app.getByRole("button", { name: "Save and review" }).click();
    const review = app.getByRole("region", { name: "What will be sent" });
    await expect(review).toContainText(`Saturday works. Thank you! ${stamp}`);
    await expect(review).toContainText(`To `);
    // the Inbox's read (its threads too) answers slowly from here on: an Inbox read asked as Sent opens must not land
    // over Sent (a slow CI runner showed it, T-476)
    await page.route("**/mail/jmap", async (route) => {
      if (/Thread\/get/.test(route.request().postData() ?? "") && /collapseThreads/.test(route.request().postData() ?? "")) await new Promise((r) => setTimeout(r, 2500));
      await route.continue();
    });
    await app.getByRole("button", { name: "Send it" }).click();
    await expect(app.getByRole("status").filter({ hasText: "Sent." })).toBeVisible();
    // it is in Sent, and in bob's inbox
    await expect(app.getByRole("region", { name: "Sent" }).getByRole("button", { name: new RegExp(`Re: Tomato seedlings ${stamp}`) })).toBeVisible({ timeout: 20_000 });
    // and still, once the slow Inbox read has answered
    await page.waitForTimeout(3000);
    await expect(app.getByRole("region", { name: "Sent" }).getByRole("button", { name: new RegExp(`Re: Tomato seedlings ${stamp}`) })).toBeVisible();
    await page.unroute("**/mail/jmap");
    await expect.poll(async () => (await bob.inbox()).some((m) => m.subject === `Re: Tomato seedlings ${stamp}`), { timeout: 30_000 }).toBe(true);
    // the thread now ends with her own reply: Reply still answers bob, not herself
    await app.getByRole("navigation", { name: "Places" }).getByRole("button", { name: /Inbox/ }).click();
    await inbox.getByRole("button", { name: new RegExp(`Tomato seedlings ${stamp}`) }).click();
    await expect(app.getByRole("article")).toHaveCount(2);
    await app.getByRole("button", { name: "Reply" }).click();
    await expect(app.getByLabel("To")).toHaveValue(/bob@/);
    await app.getByRole("button", { name: "← Mail" }).click();
    // back in the inbox, bob's message reads as seen; search finds it
    await app.getByRole("navigation", { name: "Places" }).getByRole("button", { name: /Inbox/ }).click();
    await expect(inbox.getByRole("button", { name: new RegExp(`Tomato seedlings ${stamp}`) })).not.toHaveClass(/pa-strong/);
    await app.getByLabel("Search mail").fill(stamp);
    await app.getByLabel("Search mail").press("Enter");
    await expect(app.getByRole("region", { name: "Found" }).getByRole("button")).not.toHaveCount(0);
  } finally {
    await proxy.close();
    await api(hubState(), "DELETE", `notes/${note.id}`);
  }
});

test("mail: Uni's held sends wait for alice; she approves one (bob gets it) and declines one (nobody does); Later puts a thread off", async ({ page }) => {
  test.setTimeout(150_000);
  const stamp = Date.now().toString(36);
  const bob = mailAs(BRIDGE!, secret("bob")), uni = mailAs(BRIDGE!, secret("unibot")), alice = mailAs(BRIDGE!, secret("alice"));
  const uniAcct = (await uni.post("session", {})).primaryAccounts[MAIL] as string;
  // Uni writes to bob and sends; its outbound rules hold mail to bob for the owner
  const hold = async (subject: string, text: string) => {
    const d = await uni.post("op", { op: "draft.save", accountId: uniAcct, fields: { to: [{ email: "bob@test.test" }], subject, text } });
    const r = await uni.post("op", { op: "send", accountId: uniAcct, opId: hex(), draftId: d.draftId, fingerprint: d.fingerprint });
    expect(r.state).toBe("awaiting-approval");
    return r.opId as string;
  };
  const proxy = await corsProxy(BRIDGE!, 19952);
  await page.addInitScript((k) => { if (window === window.top) (window as unknown as { __parachuteE2EKey: string }).__parachuteE2EKey = k; }, secret("alice"));
  const note = await record(hubState(), "create", appletRecord("mail", { mail: `${proxy.url}/mail/` }));
  try {
    await hold(`Seed order ${stamp}`, `Hello Bob,\n\nAlice would like two trays of basil for Saturday.\n\nUni, for Alice`);
    const declined = await hold(`Invoice ${stamp}`, `Bob, the invoice is attached in spirit.`);
    const aliceAddr = (await alice.post("session", {})).account as string;
    await bob.send(aliceAddr, `Fence repair ${stamp}`, `Alice,\n\nThe fence can wait until spring.\n\nBob`);

    await page.goto(`/v/${VAULT}?with=vault`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Mail/ }).click();
    // the access card says approving goes out with the person's key, as high risk
    await expect(page.getByRole("region", { name: /asking for access/ })).toContainText("High risk. With your key: sign its send.approve requests to 127.0.0.1:19952 on this device with your approval key");
    await page.getByRole("button", { name: "Allow" }).click();
    const app = page.frameLocator("iframe.applet-frame");
    const places = app.getByRole("navigation", { name: "Places" });
    await expect(places.getByRole("button", { name: /^Waiting · \d+$/ })).toBeVisible({ timeout: 30_000 });

    // Waiting: the held send in full, then Approve
    await places.getByRole("button", { name: /^Waiting/ }).click();
    const held = app.getByRole("region", { name: "Waiting" });
    await held.getByRole("button", { name: new RegExp(`Seed order ${stamp}`) }).click();
    const sendIt = app.getByRole("article", { name: `Seed order ${stamp}` });
    await expect(sendIt).toContainText("two trays of basil for Saturday");
    await expect(sendIt).toContainText("From Uni (uni@test.test) · to bob@test.test");
    await expect(sendIt).toContainText("Why it waits: Uni's outbound rules want Aaron to approve mail to bob@test.test");
    // Approve asks the device unlock first (this device's approvals level); cancelled, nothing goes and it still waits
    const unlocks = () => page.evaluate(() => (window as unknown as { __parachuteE2EUnlocks?: string[] }).__parachuteE2EUnlocks ?? []);
    const unlockPasses = (yes: boolean) => page.evaluate((y) => { (window as unknown as { __parachuteE2EUnlock?: string }).__parachuteE2EUnlock = y ? "pass" : "cancel"; }, yes);
    await unlockPasses(false);
    await app.getByRole("button", { name: "Approve" }).click();
    await expect(app.getByRole("status").filter({ hasText: "Not sent: The device unlock was cancelled or failed." })).toBeVisible();
    expect(await unlocks()).toEqual(["approve send.approve"]);
    // tapped again at once: one tap pays for one approval, so it says to tap again in a moment (not "needs your tap")
    await unlockPasses(true);
    await app.getByRole("button", { name: "Approve" }).click();
    await expect(app.getByRole("status").filter({ hasText: "Not sent: Tap again in a moment: one tap pays for one approval." })).toBeVisible();
    expect(await unlocks()).toEqual(["approve send.approve"]);
    // a moment later (past the tap and the cancel's cooldown), with the unlock, it goes
    await page.waitForTimeout(5_100);
    await app.getByRole("button", { name: "Approve" }).click();
    await expect(app.getByRole("status").filter({ hasText: "Sent." })).toBeVisible();
    await expect(app.getByRole("button", { name: "Approve" })).toHaveCount(0);
    expect(await unlocks()).toEqual(["approve send.approve", "approve send.approve"]);
    await expect.poll(async () => (await bob.inbox()).filter((m) => m.subject === `Seed order ${stamp}`).length, { timeout: 30_000 }).toBe(1);

    // the second one: Decline, and nothing goes
    await app.getByRole("button", { name: "← Waiting" }).click();
    await expect(held.getByRole("button", { name: new RegExp(`Seed order ${stamp}`) })).toContainText("Sent");
    await held.getByRole("button", { name: new RegExp(`Invoice ${stamp}`) }).click();
    await app.getByRole("button", { name: "Decline" }).click();
    await expect(app.getByRole("status").filter({ hasText: "Declined. Nothing was sent." })).toBeVisible();
    expect((await uni.post("op", { op: "send.check", accountId: uniAcct, opId: declined })).state).toBe("declined");
    await page.waitForTimeout(3000);
    expect((await bob.inbox()).some((m) => m.subject === `Invoice ${stamp}`)).toBe(false);
    // and the approved one went once (the cancelled try sent nothing)
    expect((await bob.inbox()).filter((m) => m.subject === `Seed order ${stamp}`)).toHaveLength(1);
    await app.getByRole("button", { name: "← Waiting" }).click();
    await expect(held.getByRole("button", { name: new RegExp(`Invoice ${stamp}`) })).toContainText("Declined");
    // declining sends nothing, so it asks no unlock
    expect(await unlocks()).toEqual(["approve send.approve", "approve send.approve"]);

    // Later: put bob's message off; it leaves the Inbox for Later, and Not later brings it back
    await places.getByRole("button", { name: /^Inbox/ }).click();
    const inbox = app.getByRole("region", { name: "Inbox" });
    await inbox.getByRole("button", { name: new RegExp(`Fence repair ${stamp}`) }).click();
    await app.getByRole("button", { name: "Later", exact: true }).click();
    await expect(app.getByRole("status").filter({ hasText: "Put off for later." })).toBeVisible();
    await expect(app.getByRole("button", { name: "Not later", exact: true })).toBeVisible();
    await app.getByRole("button", { name: "← Mail" }).click();
    await expect(inbox.getByRole("button", { name: new RegExp(`Fence repair ${stamp}`) })).toHaveCount(0);
    await places.getByRole("button", { name: /^Later/ }).click();
    const later = app.getByRole("region", { name: "Later" });
    await later.getByRole("button", { name: new RegExp(`Fence repair ${stamp}`) }).click();
    await app.getByRole("button", { name: "Not later", exact: true }).click();
    await expect(app.getByRole("status").filter({ hasText: "Not later any more." })).toBeVisible();
    await app.getByRole("button", { name: "← Mail" }).click();
    await expect(later.getByRole("button", { name: new RegExp(`Fence repair ${stamp}`) })).toHaveCount(0);
    await places.getByRole("button", { name: /^Inbox/ }).click();
    await expect(inbox.getByRole("button", { name: new RegExp(`Fence repair ${stamp}`) })).toBeVisible();
  } finally {
    // nothing of this run stays waiting
    const left = ((await alice.post("op", { op: "send.parked", accountId: uniAcct }).catch(() => ({ parked: [] }))).parked ?? []) as { opId: string; fields?: { subject: string } }[];
    for (const p of left.filter((x) => x.fields?.subject.endsWith(stamp))) await alice.post("op", { op: "send.decline", accountId: uniAcct, opId: p.opId }).catch(() => {});
    await proxy.close();
    await api(hubState(), "DELETE", `notes/${note.id}`);
  }
});
