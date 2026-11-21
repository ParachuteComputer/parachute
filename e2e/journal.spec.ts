// Journal (applets/journal.tsx): the Uni app's journal as an applet on its own vault. A line written is a note in
// Journal/YYYY/MM-DD/HH-MM <first words>, tagged journal, that the vault (and the Uni app) reads; entries already there
// show by day, a voice entry's transcript among them.
import { expect, test } from "@playwright/test";
import { api, hubState, record, VAULT } from "./hub";
import { ui } from "./helpers";
import { appletRecord } from "../applets/record.ts";

test.use({ storageState: "e2e/.signed-in.json" });

test("journal: a line becomes a dated journal note; the days show, voice entries with them", async ({ page }) => {
  const stamp = Date.now().toString(36);
  const made: string[] = [];
  const note = await record(hubState(), "create", appletRecord("journal"));
  made.push(note.id);
  const older = await api(hubState(), "POST", "notes", { path: `Journal/2026/11-02/07-15 Walked by the river ${stamp}`, tags: ["journal"], content: `Walked by the river ${stamp}. The herons were out.`, metadata: { source: "voice", client: "uni-app" } });
  made.push(older.id);
  try {
    await page.goto(`/v/${VAULT}?with=vault`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Journal/ }).click();
    const card = page.getByRole("region", { name: /asking for access/ });
    await expect(card).toContainText("Read, add and change notes in Journal/"); // change: a voice entry's recording is attached to it
    await page.getByRole("button", { name: "Allow" }).click();
    const app = page.frameLocator("iframe.applet-frame");
    await expect(app.getByRole("heading", { name: "Journal" })).toBeVisible();
    await expect(app.getByText(`Walked by the river ${stamp}. The herons were out.`)).toBeVisible();
    await expect(app.getByRole("article", { name: /Entry at/ }).filter({ hasText: "herons" })).toContainText("voice");

    await app.getByLabel("Write in your journal").fill(`Planted garlic ${stamp}. The north bed is full.`);
    await app.getByRole("button", { name: "Save" }).click();
    await expect(app.getByRole("heading", { name: "Today" })).toBeVisible();
    await expect(app.getByText(`Planted garlic ${stamp}. The north bed is full.`)).toBeVisible();
    // in the vault: where the Uni app keeps its journal, tagged journal
    const rows = await api(hubState(), "GET", `notes?path_prefix=${encodeURIComponent("Journal/")}&include_content=true&limit=50`) as { id: string; path: string; tags?: string[]; content?: string }[];
    const mine = rows.find((r) => r.content?.includes(`Planted garlic ${stamp}. The north`));
    // named by its first sentence when that is shorter than six words, so a title never stops mid-phrase
    if (mine) made.push(mine.id);
    expect(mine?.path).toMatch(new RegExp(`^Journal/\\d{4}/\\d{2}-\\d{2}/\\d{2}-\\d{2}(-\\d{2})? Planted garlic ${stamp}$`));
    // a question ends a sentence too; an initial or a title doesn't
    for (const [line, name] of [[`How was the walk ${stamp}? Long.`, `How was the walk ${stamp}`], [`Dr. Lee called ${stamp} about it.`, `Dr. Lee called ${stamp} about it`]]) {
      await app.getByLabel("Write in your journal").fill(line);
      await app.getByRole("button", { name: "Save" }).click();
      await expect(app.getByText(line)).toBeVisible();
      const all = await api(hubState(), "GET", `notes?path_prefix=${encodeURIComponent("Journal/")}&include_content=true&limit=50`) as { id: string; path: string; content?: string }[];
      const it = all.find((r) => r.content === line);
      if (it) made.push(it.id);
      expect(it?.path.replace(/^Journal\/\d{4}\/\d{2}-\d{2}\/\d{2}-\d{2}(-\d{2})? /, "")).toBe(name);
    }
    expect(mine?.tags).toContain("journal");

    // an entry opened from elsewhere (a note link, the vault's list) is shown, not just the list it is somewhere in
    await page.goto(`/v/${VAULT}?with=vault`);
    await ui(page).getByRole("list", { name: /Notes|Search results/ }).getByRole("link", { name: new RegExp(`Walked by the river ${stamp}`) }).click();
    const opened = page.frameLocator("iframe.applet-frame").getByRole("region", { name: "The entry you opened" });
    await expect(opened).toContainText("The herons were out.");
    await opened.getByRole("button", { name: "Close" }).click();
    await expect(opened).toHaveCount(0);
  } finally { for (const id of made) await api(hubState(), "DELETE", `notes/${id}`).catch(() => {}); }
});

