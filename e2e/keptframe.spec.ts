// The list of applets (the frame, src/shell/FrameArea.tsx) kept while the person is in an applet or Settings, as applets
// are (kept.tsx): back to it is the same running frame, its list drawn at once, not a new frame booted and read again.
// Aaron, 11-22: "The applets page re loads every time, doesn't seem to cache."
import { expect, test, type Page } from "@playwright/test";
import { api, hubState, record, VAULT } from "./hub";
import { ui } from "./helpers";

test.use({ storageState: "e2e/.signed-in.json" });

const CODE = `export default function Here() { return <main><h1>Here</h1></main>; }\n`;
const ARGS = { path: "Applets/Here", extension: "tsx", tags: ["applet"], body: CODE,
  fields: { applet: { contract: 2, id: "here", name: "Here", glyph: "◇", note: "a test applet", access: [] } } };

/** The frame's own window (a srcdoc frame: its window, not its element, says whether it booted again). */
const frameWindow = async (page: Page) => {
  for (const f of page.frames()) {
    if (f.parentFrame() !== page.mainFrame()) continue;
    const el = await f.frameElement();
    if (await el.evaluate((e) => (e as Element).classList.contains("app-frame"))) return f;
  }
  return null;
};

type Heard = { __booted?: number; __heard?: string[] };

test("back to the list of applets from an applet, from Settings and by the bar is the same frame, booted once, never told a shell screen's address", async ({ page }) => {
  const note = await record(hubState(), "create", ARGS);
  let added: { id: string } | null = null;
  try {
    await page.goto(`/v/${VAULT}?with=vault`);
    const list = ui(page).getByRole("list", { name: "Applets" });
    const chip = list.getByRole("link", { name: /Here/ });
    await expect(chip).toBeVisible();
    // a mark in the frame's own window (a frame booted again has none), and what the shell tells it from now on
    await (await frameWindow(page))!.evaluate(() => {
      const w = window as unknown as Heard;
      w.__booted = 1; w.__heard = [];
      addEventListener("message", (e) => { const d = e.data as { event?: string; data?: unknown }; if (d?.event === "location") w.__heard!.push((d.data as { pathname: string }).pathname); if (d?.event === "shown") w.__heard!.push(`shown ${String(d.data)}`); });
    });
    const same = async () => (await (await frameWindow(page))!.evaluate(() => { const w = window as unknown as Heard; return { booted: w.__booted, heard: w.__heard }; }));

    await chip.click();
    await page.getByRole("button", { name: "Allow" }).click();
    await expect(page.frameLocator("iframe.applet-frame:visible").getByRole("heading", { name: "Here" })).toBeVisible();
    // hidden while the applet shows: there, but drawn nowhere
    await expect(page.locator("iframe.app-frame")).toBeHidden();

    // back: the same window, its list there
    await page.goBack();
    await expect(chip).toBeVisible();
    expect((await same()).booted).toBe(1);

    // Settings, where an applet is added meanwhile (by an agent, say), and back: the same frame, and the new one listed
    await ui(page).getByRole("link", { name: "Settings" }).click();
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
    added = await record(hubState(), "create", { ...ARGS, path: "Applets/Also here", body: CODE.replace("Here", "Also here"), fields: { applet: { ...ARGS.fields.applet, id: "also-here", name: "Also here", glyph: "◆" } } });
    await page.goBack();
    await expect(list.getByRole("link", { name: /Also here/ })).toBeVisible();
    expect((await same()).booted).toBe(1);

    // to the applet by its chip, and back by the bar's Applets: the same
    await chip.click();
    await expect(page.frameLocator("iframe.applet-frame:visible").getByRole("heading", { name: "Here" })).toBeVisible();
    await page.getByRole("navigation", { name: "Bar" }).getByRole("link", { name: "Applets" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(ui(page).getByRole("list", { name: "Applets" }).first()).toBeVisible();
    const { booted, heard } = await same();
    expect(booted).toBe(1);
    // told it was hidden and shown each time, and only the frame's own addresses: never the applet's or Settings'
    expect(heard!.filter((x) => x.startsWith("/")).every((x) => x === "/" || x === `/v/${VAULT}`)).toBe(true);
    expect(heard!.filter((x) => x.startsWith("shown"))).toEqual(["shown false", "shown true", "shown false", "shown true", "shown false", "shown true"]);
  } finally {
    await api(hubState(), "DELETE", `notes/${note.id}`);
    if (added) await api(hubState(), "DELETE", `notes/${added.id}`);
  }
});

// Review finding (T-476, #160): kept, the frame's note page must read the note again when shown after the shell's editor.
test("a note edited in the app's editor shows its new words on Back, in the same frame", async ({ page }) => {
  const note = await record(hubState(), "create", { path: "Notes/Kept words", extension: "md", body: "The old words." });
  try {
    await page.goto(`/v/${VAULT}/n/${note.id}?with=vault`);
    await expect(ui(page).getByText("The old words.")).toBeVisible();
    await (await frameWindow(page))!.evaluate(() => { (window as unknown as Heard).__booted = 1; });
    await ui(page).getByRole("link", { name: "Edit" }).click();
    const box = page.getByRole("textbox", { name: "The note's words" });
    await expect(box).toHaveValue("The old words.");
    await box.fill("The new words.");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(ui(page).getByText("The new words.")).toBeVisible();
    await expect(ui(page).getByText("The old words.")).toHaveCount(0);
    expect(await (await frameWindow(page))!.evaluate(() => (window as unknown as Heard).__booted)).toBe(1);
  } finally {
    await api(hubState(), "DELETE", `notes/${note.id}`);
  }
});
