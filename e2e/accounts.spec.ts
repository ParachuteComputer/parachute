// Claude accounts (applets/accounts.tsx): the Uni app's "New workers use" picker as an applet writing the launcher's
// note, System/Claude accounts (PARITY-FROM-SYSTEMS item 1): account_preference with when it was set and until when.
// Its meters show in Settings too, as the Uni app's did (its section, fields.settings; Aaron 11-22).
import { expect, test } from "./test";
import { api, hubState, record, VAULT } from "./hub";
import { ui } from "./helpers";
import { appletRecord } from "../applets/record.ts";

test.use({ storageState: "e2e/.signed-in.json" });

test("Claude accounts: each account's use, and which one new workers use, from the launcher's note", async ({ page }) => {
  const made: string[] = [];
  const reset = new Date(Date.now() + 3 * 86400_000).toISOString();
  const usage = await api(hubState(), "POST", "notes", { path: "System/Claude accounts", tags: ["claude-accounts"], content: "Claude accounts",
    metadata: { claude_accounts: { version: 1, stop: 95, accounts: [
      // read just now; A at the launcher's stop on the week, with its Fable week; B's reading is three hours old
      { name: "a", read_at: new Date().toISOString(), session: { used: 40, resets_at: null }, week: { used: 96, resets_at: reset }, models: { fable: { name: "Fable", used: 16, resets_at: reset } }, stop: { session: null, week: 95, why: null, session_limit: false } },
      { name: "b", read_at: new Date(Date.now() - 3 * 3600_000).toISOString(), session: { used: 5, resets_at: null }, week: { used: 12, resets_at: reset } }], preference: "auto", next: { account: "a", how: "auto" } }, account_preference: "auto" } });
  made.push(usage.id);
  made.push((await record(hubState(), "create", appletRecord("accounts"))).id);
  try {
    await page.goto(`/v/${VAULT}?with=vault`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Claude accounts/ }).click();
    await expect(page.getByRole("region", { name: /asking for access/ })).toContainText("Read notes outside its own folder, in System/");
    await page.getByRole("button", { name: "Allow" }).click();
    const app = page.frameLocator("iframe.applet-frame");
    await expect(app.getByText("New workers use whichever account has room.")).toBeVisible();
    await expect(app.getByRole("group", { name: "Week 96%" })).toContainText("paused: keeping 5% for rooms");
    await expect(app.getByRole("group", { name: "Fable week 16%" })).toBeVisible();
    // the bar's fill is drawn in the theme's colour (the walk on 11-22 found it named a colour the theme doesn't have)
    const [fill, text] = await app.getByRole("group", { name: "Fable week 16%" }).locator(".meter-bar > span").evaluate((e) => {
      const probe = document.createElement("span"); probe.style.backgroundColor = "var(--text)"; document.body.appendChild(probe);
      const t = getComputedStyle(probe).backgroundColor; probe.remove(); return [getComputedStyle(e).backgroundColor, t];
    });
    expect(fill).toBe(text);
    expect(fill).not.toBe("rgba(0, 0, 0, 0)");
    await expect(app.getByRole("group", { name: "Session 40%" })).toContainText("info, not a limit");
    // (three hours before a time just after midnight is yesterday: then it says so)
    const bRead = new Date(Date.now() - 3 * 3600_000);
    await expect(app.getByRole("region", { name: "Account B" })).toContainText(bRead.toDateString() === new Date().toDateString() ? "last reading 3h ago" : "last reading Yesterday");
    await expect(app.getByRole("group", { name: "Week 12%" })).toContainText("on pace");

    // in Settings: its section, the meters without the info-only session, and who new workers go to
    await page.goto("/settings");
    const usageSection = page.getByRole("region", { name: "Claude usage" });
    await expect(usageSection.getByRole("heading", { name: "Claude usage" })).toBeVisible();
    const inSettings = usageSection.frameLocator("iframe");
    await expect(inSettings.getByRole("group", { name: "Week 96%" })).toBeVisible();
    await expect(inSettings.getByRole("group", { name: "Session 40%" })).toHaveCount(0);
    await expect(inSettings.getByRole("group", { name: "Session 5%" })).toBeVisible();
    await expect(inSettings.getByText("New workers use whichever account has room.")).toBeVisible();
    await page.goBack();
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
