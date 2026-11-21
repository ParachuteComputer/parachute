// Claude accounts (applets/accounts.tsx): the Uni app's "New workers use" picker as an applet writing the launcher's
// note, System/Claude accounts (PARITY-FROM-SYSTEMS item 1): account_preference with when it was set and until when.
import { expect, test } from "@playwright/test";
import { api, hubState, record, VAULT } from "./hub";
import { ui } from "./helpers";
import { appletRecord } from "../applets/record.ts";

test.use({ storageState: "e2e/.signed-in.json" });

test("Claude accounts: each account's use, and which one new workers use, from the launcher's note", async ({ page }) => {
  const made: string[] = [];
  const reset = new Date(Date.now() + 3 * 86400_000).toISOString();
  const usage = await api(hubState(), "POST", "notes", { path: "System/Claude accounts", tags: ["claude-accounts"], content: "Claude accounts",
    metadata: { claude_accounts: { version: 1, accounts: [{ name: "a", session: { used: 40, resets_at: null }, week: { used: 70, resets_at: reset } }, { name: "b", session: { used: 5, resets_at: null }, week: { used: 12, resets_at: reset } }], preference: "auto", next: { account: "a", how: "auto" } }, account_preference: "auto" } });
  made.push(usage.id);
  made.push((await record(hubState(), "create", appletRecord("accounts"))).id);
  try {
    await page.goto(`/v/${VAULT}?with=vault`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Claude accounts/ }).click();
    await expect(page.getByRole("region", { name: /asking for access/ })).toContainText("Read notes outside its own folder, in System/");
    await page.getByRole("button", { name: "Allow" }).click();
    const app = page.frameLocator("iframe.applet-frame");
    await expect(app.getByText("New workers use whichever account has room.")).toBeVisible();
    await expect(app.getByRole("region", { name: "Accounts" })).toContainText("Account Bsession 5% · week 12%");
    // the launcher sets B until its reset: the applet says so
    const md = (await api(hubState(), "GET", `notes/${usage.id}`)).metadata;
    await api(hubState(), "PATCH", `notes/${usage.id}`, { metadata: { ...md, account_preference: "b", account_preference_until: reset }, force: true });
    await page.reload();
    await page.getByRole("button", { name: /Open Claude accounts/ }).click().catch(() => {});
    await expect(app.getByText(/New workers use Account B until/)).toBeVisible();
  } finally {
    for (const id of made) await api(hubState(), "DELETE", `notes/${id}`).catch(() => {});
  }
});
