// Security levels (docs/design/APP-RECORD.md "Security levels"): Settings → Security in plain words; the idle lock
// covers the app after its minutes and only the device unlock opens it; a stricter level is a tap and goes to the app's
// record; a looser one is signed and kept beside the applets' approvals; a record edited by someone without the key
// raises a device but never lowers it; a passcode level refuses the unlock alone.
// The native side here is the test signer (src/services/e2eNative.ts), which mirrors src-tauri/src/levels.rs; the
// device unlock passes only when the test says so (window.__parachuteE2EUnlock = "pass").
import { devices, expect, test, type Browser, type Page } from "./test";
import { api, hubState, record, VAULT } from "./hub";
import { ui } from "./helpers";
import { newKey } from "./keys";
import { appletRecord } from "../applets/record.ts";

const { defaultBrowserType: _b, ...phone } = devices["Pixel 7"];
async function device(browser: Browser, key: string): Promise<Page> {
  const ctx = await browser.newContext({ ...phone, storageState: "e2e/.signed-in.json" });
  await ctx.addInitScript((k) => { if (window === window.top) (window as unknown as { __parachuteE2EKey: string }).__parachuteE2EKey = k; }, key);
  return ctx.newPage();
}
type Row = { id: string; path: string; updatedAt: string; metadata: Record<string, any> };
const tagged = async (tag: string) => { const r = await api(hubState(), "GET", `notes?tag=${tag}&include_metadata=true`); return (Array.isArray(r) ? r : r.notes ?? []) as Row[]; };
// a vault with no record under the newer names gets a new one under the older (Parachute/Apps, parachute-app, fields.app),
// which builds from before 11-20 read: a raise made here reaches a device still on one (shell/homeSettings.ts changeBundle)
const appRecord = async () => (await tagged("parachute-app")).find((n) => n.path.replace(/\.md$/, "") === "Parachute/Apps/everything");
const security = (p: Page) => p.locator("section", { has: p.getByRole("heading", { name: "Security" }) });
const group = (p: Page, name: string) => security(p).getByRole("group", { name });
const locked = (p: Page) => p.getByRole("dialog", { name: "Parachute is locked" });
const unlockPasses = (p: Page, yes: boolean) => p.evaluate((y) => { (window as unknown as { __parachuteE2EUnlock?: string }).__parachuteE2EUnlock = y ? "pass" : "cancel"; }, yes);

test.describe.configure({ mode: "serial" });
test.afterEach(async () => {
  for (const n of await tagged("parachute-app")) await api(hubState(), "DELETE", `notes/${n.id}`);
  for (const n of await tagged("parachute-approval")) if (n.path.includes("/security-")) await api(hubState(), "DELETE", `notes/${n.id}`);
});

test("the idle lock engages after its minutes, only the unlock opens it, turning it off is signed, and an unsigned record edit weakens nothing", async ({ browser }) => {
  test.setTimeout(90_000);
  const page = await device(browser, newKey());
  await page.clock.install();
  try {
    await page.goto("/settings");
    await expect(group(page, "Lock after").getByRole("button", { name: "Off" })).toHaveAttribute("aria-pressed", "true");
    await expect(group(page, "Approval cards").getByRole("button", { name: "Unlock" })).toHaveAttribute("aria-pressed", "true");
    await expect(group(page, "Joining a network").getByRole("button", { name: "Passcode" })).toHaveAttribute("aria-pressed", "true");

    // stricter is a tap: kept here, and in the app's record for the other devices
    await group(page, "Lock after").getByRole("button", { name: "1 min", exact: true }).click();
    await expect(security(page).getByRole("status")).toContainText("Kept");
    await expect.poll(async () => (await appRecord())?.metadata.app.security).toEqual({ approvals: "unlock", code: "unlock", join: "passcode", idle: 1 });

    // a minute untouched: locked, over everything
    await page.clock.runFor(30_000);
    await expect(locked(page)).toHaveCount(0);
    await page.clock.runFor(31_000);
    await expect(locked(page)).toBeVisible();
    // a cancelled unlock leaves it locked; a touch doesn't open it
    await unlockPasses(page, false);
    await locked(page).getByRole("button", { name: "Unlock" }).click();
    await expect(locked(page).getByRole("alert")).toContainText("cancelled");
    await page.mouse.click(10, 10);
    await expect(locked(page)).toBeVisible();
    await unlockPasses(page, true);
    await locked(page).getByRole("button", { name: "Unlock" }).click();
    await expect(locked(page)).toHaveCount(0);

    // turning it off is less careful: the unlock, then signed with the person's key and kept in the home vault
    await group(page, "Lock after").getByRole("button", { name: "Off" }).click();
    await security(page).getByRole("button", { name: "Change" }).click();
    await expect(security(page).getByRole("status")).toContainText("signed for your other devices");
    const signed = (await tagged("parachute-approval")).find((n) => n.path.endsWith("/security-everything"));
    expect(JSON.parse(signed!.metadata.approval.content)).toMatchObject({ approved: true, code: "levels:v1:approvals=unlock,code=unlock,join=passcode,idle=0", subject: { vault: VAULT, record: "security-everything", applet: "security" } });
    await expect.poll(async () => (await appRecord())?.metadata.app.security.idle).toBe(0);

    // someone who can write the vault, without the key: cards to a tap, joining to a tap. Nothing loosens here
    const r = (await appRecord())!;
    await api(hubState(), "PATCH", `notes/${r.id}`, { metadata: { app: { ...r.metadata.app, security: { approvals: "none", code: "unlock", join: "none", idle: 0 } } }, if_updated_at: r.updatedAt });
    await page.goto("about:blank");
    await page.goto("/settings");
    await expect(group(page, "Approval cards").getByRole("button", { name: "Unlock" })).toHaveAttribute("aria-pressed", "true");
    await expect(group(page, "Joining a network").getByRole("button", { name: "Passcode" })).toHaveAttribute("aria-pressed", "true");
    // and a stricter edit is taken at once
    const r2 = (await appRecord())!;
    await api(hubState(), "PATCH", `notes/${r2.id}`, { metadata: { app: { ...r2.metadata.app, security: { idle: 5 } } }, if_updated_at: r2.updatedAt });
    await page.goto("about:blank");
    await page.goto("/settings");
    await expect(group(page, "Lock after").getByRole("button", { name: "5 min", exact: true })).toHaveAttribute("aria-pressed", "true");
  } finally {
    await page.context().close();
  }
});

