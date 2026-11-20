// Signed approvals (docs/design/APP-RECORD.md): on a device with the person's key, Allow signs "this exact code, asking
// exactly this" and keeps it in the home vault; another device with that key checks it and runs that version without
// asking. Changed code stops on every device until one of them approves it again. A vault writer can't make code run:
// an approval with an edited hash, or one signed by a key that isn't the person's, is refused.
// Two devices here are two browser contexts holding the same key (as the person's phone and laptop do after pairing).
import { createHash } from "node:crypto";
import { devices, expect, test, type Browser, type Page } from "@playwright/test";
import { finalizeEvent } from "nostr-tools/pure";
import { api, hubState, record, VAULT } from "./hub";
import { fromAppletMenu, ui } from "./helpers";
import { newKey } from "./keys";
import { appletRecord } from "../applets/record.ts";

const { defaultBrowserType: _b, ...phone } = devices["Pixel 7"];
async function device(browser: Browser, key: string): Promise<Page> {
  const ctx = await browser.newContext({ ...phone, storageState: "e2e/.signed-in.json" });
  await ctx.addInitScript((k) => { if (window === window.top) (window as unknown as { __parachuteE2EKey: string }).__parachuteE2EKey = k; }, key);
  return ctx.newPage();
}
const card = (p: Page) => p.getByRole("region", { name: /asking for access/ });
const journal = (p: Page) => p.frameLocator("iframe.applet-frame").getByRole("heading", { name: "Journal" });
async function open(p: Page) {
  await p.goto(`/v/${VAULT}`);
  await ui(p).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Journal/ }).click();
}
type Row = { id: string; path: string; updatedAt: string; metadata: { approval?: { content: string; tags: string[][]; pubkey: string } } };
/** The approvals of one applet (its record id ends the path): tests running beside this one keep their own. */
let only = "";
const approvals = async () => { const r = await api(hubState(), "GET", "notes?tag=parachute-approval&include_metadata=true"); return ((Array.isArray(r) ? r : r.notes ?? []) as Row[]).filter((x) => x.path.endsWith(`/${only}`)); };
test.describe.configure({ mode: "serial" });
const bytes = (b: Uint8Array | string) => typeof b === "string" ? Uint8Array.from(Buffer.from(b, "hex")) : b;

test("one approval covers every device; changed code stops until approved again; a forged or stranger's approval runs nothing", async ({ browser }) => {
  test.setTimeout(120_000);
  const me = newKey(), stranger = newKey();
  const made = await record(hubState(), "create", appletRecord("journal"));
  only = made.id;
  const base = String((await api(hubState(), "GET", `notes/${made.id}`)).content);
  const setCode = async (src: string) => { const n = await api(hubState(), "GET", `notes/${made.id}`); await api(hubState(), "PATCH", `notes/${made.id}`, { content: src, if_updated_at: n.updatedAt }); };
  const phoneA = await device(browser, me), laptopB = await device(browser, me);
  try {
    // the phone allows it: an approval signed with the person's key, after the unlock, kept in the home vault
    await open(phoneA);
    await expect(card(phoneA)).toBeVisible();
    await phoneA.getByRole("button", { name: "Allow" }).click();
    await expect(journal(phoneA)).toBeVisible();
    const [a] = await approvals();
    expect(a.path).toMatch(new RegExp(`^Parachute/Approvals/.+/${VAULT}/${made.id}$`));
    expect(JSON.parse(a.metadata.approval!.content)).toMatchObject({ v: 1, approved: true, subject: { vault: VAULT, record: made.id, applet: "journal" } });
    expect(await phoneA.evaluate(() => (window as unknown as { __parachuteE2EApprovals?: string[] }).__parachuteE2EApprovals)).toEqual(["Journal"]);

    // the laptop runs it without asking: it checked the signature and hashed the code itself
    await open(laptopB);
    await expect(journal(laptopB)).toBeVisible();
    await expect(card(laptopB)).toHaveCount(0);

    // changed code (an agent, or someone with the vault's token, wrote it): it stops on both
    await setCode(`${base}\n// v2\n`);
    await open(laptopB);
    await expect(card(laptopB)).toContainText("changed");
    await expect(journal(laptopB)).toHaveCount(0);
    // approved once, on the phone: the laptop runs the new version
    await open(phoneA);
    await phoneA.getByRole("button", { name: "Allow this version" }).click();
    await expect(journal(phoneA)).toBeVisible();
    await open(laptopB);
    await expect(journal(laptopB)).toBeVisible();
    await expect(card(laptopB)).toHaveCount(0);

    // a vault writer changes the code again and makes the approval match: edited hash (the signature breaks), or
    // re-signed with a key of their own. Neither runs.
    const v3 = `${base}\n// v3\n`;
    await setCode(v3);
    const code3 = `tsx:${createHash("sha256").update(v3).digest("hex")}`;
    const [row] = await approvals();
    const ev = row.metadata.approval!;
    const was = JSON.parse(ev.content);
    const edited = { ...ev, content: JSON.stringify({ ...was, code: code3 }) };
    const put = async (approval: unknown) => { const [r] = await approvals(); await api(hubState(), "PATCH", `notes/${r.id}`, { metadata: { approval }, if_updated_at: r.updatedAt }); };
    await put(edited);
    await open(laptopB);
    await expect(card(laptopB)).toBeVisible();
    await expect(journal(laptopB)).toHaveCount(0);
    const theirs = finalizeEvent({ kind: 30479, created_at: Math.floor(Date.now() / 1000), tags: ev.tags, content: JSON.stringify({ ...was, code: code3, n: was.n + 1 }) }, bytes(stranger));
    await put(theirs);
    await open(laptopB);
    await expect(card(laptopB)).toBeVisible();
    await expect(journal(laptopB)).toHaveCount(0);
  } finally {
    await phoneA.context().close(); await laptopB.context().close();
    for (const r of await approvals()) await api(hubState(), "DELETE", `notes/${r.id}`).catch(() => {});
    await api(hubState(), "DELETE", `notes/${made.id}`).catch(() => {});
  }
});

