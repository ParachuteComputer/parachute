// The starter template (applets/starter.json + starter.tsx, docs/WRITE-AN-APPLET.md) is what a person copies to build
// their first applet: it must run as shipped. In the sealed frame against a real hub: Allow, add a note (it lands in
// Notes/ with the type it opens), open it, edit (the edit survives a reload) and save it (the write carries
// if_updated_at), and the hub has it; the app's Back closes an open note, and an edit in progress survives it.
import { expect, test } from "@playwright/test";
import { appletRecord } from "../applets/record.ts";
import { api, hubState, VAULT } from "./hub";

test.use({ storageState: "e2e/.signed-in.json" });

test("the starter applet runs as shipped: lists, adds, opens, edits and saves a note in its folder", async ({ page }) => {
  const r = appletRecord("starter");
  const applet = await api(hubState(), "POST", "notes", { path: r.path, extension: r.extension, tags: r.tags, content: r.body, metadata: r.fields });
  let added: { id: string; tags: string[] } | null = null;
  try {
    await page.goto(`/v/${VAULT}/a/${applet.id}`);
    await expect(page.getByRole("region", { name: /asking for access/ })).toContainText("Notes/");
    await page.getByRole("button", { name: "Allow" }).click();
    const f = page.frameLocator("iframe.applet-frame");
    await expect(f.getByRole("heading", { name: "Starter" })).toBeVisible();
    await f.getByRole("textbox", { name: "New note" }).fill("Seed packets to sort");
    await f.getByRole("button", { name: "Add" }).click();
    // added, then opened on its own page
    await expect(f.locator("header").getByRole("heading", { name: "Seed packets to sort" })).toBeVisible();
    added = await api(hubState(), "GET", `notes?id=${encodeURIComponent("Notes/Seed packets to sort")}`);
    expect(added!.tags).toContain("note");
    // its name is its heading; the body starts empty, and says so
    await expect(f.getByText("Nothing written yet. Edit to start.")).toBeVisible();
    await f.getByRole("button", { name: "Edit" }).click();
    // an edit in progress survives the applet closing: kept on the device, back in the box when it opens again
    await f.getByRole("textbox", { name: "Note" }).fill("Beans, chard");
    await expect.poll(() => page.evaluate(() => Object.values(localStorage).some((v) => v.includes("Beans, chard")))).toBe(true);
    await page.reload();
    await page.getByRole("button", { name: "Open Starter" }).click();
    await expect(f.getByRole("textbox", { name: "Note" })).toHaveValue("Beans, chard");
    await f.getByRole("textbox", { name: "Note" }).fill("Beans, chard, two kinds of kale.");
    await f.getByRole("button", { name: "Save" }).click();
    await expect(f.getByText("Beans, chard, two kinds of kale.")).toBeVisible();
    const saved = await api(hubState(), "GET", `notes/${added!.id}?include_content=true`);
    expect(saved.content).toContain("two kinds of kale");
    // back to the list: the note is there
    await f.getByRole("button", { name: "← Starter" }).click();
    await expect(f.getByRole("region", { name: /Notes ·/ })).toContainText("Seed packets to sort");
    // the app's own Back closes an open note first, and the person stays in the applet
    const at = page.url();
    await f.getByRole("button", { name: "Seed packets to sort" }).click();
    await expect(f.locator("header").getByRole("heading", { name: "Seed packets to sort" })).toBeVisible();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(f.getByRole("region", { name: /Notes ·/ })).toContainText("Seed packets to sort");
    expect(page.url()).toBe(at);
    // an edit in progress isn't lost to Back: open again, it is there
    await f.getByRole("button", { name: "Seed packets to sort" }).click();
    await f.getByRole("button", { name: "Edit" }).click();
    await f.getByRole("textbox", { name: "Note" }).fill("And basil");
    await page.getByRole("button", { name: "Back", exact: true }).click();
    // the list says which note has an unsaved edit
    await expect(f.getByRole("region", { name: /Notes ·/ }).getByRole("button", { name: /Seed packets to sort/ })).toContainText("Unsaved edit");
    // an edit of another note keeps its own: one each
    await f.getByRole("textbox", { name: "New note" }).fill("Tomato starts");
    await f.getByRole("button", { name: "Add" }).click();
    await f.getByRole("button", { name: "Edit" }).click();
    await f.getByRole("textbox", { name: "Note" }).fill("Six of them");
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await f.getByRole("button", { name: /Seed packets to sort/ }).click();
    await expect(f.getByRole("textbox", { name: "Note" })).toHaveValue("And basil");
    await f.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await f.getByRole("button", { name: /Tomato starts/ }).click();
    await expect(f.getByRole("textbox", { name: "Note" })).toHaveValue("Six of them");
  } finally {
    // by path, so a note added before a failed step goes too
    const left = added ?? await api(hubState(), "GET", `notes?id=${encodeURIComponent("Notes/Seed packets to sort")}`).catch(() => null);
    if (left) await api(hubState(), "DELETE", `notes/${left.id}`).catch(() => {});
    const second = await api(hubState(), "GET", `notes?id=${encodeURIComponent("Notes/Tomato starts")}`).catch(() => null);
    if (second?.id) await api(hubState(), "DELETE", `notes/${second.id}`).catch(() => {});
    await api(hubState(), "DELETE", `notes/${applet.id}`).catch(() => {});
  }
});
