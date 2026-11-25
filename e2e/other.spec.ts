// Another Parachute in yours (docs/design/EMBED.md, docs/OTHER-PARACHUTES.md), on two real hubs: the person's own
// (kitchen) and Techne's, where their key is a member with read access. Techne's vault is added as someone else's.
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "./test";
import { api, hubState, ORG_VAULT, techneState, VAULT } from "./hub";
import { signInWithKey, ui, vaultRow } from "./helpers";

test.use({ storageState: "e2e/.signed-in.json" });

const NOTICE = readFileSync(new URL("./fixtures/techne/Notice board.tsx", import.meta.url), "utf8");
const org = (method: string, path: string, body?: unknown) => api(techneState(), method, path, body, ORG_VAULT);
const home = (method: string, path: string, body?: unknown) => api(hubState(), method, path, body, VAULT);
const applet = (page: Page) => page.frameLocator("iframe.applet-frame");
const hostOf = (origin: string) => new URL(origin).host;
/** One note from a notes query by id (an array on one hub version, the note itself on another). */
const one = (x: unknown) => (Array.isArray(x) ? x[0] : x) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Techne's notice board applet and one notice, written on Techne's hub; removed after. */
async function withNoticeBoard(run: (id: string) => Promise<void>) {
  const notice = await org("POST", "notes", { path: "Notices/Potluck on Friday", content: "Bring a dish." });
  const board = await org("POST", "notes", { path: "Applets/Notice board", extension: "tsx", content: NOTICE, tags: ["applet"],
    metadata: { applet: { contract: 2, id: "notice-board", name: "Notice board", glyph: "✎", access: [{ vault: "here", allow: [{ path: "Notices/", verbs: ["read"] }] }] }, app: ["recent"] } });
  try { await run(board.id); } finally {
    for (const p of await home("GET", "notes?tag=parachute-pointer")) await home("DELETE", `notes/${p.id}`);
    await org("DELETE", `notes/${board.id}`); await org("DELETE", `notes/${notice.id}`);
  }
}

/** In the list (one list, not by vault): Techne's own Notice board says whose it is; the one brought in says where from. */
const theirs = (page: Page) => ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Notice board/ }).filter({ hasText: `${ORG_VAULT} · someone else's` });
const brought = (page: Page) => ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Notice board/ }).filter({ hasText: `from ${ORG_VAULT}` });

test("the org's vault, added with the person's key as someone else's, is marked whose it is in Settings", async ({ page }) => {
  await signInWithKey(page, techneState(), ORG_VAULT);
  // Settings says whose each vault is, and offers only the person's own vault as home
  await page.goto("/settings");
  await vaultRow(page, ORG_VAULT);
  await expect(page.getByRole("combobox", { name: `Whose ${ORG_VAULT} is` })).toHaveValue("theirs");
  await vaultRow(page, VAULT);
  await expect(page.getByRole("combobox", { name: `Whose ${VAULT} is` })).toHaveValue("mine");
  // (the home choice names each vault, and where it is only when the person's own span more than one Parachute)
  await expect(page.getByRole("radio", { name: new RegExp(`^${VAULT}\\b`) })).toBeChecked();
  await expect(page.getByRole("radio", { name: new RegExp(`^${ORG_VAULT}\\b`) })).toHaveCount(0);
});

test("an applet brought in from Techne: a pointer in the home vault, its card says whose, it reads only Techne, and a change upstream asks again", async ({ page }) => {
  await signInWithKey(page, techneState(), ORG_VAULT);
  await withNoticeBoard(async (id) => {
    await page.goto("/");
    // long-press (a right-click) on Techne's applet: bring it in; open on start isn't offered for someone else's code
    await theirs(page).click({ button: "right" });
    const sheet = ui(page).getByRole("dialog", { name: "Notice board" });
    await expect(sheet.getByRole("button", { name: "Open on start" })).toHaveCount(0);
    await sheet.getByRole("button", { name: "Bring into my Parachute" }).click();
    await expect(sheet).toHaveCount(0);
    // the pointer, in the home vault, pinned to the code as it was
    const [pointer] = await home("GET", "notes?tag=parachute-pointer&include_metadata=true");
    expect(pointer.path).toBe(`Parachute/From/${hostOf(techneState().origin).replace(/[^A-Za-z0-9.-]/g, "-")}/${ORG_VAULT}/applet-notice-board`);
    expect(pointer.metadata.pointer).toMatchObject({ hub: techneState().origin, vault: ORG_VAULT, record: id, kind: "applet", id: "notice-board", name: "Notice board" });
    const pinned = pointer.metadata.pointer.code as string;
    expect(pinned).toMatch(/^tsx:[0-9a-f]{64}$/);

    // it sits among the home's own applets, saying where it is from
    await expect(brought(page)).toContainText(`from ${ORG_VAULT} · at ${new URL(techneState().origin).hostname}`);
    await brought(page).click();
    await expect(page.getByRole("heading", { name: /Notice board · techne's/ })).toBeVisible();
    const card = page.getByRole("region", { name: /asking for access/ });
    await expect(card).toContainText(`In the ${ORG_VAULT} vault (someone else's, at ${new URL(techneState().origin).hostname})`);
    await expect(card).toContainText("It acts as you in techne, with your sign-in there. It sees nothing in your own vaults.");
    // it asked for the person's recent notes; someone else's applet is never given that, so the card doesn't offer it
    await expect(card).not.toContainText("newest notes in every vault");
    await page.getByRole("button", { name: "Allow" }).click();
    await expect(applet(page).getByRole("heading", { name: "Notice board" })).toBeVisible();
    await expect(applet(page).getByText("Potluck on Friday")).toBeVisible();
    await expect(applet(page).getByText("recent: refused (not_granted)")).toBeVisible();

    // Techne changes it: the card comes back, headed so, and nothing runs until Allow, which re-pins the pointer
    const cur = one(await org("GET", `notes?id=${id}`));
    await org("PATCH", `notes/${id}`, { content: NOTICE.replace("<h1>Notice board</h1>", "<h1>Notice board, new</h1>"), if_updated_at: cur.updatedAt });
    await page.goto("/");
    await brought(page).click();
    await expect(page.getByText("techne changed «Notice board» since you brought it in")).toBeVisible();
    await expect(page.locator("iframe.applet-frame")).toHaveCount(0);
    await page.getByRole("button", { name: "Allow this version" }).click();
    await expect(applet(page).getByRole("heading", { name: "Notice board, new" })).toBeVisible();
    await expect.poll(async () => one(await home("GET", `notes?id=${pointer.id}&include_metadata=true`)).metadata.pointer.code).not.toBe(pinned);
  });
});
