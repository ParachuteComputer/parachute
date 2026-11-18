// Mail (applets/mail.tsx) against a real mail stack: a throwaway Stalwart behind a copy of the Uni app's mail gateway,
// two mailboxes. Alice in the app reads what bob sent, replies (save, review exactly what will go, send), and bob gets
// it. Local only (e2e/services/README.md): MAIL_BRIDGE is the gateway's address, BUZZ_KEYS holds alice.hex and bob.hex
// (keys the gateway maps to the two mailboxes). The browser reaches the gateway through a pass-through that adds CORS on
// port 19952 (which the gateway must accept as an alias); the app itself sends from its native side. The second test
// needs Uni's account on that stack (infra/mail: uni@test.test, its key BUZZ_KEYS/unibot.hex, outbound rules that hold
// mail to bob for the owner, and alice's key given send.parked, send.approve, send.decline and flag there).
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
    await bob.send(aliceAddr, `Tomato seedlings ${stamp}`, `Hi Alice,\n\nThe seedlings are ready to pick up on Saturday.\n\nBob`);

    await page.goto(`/v/${VAULT}`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Mail/ }).click();
    const card = page.getByRole("region", { name: /asking for access/ });
    await expect(card).toContainText(`With your everyday key: send requests to 127.0.0.1:19952 on this device signed as you`);
    await page.getByRole("button", { name: "Allow" }).click();
    const app = page.frameLocator("iframe.applet-frame");
    const inbox = app.getByRole("list", { name: "Inbox" });
    const row = inbox.getByRole("button", { name: new RegExp(`Tomato seedlings ${stamp}`) });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toHaveClass(/unseen/);

    // read it: the thread, marked seen
    await row.click();
    await expect(app.getByRole("article", { name: `Tomato seedlings ${stamp}` })).toContainText("ready to pick up on Saturday");
    // reply: save, review what will go, send
    await app.getByRole("button", { name: "Reply" }).click();
    await expect(app.getByLabel("Subject")).toHaveValue(`Re: Tomato seedlings ${stamp}`);
    await app.getByLabel("Message").fill(`Saturday works. Thank you! ${stamp}`);
    await app.getByRole("button", { name: "Save and review" }).click();
    const review = app.getByRole("region", { name: "What will be sent" });
    await expect(review).toContainText(`Saturday works. Thank you! ${stamp}`);
    await expect(review).toContainText(`To `);
    await app.getByRole("button", { name: "Send it" }).click();
    await expect(app.getByRole("status")).toHaveText("Sent.");
    // it is in Sent, and in bob's inbox
    await expect(app.getByRole("list", { name: "Sent" }).getByRole("button", { name: new RegExp(`Re: Tomato seedlings ${stamp}`) })).toBeVisible({ timeout: 20_000 });
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
    await expect(inbox.getByRole("button", { name: new RegExp(`Tomato seedlings ${stamp}`) })).not.toHaveClass(/unseen/);
    await app.getByLabel("Search mail").fill(stamp);
    await app.getByLabel("Search mail").press("Enter");
    await expect(app.getByRole("list", { name: "Found" }).getByRole("button")).not.toHaveCount(0);
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

    await page.goto(`/v/${VAULT}`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Mail/ }).click();
    // the access card says approving goes out with the approval key
    await expect(page.getByRole("region", { name: /asking for access/ })).toContainText("With your approval key: send send.approve requests to 127.0.0.1:19952");
    await page.getByRole("button", { name: "Allow" }).click();
    const app = page.frameLocator("iframe.applet-frame");
    const places = app.getByRole("navigation", { name: "Places" });
    await expect(places.getByRole("button", { name: /^Waiting · \d+$/ })).toBeVisible({ timeout: 30_000 });

    // Waiting: the held send in full, then Approve
    await places.getByRole("button", { name: /^Waiting/ }).click();
    const held = app.getByRole("list", { name: "Waiting" });
    await held.getByRole("button", { name: new RegExp(`Seed order ${stamp}`) }).click();
    const sendIt = app.getByRole("article", { name: `Seed order ${stamp}` });
    await expect(sendIt).toContainText("two trays of basil for Saturday");
    await expect(sendIt).toContainText("From Uni (uni@test.test) · to bob@test.test");
    await expect(sendIt).toContainText("Why it waits: Uni's outbound rules want Aaron to approve mail to bob@test.test");
    await app.getByRole("button", { name: "Approve" }).click();
    await expect(app.getByRole("status")).toHaveText("Sent.");
    await expect(app.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await expect.poll(async () => (await bob.inbox()).some((m) => m.subject === `Seed order ${stamp}`), { timeout: 30_000 }).toBe(true);

    // the second one: Decline, and nothing goes
    await app.getByRole("button", { name: "← Waiting" }).click();
    await expect(held.getByRole("button", { name: new RegExp(`Seed order ${stamp}`) })).toContainText("Sent");
    await held.getByRole("button", { name: new RegExp(`Invoice ${stamp}`) }).click();
    await app.getByRole("button", { name: "Decline" }).click();
    await expect(app.getByRole("status")).toHaveText("Declined. Nothing was sent.");
    expect((await uni.post("op", { op: "send.check", accountId: uniAcct, opId: declined })).state).toBe("declined");
    await page.waitForTimeout(3000);
    expect((await bob.inbox()).some((m) => m.subject === `Invoice ${stamp}`)).toBe(false);
    await app.getByRole("button", { name: "← Waiting" }).click();
    await expect(held.getByRole("button", { name: new RegExp(`Invoice ${stamp}`) })).toContainText("Declined");

    // Later: put bob's message off; it leaves the Inbox for Later, and Not later brings it back
    await places.getByRole("button", { name: /^Inbox/ }).click();
    const inbox = app.getByRole("list", { name: "Inbox" });
    await inbox.getByRole("button", { name: new RegExp(`Fence repair ${stamp}`) }).click();
    await app.getByRole("button", { name: "Later", exact: true }).click();
    await expect(app.getByRole("status")).toHaveText("Put off for later.");
    await expect(app.getByRole("button", { name: "Not later", exact: true })).toBeVisible();
    await app.getByRole("button", { name: "← Mail" }).click();
    await expect(inbox.getByRole("button", { name: new RegExp(`Fence repair ${stamp}`) })).toHaveCount(0);
    await places.getByRole("button", { name: /^Later/ }).click();
    const later = app.getByRole("list", { name: "Later" });
    await later.getByRole("button", { name: new RegExp(`Fence repair ${stamp}`) }).click();
    await app.getByRole("button", { name: "Not later", exact: true }).click();
    await expect(app.getByRole("status")).toHaveText("Not later any more.");
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