test("Revoke on one device takes it back on the others; a cancelled unlock approves nothing", async ({ browser }) => {
  test.setTimeout(90_000);
  const me = newKey();
  const made = await record(hubState(), "create", appletRecord("journal"));
  only = made.id;
  const phoneA = await device(browser, me), laptopB = await device(browser, me);
  try {
    await phoneA.evaluate(() => { (window as unknown as { __parachuteE2EApprove: string }).__parachuteE2EApprove = "cancel"; });
    await open(phoneA);
    await phoneA.evaluate(() => { (window as unknown as { __parachuteE2EApprove: string }).__parachuteE2EApprove = "cancel"; });
    await phoneA.getByRole("button", { name: "Allow" }).click();
    await expect(card(phoneA)).toContainText("Not approved");
    await expect(journal(phoneA)).toHaveCount(0);
    expect(await approvals()).toEqual([]);
    await phoneA.evaluate(() => { (window as unknown as { __parachuteE2EApprove: string }).__parachuteE2EApprove = "pass"; });
    await phoneA.getByRole("button", { name: "Allow" }).click();
    await expect(journal(phoneA)).toBeVisible();
    await open(laptopB);
    await expect(journal(laptopB)).toBeVisible();
    // a Revoke whose unlock is cancelled stops it here, says so, and isn't undone by the approval still standing
    const setApprove = (p: Page, v: string) => p.evaluate((x) => { (window as unknown as { __parachuteE2EApprove: string }).__parachuteE2EApprove = x; }, v);
    await setApprove(laptopB, "cancel");
    await fromAppletMenu(laptopB, "Revoke");
    await expect(laptopB.getByRole("alert")).toContainText("Stopped on this device only");
    await expect(card(laptopB)).toBeVisible();
    await open(laptopB);
    await expect(card(laptopB)).toBeVisible();
    await expect(journal(laptopB)).toHaveCount(0);
    await setApprove(laptopB, "pass");
    await laptopB.getByRole("button", { name: "Allow" }).click();
    await expect(journal(laptopB)).toBeVisible();
    // the laptop revokes: taken back on every device
    await fromAppletMenu(laptopB, "Revoke");
    await expect.poll(async () => JSON.parse((await approvals())[0].metadata.approval!.content).approved).toBe(false);
    // and here: the card, not allowed again from the approval it just took back
    await expect(card(laptopB)).toBeVisible();
    await open(laptopB);
    await expect(card(laptopB)).toBeVisible();
    await expect(journal(laptopB)).toHaveCount(0);
    await open(phoneA);
    await expect(card(phoneA)).toBeVisible();
    await expect(journal(phoneA)).toHaveCount(0);
  } finally {
    await phoneA.context().close(); await laptopB.context().close();
    for (const r of await approvals()) await api(hubState(), "DELETE", `notes/${r.id}`).catch(() => {});
    await api(hubState(), "DELETE", `notes/${made.id}`).catch(() => {});
  }
});

