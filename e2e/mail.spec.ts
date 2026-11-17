// Mail (applets/mail.tsx) against a real mail stack: a throwaway Stalwart behind a copy of the Uni app's mail gateway,
// two mailboxes. Alice in the app reads what bob sent, replies (save, review exactly what will go, send), and bob gets
// it. Local only (e2e/services/README.md): MAIL_BRIDGE is the gateway's address, BUZZ_KEYS holds alice.hex and bob.hex
// (keys the gateway maps to the two mailboxes). The browser reaches the gateway through a pass-through that adds CORS on
// port 19952 (which the gateway must accept as an alias); the app itself sends from its native side.
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
    await expect(card).toContainText(`Send requests to 127.0.0.1:19952 on this device signed as you`);
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
