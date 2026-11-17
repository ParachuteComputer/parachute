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
    await page.goto(`/v/${VAULT}`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Journal/ }).click();
    const card = page.getByRole("region", { name: /asking for access/ });
    await expect(card).toContainText("Read, add and change notes in Journal/"); // change: a voice entry's recording is attached to it
    await page.getByRole("button", { name: "Allow" }).click();
    const app = page.frameLocator("iframe.applet-frame");
    await expect(app.getByRole("heading", { name: "Journal" })).toBeVisible();
    await expect(app.getByText(`Walked by the river ${stamp}. The herons were out.`)).toBeVisible();
    await expect(app.getByRole("article", { name: /Entry at/ }).filter({ hasText: "herons" })).toContainText("voice");

    await app.getByLabel("Write in your journal").fill(`Planted garlic in the north bed ${stamp}`);
    await app.getByRole("button", { name: "Save" }).click();
    await expect(app.getByRole("heading", { name: "Today" })).toBeVisible();
    await expect(app.getByText(`Planted garlic in the north bed ${stamp}`)).toBeVisible();
    // in the vault: where the Uni app keeps its journal, tagged journal
    const rows = await api(hubState(), "GET", `notes?path_prefix=${encodeURIComponent("Journal/")}&include_content=true&limit=50`) as { id: string; path: string; tags?: string[]; content?: string }[];
    const mine = rows.find((r) => r.content?.includes(`north bed ${stamp}`));
    expect(mine?.path).toMatch(new RegExp(`^Journal/\\d{4}/\\d{2}-\\d{2}/\\d{2}-\\d{2} Planted garlic in the north bed`));
    expect(mine?.tags).toContain("journal");
    if (mine) made.push(mine.id);
  } finally { for (const id of made) await api(hubState(), "DELETE", `notes/${id}`).catch(() => {}); }
});
