// Saved state (docs/WRITE-AN-APPLET.md "Saved state"): what an applet saves through the kit survives the app closing.
// Journal's entry box and the entry it had open come back in a new page of the same browser profile (the app closed
// and opened again); the draft is in the box before anything is typed, and saving the entry clears it.
import { expect, test } from "@playwright/test";
import { api, hubState, record, VAULT } from "./hub";
import { ui } from "./helpers";
import { appletRecord } from "../applets/record.ts";

test.use({ storageState: "e2e/.signed-in.json" });

test("saved state: a journal draft and the entry it had open survive closing the app", async ({ page, context }) => {
  const stamp = Date.now().toString(36);
  const made: string[] = [];
  const note = await record(hubState(), "create", appletRecord("journal"));
  made.push(note.id);
  const older = await api(hubState(), "POST", "notes", { path: `Journal/2026/11-03/08-00 Frost on the beds ${stamp}`, tags: ["journal"], content: `Frost on the beds ${stamp}.` });
  made.push(older.id);
  try {
    await page.goto(`/v/${VAULT}`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Journal/ }).click();
    await page.getByRole("button", { name: "Allow" }).click();
    const app = page.frameLocator("iframe.applet-frame");
    await expect(app.getByRole("heading", { name: "Journal" })).toBeVisible();
    await app.getByLabel("Write in your journal").fill(`Half a thought about the orchard ${stamp}`);
    // the kit sends a change within 250 ms; a page torn down sooner than that loses that last moment
    await page.waitForTimeout(500);
    // open an entry from the vault: it is shown under the box
    await page.goto(`/v/${VAULT}`);
    await ui(page).getByRole("list", { name: /Notes|Search results/ }).getByRole("link", { name: new RegExp(`Frost on the beds ${stamp}`) }).click();
    await expect(page.frameLocator("iframe.applet-frame").getByRole("region", { name: "The entry you opened" })).toContainText(`Frost on the beds ${stamp}`);
    await page.waitForTimeout(600);

    // the app closes (this page goes) and opens again
    await page.close();
    const again = await context.newPage();
    await again.goto(`/v/${VAULT}/a/${note.id}`);
    // a start by address waits for a tap (start.ts); nothing typed since
    await again.getByRole("button", { name: "Open Journal" }).click();
    const app2 = again.frameLocator("iframe.applet-frame");
    await expect(app2.getByLabel("Write in your journal")).toHaveValue(`Half a thought about the orchard ${stamp}`);
    await expect(app2.getByRole("region", { name: "The entry you opened" })).toContainText(`Frost on the beds ${stamp}`);

    // saved, the entry is a note and the draft is gone, also after the next start
    await app2.getByRole("button", { name: "Save" }).click();
    await expect(app2.getByLabel("Write in your journal")).toHaveValue("");
    await app2.getByRole("region", { name: "The entry you opened" }).getByRole("button", { name: "Close" }).click();
    await again.waitForTimeout(600);
    await again.reload();
    await again.getByRole("button", { name: "Open Journal" }).click();
    const app3 = again.frameLocator("iframe.applet-frame");
    await expect(app3.getByRole("heading", { name: "Journal" })).toBeVisible();
    await expect(app3.getByText(`Half a thought about the orchard ${stamp}`)).toBeVisible();
    await expect(app3.getByLabel("Write in your journal")).toHaveValue("");
    await expect(app3.getByRole("region", { name: "The entry you opened" })).toHaveCount(0);
    const rows = await api(hubState(), "GET", `notes?path_prefix=${encodeURIComponent("Journal/")}&include_content=true&limit=50`) as { id: string; content?: string }[];
    for (const r of rows) if (r.content?.includes(`orchard ${stamp}`)) made.push(r.id);
  } finally { for (const id of made) await api(hubState(), "DELETE", `notes/${id}`).catch(() => {}); }
});