test("journal offline: a line the vault doesn't take waits on the device, and goes in under its own time when Journal is back", async ({ page }) => {
  test.setTimeout(90_000);
  const stamp = Date.now().toString(36);
  const note = await record(hubState(), "create", appletRecord("journal"));
  const made: string[] = [note.id];
  const hub = new URL(hubState().origin);
  // the vault takes no writes (the phone is somewhere without a connection): reads still answer
  const offline = (u: URL) => u.host === hub.host && u.pathname.includes(`/vault/${VAULT}/`);
  await page.route(offline, (r) => (r.request().method() === "GET" ? r.continue() : r.abort("internetdisconnected")));
  try {
    await page.goto(`/v/${VAULT}?with=vault`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Journal/ }).click();
    await page.getByRole("button", { name: "Allow" }).click();
    const app = page.frameLocator("iframe.applet-frame");
    await expect(app.getByRole("heading", { name: "Journal" })).toBeVisible();
    const written = new Date();
    await app.getByLabel("Write in your journal").fill(`Rain on the roof ${stamp}. Stayed in.`);
    await app.getByRole("button", { name: "Save" }).click();
    await expect(app.getByRole("status").filter({ hasText: "Kept on this device" })).toBeVisible();
    const waiting = app.getByRole("region", { name: "Waiting to be saved" });
    await expect(waiting).toContainText(`Rain on the roof ${stamp}`);
    await expect(app.getByLabel("Write in your journal")).toHaveValue("");
    const inVault = async () => ((await api(hubState(), "GET", `notes?path_prefix=${encodeURIComponent("Journal/")}&include_content=true&limit=100`)) as { id: string; path: string; content?: string }[])
      .find((r) => r.path.endsWith(`Rain on the roof ${stamp}`) || !!r.content?.includes(`Rain on the roof ${stamp}`));
    expect(await inVault()).toBeUndefined();

    // the connection is back; Journal opened again: the line goes in, under the minute it was written
    await page.unroute(offline);
    await page.reload();
    // a start after a reload asks once to open it (an applet doesn't start by itself after the app restarts)
    await page.getByRole("button", { name: "Open Journal" }).click();
    await expect(app.getByRole("article", { name: /Entry at/ }).filter({ hasText: `Rain on the roof ${stamp}. Stayed in.` })).toBeVisible({ timeout: 30_000 });
    await expect(app.getByLabel("Write in your journal")).toHaveValue("");
    await expect(waiting).toHaveCount(0);
    await expect.poll(async () => !!(await inVault()), { timeout: 15_000 }).toBe(true);
    const saved = await inVault();
    if (saved) made.push(saved.id);
    const hhmm = `${String(written.getHours()).padStart(2, "0")}-${String(written.getMinutes()).padStart(2, "0")}`;
    expect(saved?.path).toMatch(new RegExp(`^Journal/\\d{4}/\\d{2}-\\d{2}/${hhmm}(-\\d{2})? Rain on the roof ${stamp}$`));
  } finally {
    await page.unroute(offline).catch(() => {});
    for (const id of made) await api(hubState(), "DELETE", `notes/${id}`).catch(() => {});
  }
});
