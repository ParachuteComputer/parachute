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
    expect(mine?.path).toMatch(new RegExp(`^Journal/\\d{4}/\\d{2}-\\d{2}/\\d{2}-\\d{2}(-\\d{2})? Planted garlic ${stamp}$`));
    if (mine) made.push(mine.id);
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