test("approving code at the passcode level refuses the unlock alone", async ({ browser }) => {
  test.setTimeout(90_000);
  const made = await record(hubState(), "create", appletRecord("journal"));
  const page = await device(browser, newKey());
  try {
    await page.goto("/settings");
    await security(page).getByRole("textbox", { name: "New passcode" }).fill("garden-gate");
    await security(page).getByRole("button", { name: "Set" }).click();
    await expect(security(page).getByRole("status")).toContainText("Passcode kept");
    await group(page, "Approving an applet's code").getByRole("button", { name: "Passcode" }).click();
    await expect(group(page, "Approving an applet's code").getByRole("button", { name: "Passcode" })).toHaveAttribute("aria-pressed", "true");

    await page.goto(`/v/${VAULT}?with=vault`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Journal/ }).click();
    const card = page.getByRole("region", { name: /asking for access/ });
    await expect(card).toBeVisible();
    // the unlock would pass; without the passcode it isn't signed
    await page.getByRole("button", { name: "Allow" }).click();
    // an empty box is no passcode (not a wrong one, which would count toward the minute's wait)
    await expect(page.getByText(/Not approved/)).toHaveText("Not approved: Your passcode is needed for this.");
    expect((await tagged("parachute-approval")).filter((n) => n.path.endsWith(`/${made.id}`))).toEqual([]);
    await page.getByRole("textbox", { name: "Your passcode" }).fill("garden-gate");
    await page.getByRole("button", { name: "Allow" }).click();
    await expect(page.frameLocator("iframe.applet-frame").getByRole("heading", { name: "Journal" })).toBeVisible();
    expect((await tagged("parachute-approval")).filter((n) => n.path.endsWith(`/${made.id}`))).toHaveLength(1);
  } finally {
    await page.context().close();
    for (const n of await tagged("parachute-approval")) if (n.path.endsWith(`/${made.id}`)) await api(hubState(), "DELETE", `notes/${n.id}`);
    await api(hubState(), "DELETE", `notes/${made.id}`);
  }
});

// Found in review (T-476): the passcode typed for one card stayed in the box. A screen kept running holds its state, so
// when its code changed the new card came up with the passcode already filled in, and Allow asked the unlock alone.
test("the passcode typed for one card isn't left filled in for the next", async ({ browser }) => {
  test.setTimeout(90_000);
  const made = await record(hubState(), "create", appletRecord("journal"));
  const base = String((await api(hubState(), "GET", `notes/${made.id}`)).content);
  const page = await device(browser, newKey());
  const card = page.getByRole("region", { name: /asking for access/ });
  const journal = page.frameLocator("iframe.applet-frame").getByRole("heading", { name: "Journal" });
  try {
    await page.goto("/settings");
    await security(page).getByRole("textbox", { name: "New passcode" }).fill("garden-gate");
    await security(page).getByRole("button", { name: "Set" }).click();
    await expect(security(page).getByRole("status")).toContainText("Passcode kept");
    await group(page, "Approving an applet's code").getByRole("button", { name: "Passcode" }).click();
    await expect(group(page, "Approving an applet's code").getByRole("button", { name: "Passcode" })).toHaveAttribute("aria-pressed", "true");

    await page.goto(`/v/${VAULT}?with=vault`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Journal/ }).click();
    await page.getByRole("textbox", { name: "Your passcode" }).fill("garden-gate");
    await page.getByRole("button", { name: "Allow" }).click();
    await expect(journal).toBeVisible();

    // its code changes while it is kept running (in-app moves only: the screen stays alive); shown again, the card asks,
    // and asks the passcode again
    await page.getByRole("navigation", { name: "Bar" }).getByRole("link", { name: "Applets" }).click();
    const n = await api(hubState(), "GET", `notes/${made.id}`);
    await api(hubState(), "PATCH", `notes/${made.id}`, { content: `${base}\n// v2\n`, if_updated_at: n.updatedAt });
    await page.goBack();
    await expect(card).toContainText("changed");
    await expect(page.getByRole("textbox", { name: "Your passcode" })).toHaveValue("");
    await page.getByRole("button", { name: "Allow this version" }).click();
    await expect(page.getByText(/Not approved/)).toHaveText("Not approved: Your passcode is needed for this.");
    await expect(journal).toHaveCount(0);
  } finally {
    await page.context().close();
    for (const n of await tagged("parachute-approval")) if (n.path.endsWith(`/${made.id}`)) await api(hubState(), "DELETE", `notes/${n.id}`);
    await api(hubState(), "DELETE", `notes/${made.id}`).catch(() => {});
  }
});
