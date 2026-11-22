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

test("journal offline: lines the vault can't take wait on the device in order and go in under their own time; a lost answer isn't saved twice", async ({ page }) => {
  test.setTimeout(120_000);
  const stamp = Date.now().toString(36);
  const note = await record(hubState(), "create", appletRecord("journal"));
  const made: string[] = [note.id];
  const hub = new URL(hubState().origin);
  const writes = (u: URL) => u.host === hub.host && u.pathname.includes(`/vault/${VAULT}/`);
  // what the vault does with a write: "down" (no connection), "lose" (it lands, the answer is lost), "ok"
  let mode: "down" | "lose" | "ok" = "ok";
  await page.route(writes, async (r) => {
    if (r.request().method() === "GET" || mode === "ok") return r.continue();
    if (mode === "down") return r.abort("internetdisconnected");
    await r.fetch();
    mode = "ok";
    return r.abort("connectionreset");
  });
  const entries = async () => ((await api(hubState(), "GET", `notes?path_prefix=${encodeURIComponent("Journal/")}&include_content=true&limit=200`)) as { id: string; path: string; content?: string }[])
    .filter((r) => r.path.includes(stamp) || !!r.content?.includes(stamp));
  const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}-${String(d.getMinutes()).padStart(2, "0")}`;
  try {
    await page.goto(`/v/${VAULT}?with=vault`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Journal/ }).click();
    await page.getByRole("button", { name: "Allow" }).click();
    const app = page.frameLocator("iframe.applet-frame");
    const box = app.getByLabel("Write in your journal");
    const waiting = app.getByRole("region", { name: "Waiting to be saved" });
    await expect(app.getByRole("heading", { name: "Journal" })).toBeVisible();

    // no connection: the line waits, the box clears, the vault has none; kept across a restart of the app
    mode = "down";
    const first = new Date();
    await box.fill(`Rain on the roof ${stamp}. Stayed in.`);
    await app.getByRole("button", { name: "Save" }).click();
    await expect(app.getByRole("status").filter({ hasText: "Kept on this device" })).toBeVisible();
    await expect(waiting).toContainText(`Rain on the roof ${stamp}`);
    await expect(box).toHaveValue("");
    // on the device's disk (the shell writes what the applet saved when its message comes; a browser keeps it in
    // localStorage), then the app restarts
    await expect.poll(() => page.evaluate((t) => Object.keys(localStorage).some((k) => {
      try { const v = JSON.parse(localStorage.getItem(k) ?? "null"); return Array.isArray(v?.outbox) && v.outbox.some((x: { body?: string }) => x.body?.includes(t)); } catch { return false; }
    }), `Rain on the roof ${stamp}`)).toBe(true);
    await page.reload();
    await page.getByRole("button", { name: "Open Journal" }).click();
    await expect(waiting).toContainText(`Rain on the roof ${stamp}`);
    // a second line queues behind it; Try now while still offline says so
    await box.fill(`Soup for dinner ${stamp}.`);
    await app.getByRole("button", { name: "Save" }).click();
    await expect(waiting.getByRole("listitem")).toHaveCount(2);
    await waiting.getByRole("button", { name: "Try now" }).click();
    await expect(app.getByRole("status").filter({ hasText: "Still can't reach your vault" })).toBeVisible();
    expect(await entries()).toHaveLength(0);

    // the connection is back: Try now, with Journal still open; both go in, each under the minute it was written
    mode = "ok";
    await waiting.getByRole("button", { name: "Try now" }).click();
    await expect(waiting).toHaveCount(0);
    await expect(app.getByRole("article", { name: /Entry at/ }).filter({ hasText: `Rain on the roof ${stamp}. Stayed in.` })).toBeVisible();
    await expect.poll(async () => (await entries()).length, { timeout: 15_000 }).toBe(2);
    const got = await entries();
    made.push(...got.map((r) => r.id));
    // the minute it was written (the click may come a moment after the clock was read here: that minute or the next)
    expect(got.find((r) => r.path.includes("Rain"))?.path).toMatch(new RegExp(`^Journal/\\d{4}/\\d{2}-\\d{2}/(${hhmm(first)}|${hhmm(new Date(first.getTime() + 60_000))})(-\\d{2})? Rain on the roof ${stamp}$`));

    // the same words twice in a minute, offline: both wait, and both go in (one under the minute, one with its seconds)
    mode = "down";
    for (let n = 0; n < 2; n++) {
      await box.fill(`Watered the ferns ${stamp}.`);
      await app.getByRole("button", { name: "Save" }).click();
      await expect(box).toHaveValue("");
    }
    await expect(waiting.getByRole("listitem")).toHaveCount(2);
    mode = "ok";
    await waiting.getByRole("button", { name: "Try now" }).click();
    await expect(waiting).toHaveCount(0);
    await expect.poll(async () => (await entries()).filter((r) => r.path.includes("ferns")).length, { timeout: 15_000 }).toBe(2);
    made.push(...(await entries()).filter((r) => r.path.includes("ferns")).map((r) => r.id));

    // the same words twice in a minute, online: two entries (only a line whose own write may have landed counts as sent)
    for (let n = 0; n < 2; n++) {
      await box.fill(`Took the vitamins ${stamp}.`);
      await app.getByRole("button", { name: "Save" }).click();
      await expect(box).toHaveValue("");
    }
    await expect.poll(async () => (await entries()).filter((r) => r.path.includes("vitamins")).length, { timeout: 15_000 }).toBe(2);
    made.push(...(await entries()).filter((r) => r.path.includes("vitamins")).map((r) => r.id));

    // a write that lands but whose answer is lost waits, and when sent again it counts as sent: one note, not two
    mode = "lose";
    await box.fill(`Called the plumber ${stamp}.`);
    await app.getByRole("button", { name: "Save" }).click();
    await expect(waiting).toContainText(`Called the plumber ${stamp}`);
    await waiting.getByRole("button", { name: "Try now" }).click();
    await expect(waiting).toHaveCount(0);
    const plumber = (await entries()).filter((r) => r.path.includes("plumber"));
    made.push(...plumber.map((r) => r.id));
    expect(plumber).toHaveLength(1);
  } finally {
    await page.unroute(writes).catch(() => {});
    for (const id of made) await api(hubState(), "DELETE", `notes/${id}`).catch(() => {});
  }
});
