// The starter template (applets/starter.json + starter.tsx, docs/WRITE-AN-APPLET.md) is what a person copies to build
// their first applet: it must run as shipped. In the sealed frame against a real hub: Allow, add a note (it lands in
// Notes/ with the type it opens), open it, edit (the edit survives a reload) and save it (the write carries
// if_updated_at), and the hub has it; the app's Back closes an open note, and an edit in progress survives it.
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "./test";
import { appletRecord } from "../applets/record.ts";
import { api, hubState, VAULT } from "./hub";

test.use({ storageState: "e2e/.signed-in.json" });
const shot = (page: Page, name: string) => (process.env.WALKTHROUGH_DIR ? page.screenshot({ path: `${process.env.WALKTHROUGH_DIR}/${name}.png` }) : Promise.resolve());

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
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await f.getByRole("button", { name: /Tomato starts/ }).click();
    await expect(f.getByRole("textbox", { name: "Note" })).toHaveValue("Six of them");
    // a note deleted elsewhere takes the edit kept for it: none piles up in the saved store
    await page.getByRole("button", { name: "Back", exact: true }).click();
    const tomato = await api(hubState(), "GET", `notes?id=${encodeURIComponent("Notes/Tomato starts")}`);
    await api(hubState(), "DELETE", `notes/${(Array.isArray(tomato) ? tomato[0] : tomato).id}`);
    // opened again later, the list no longer has it: its edit is dropped, Seed's stays (once the closed note is kept as
    // closed on the device: the app keeps what an applet saved a moment after it changes)
    await expect.poll(() => page.evaluate(() => Object.values(localStorage).some((v) => v.includes('"selected":')))).toBe(false);
    await page.reload();
    await page.getByRole("button", { name: "Open Starter" }).click();
    await expect(f.getByRole("region", { name: /Notes ·/ }).getByRole("button", { name: /Seed packets to sort/ })).toContainText("Unsaved edit");
    await expect.poll(() => page.evaluate(() => Object.values(localStorage).some((v) => v.includes("Six of them"))), { timeout: 15_000 }).toBe(false);
    expect(await page.evaluate(() => Object.values(localStorage).some((v) => v.includes("And basil")))).toBe(true);
  } finally {
    // by path, so a note added before a failed step goes too
    const left = added ?? await api(hubState(), "GET", `notes?id=${encodeURIComponent("Notes/Seed packets to sort")}`).catch(() => null);
    if (left) await api(hubState(), "DELETE", `notes/${left.id}`).catch(() => {});
    const second = await api(hubState(), "GET", `notes?id=${encodeURIComponent("Notes/Tomato starts")}`).catch(() => null);
    if (second?.id) await api(hubState(), "DELETE", `notes/${second.id}`).catch(() => {});
    await api(hubState(), "DELETE", `notes/${applet.id}`).catch(() => {});
  }
});

// Pictures in a folder applet (docs/design/PICTURES.md): a picture attached to a note in the starter's folder, linked in
// its words, is drawn from its bytes (vault.file, asked by the kit's Note given the note's id). A second note that links
// the same picture without it attached shows its name, until vault.attachFrom attaches it there too (no new bytes).
test("the starter draws a picture attached to its note, and attaches it to a second note that shows it", async ({ page }) => {
  const r = appletRecord("starter");
  const h = hubState();
  const applet = await api(h, "POST", "notes", { path: r.path, extension: r.extension, tags: r.tags, content: r.body, metadata: r.fields });
  const made: string[] = [];
  try {
    const form = new FormData();
    form.append("file", new Blob([readFileSync(new URL("./fixtures/seedlings.png", import.meta.url))], { type: "image/png" }), "seedlings.png");
    const up = await fetch(`${h.origin}/vault/${VAULT}/api/storage/upload`, { method: "POST", headers: { authorization: `Bearer ${h.token}` }, body: form });
    expect(up.status).toBeLessThan(300);
    const stored = String(((await up.json()) as { path: string }).path).replace(/^\/?(api\/storage\/)?/, "");
    const words = `Sown on the sill.\n\n![seedlings on the sill](/api/storage/${stored})\n\nWater every other day.`;
    const owl = await api(h, "POST", "notes", { path: "Notes/Seedlings", content: words, tags: ["note"] });
    made.push(owl.id);
    await api(h, "POST", `notes/${owl.id}/attachments`, { path: stored, mimeType: "image/png" });
    const again = await api(h, "POST", "notes", { path: "Notes/Seedlings again", content: words, tags: ["note"] });
    made.push(again.id);

    await page.goto(`/v/${VAULT}/a/${applet.id}`);
    await page.getByRole("button", { name: "Allow" }).click();
    const f = page.frameLocator("iframe.applet-frame");
    await f.getByRole("button", { name: /^Seedlings \d/ }).click();
    const pic = f.getByRole("img", { name: "seedlings on the sill" });
    await expect(pic).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => pic.evaluate((i) => (i as HTMLImageElement).naturalWidth), { timeout: 15_000 }).toBe(48);
    expect(await pic.getAttribute("src")).toMatch(/^blob:/);
    await expect(f.getByText("Water every other day.")).toBeVisible();
    await shot(page, "01-attached");

    // the second note links it but hasn't it attached: its name shows, and nothing is drawn
    await f.getByRole("button", { name: "← Starter" }).click();
    await f.getByRole("button", { name: /^Seedlings again/ }).click();
    await expect(f.getByText("Water every other day.")).toBeVisible();
    await expect(f.getByText(/seedlings on the sill: not attached to this record/)).toBeVisible();
    await expect(f.locator("img")).toHaveCount(0);
    await shot(page, "02-not-attached");
    // attached there too, from the note it is attached to: the same stored file, no new bytes
    const frame = await page.locator("iframe.applet-frame").elementHandle().then((e) => e!.contentFrame());
    const got = await frame!.evaluate(([to, from, src]) => (window as unknown as { parachute: { vault: { attachFrom(a: string, b: string, c: string): Promise<{ path: string }> } } }).parachute.vault.attachFrom(to, from, src),
      [again.id, owl.id, `/api/storage/${stored}`] as const);
    expect(got.path).toBe(stored);
    const atts = (await api(h, "GET", `notes/${again.id}/attachments`)) as { path: string }[];
    expect(atts.map((a) => a.path)).toEqual([stored]);
    await f.getByRole("button", { name: "← Starter" }).click();
    await f.getByRole("button", { name: /^Seedlings again/ }).click();
    await expect.poll(() => f.getByRole("img", { name: "seedlings on the sill" }).evaluate((i) => (i as HTMLImageElement).naturalWidth), { timeout: 15_000 }).toBe(48);
    await shot(page, "03-attached-there-too");
  } finally {
    for (const id of made) await api(h, "DELETE", `notes/${id}`).catch(() => {});
    await api(h, "DELETE", `notes/${applet.id}`).catch(() => {});
  }
});