// Found in review (T-476): Settings → Applets → Revoke only forgot this device's grant. The approval stayed in the home
// vault, so the next open found it and allowed the applet again with no card, and the other devices never stopped.
test("Revoke in Settings takes it back on every device, as Revoke in the applet's menu does", async ({ browser }) => {
  test.setTimeout(90_000);
  const me = newKey();
  const made = await record(hubState(), "create", appletRecord("journal"));
  only = made.id;
  const phoneA = await device(browser, me), laptopB = await device(browser, me);
  const revokeInSettings = (p: Page) => p.getByRole("list", { name: "Allowed applets" }).getByRole("listitem").filter({ hasText: "Journal" }).getByRole("button", { name: "Revoke" }).click();
  const setApprove = (p: Page, v: string) => p.evaluate((x) => { (window as unknown as { __parachuteE2EApprove: string }).__parachuteE2EApprove = x; }, v);
  try {
    await open(phoneA);
    await phoneA.getByRole("button", { name: "Allow" }).click();
    await expect(journal(phoneA)).toBeVisible();
    await open(laptopB);
    await expect(journal(laptopB)).toBeVisible();

    // the laptop revokes in Settings and cancels the unlock: stopped there, said so, and not allowed again by the
    // approval still standing
    await laptopB.goto("/settings");
    await setApprove(laptopB, "cancel");
    await revokeInSettings(laptopB);
    await expect(laptopB.getByRole("alert")).toContainText("Stopped on this device only");
    await open(laptopB);
    await expect(card(laptopB)).toBeVisible();
    await expect(journal(laptopB)).toHaveCount(0);

    // the phone revokes in Settings: a taking back, signed, in the home vault
    await phoneA.goto("/settings");
    await revokeInSettings(phoneA);
    await expect.poll(async () => JSON.parse((await approvals())[0].metadata.approval!.content).approved).toBe(false);
    await open(phoneA);
    await expect(card(phoneA)).toBeVisible();
    await expect(journal(phoneA)).toHaveCount(0);
  } finally {
    await phoneA.context().close(); await laptopB.context().close();
    for (const r of await approvals()) await api(hubState(), "DELETE", `notes/${r.id}`).catch(() => {});
    await api(hubState(), "DELETE", `notes/${made.id}`).catch(() => {});
  }
});

// Found in review (T-476): what an applet saved (a draft) stayed on a device after the person revoked the applet. A
// taking back read from another device removes it here too; a change of code alone never does.
test("a taking back read from another device removes what the applet saved here; changed code keeps it", async ({ browser }) => {
  test.setTimeout(120_000);
  const me = newKey();
  const made = await record(hubState(), "create", appletRecord("journal"));
  only = made.id;
  const base = String((await api(hubState(), "GET", `notes/${made.id}`)).content);
  const setCode = async (src: string) => { const n = await api(hubState(), "GET", `notes/${made.id}`); await api(hubState(), "PATCH", `notes/${made.id}`, { content: src, if_updated_at: n.updatedAt }); };
  const phoneA = await device(browser, me), laptopB = await device(browser, me);
  const draft = `Half a line on the laptop ${Date.now().toString(36)}`;
  const box = (p: Page) => p.frameLocator("iframe.applet-frame").getByLabel("Write in your journal");
  const onLaptop = () => laptopB.evaluate((d) => Object.keys(localStorage).some((k) => (localStorage.getItem(k) ?? "").includes(d)), draft);
  try {
    await open(phoneA);
    await phoneA.getByRole("button", { name: "Allow" }).click();
    await expect(journal(phoneA)).toBeVisible();
    await open(laptopB);
    await box(laptopB).fill(draft);
    await expect.poll(onLaptop).toBe(true);

    // the phone approves a newer version, then the first is put back in the vault: the laptop asks again (the newest
    // approval is of other code), and the draft is still there after its Allow
    await setCode(`${base}\n// v2\n`);
    await open(phoneA);
    await phoneA.getByRole("button", { name: "Allow this version" }).click();
    await expect(journal(phoneA)).toBeVisible();
    await setCode(base);
    await open(laptopB);
    await expect(card(laptopB)).toBeVisible();
    expect(await onLaptop()).toBe(true);
    await laptopB.getByRole("button", { name: /^Allow/ }).click();
    await expect(box(laptopB)).toHaveValue(draft);

    // the phone revokes it: read on the laptop, it stops there and what it saved there is gone
    await open(phoneA);
    await expect(journal(phoneA)).toBeVisible();
    await fromAppletMenu(phoneA, "Revoke");
    await expect.poll(async () => JSON.parse((await approvals())[0].metadata.approval!.content).approved).toBe(false);
    await open(laptopB);
    await expect(card(laptopB)).toBeVisible();
    await expect.poll(onLaptop).toBe(false);
  } finally {
    await phoneA.context().close(); await laptopB.context().close();
    for (const r of await approvals()) await api(hubState(), "DELETE", `notes/${r.id}`).catch(() => {});
    await api(hubState(), "DELETE", `notes/${made.id}`).catch(() => {});
  }
});
