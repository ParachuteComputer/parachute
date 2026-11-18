// The simple app (docs/SIMPLE.md), as a person whose settings choose it signs in on a new device: they land on Notes,
// find a note, change it, write a new one, copy a vault's connector address, add Capture and capture a line into
// Inbox/. Against the real hub: what the app writes is read back there.
import { expect, test } from "@playwright/test";
import { signIn, ui } from "./helpers";
import { api, hubState, VAULT } from "./hub";

type Row = { id: string; path: string; content?: string; tags?: string[] };

test("simple app: sign in → Notes → find, edit and write a note → Connect → Capture a line", async ({ page, context }) => {
  const hub = hubState();
  const stamp = Date.now().toString(36);
  const made: string[] = [];
  // the person's settings say simple (a Cloud person's first sign-in writes it; here their agent did)
  const settings = await api(hub, "POST", "notes", { path: "Parachute/Settings", tags: ["parachute-settings"], content: "settings", metadata: { parachute: { app: "simple" } } }) as Row;
  made.push(settings.id);
  const note = await api(hub, "POST", "notes", { path: `Garden plan ${stamp}`, content: `# Garden plan ${stamp}\n\nKale in the north bed.` }) as Row;
  made.push(note.id);
  // more captures than Capture lists (12): the newest must still show
  for (let i = 0; i < 13; i++) made.push((await api(hub, "POST", "notes", { path: `Inbox/2026-01-${String(i + 1).padStart(2, "0")} 09-00 old line ${i} ${stamp}`, content: `old line ${i}` }) as Row).id);
  try {
    await signIn(page);
    // Notes: every vault's newest notes in one list, the vaults as tabs; the bar says Notes, Capture, Connect
    await expect(ui(page).getByRole("heading", { level: 1, name: "Notes" })).toBeVisible();
    await expect(ui(page).getByRole("navigation", { name: "Vaults" }).getByRole("button", { name: VAULT })).toBeVisible();
    const bar = page.getByRole("navigation", { name: "Bar" });
    await expect(bar.getByRole("link", { name: "Notes" })).toHaveAttribute("aria-current", "page");
    await expect(bar.getByRole("link", { name: "Capture" })).toBeVisible();

    // find it by its words, across the vaults, and change it
    await ui(page).getByRole("searchbox", { name: "Search every vault" }).fill(`north bed`);
    await ui(page).getByRole("list", { name: "Search results" }).getByRole("link", { name: new RegExp(`Garden plan ${stamp}`) }).click();
    await ui(page).getByRole("link", { name: "Edit" }).click();
    const words = page.getByRole("textbox", { name: "The note's words" });
    await expect(words).toHaveValue(/Kale in the north bed/);
    await words.fill(`# Garden plan ${stamp}\n\nKale in the north bed. Garlic by the gate.`);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(ui(page).getByText("Garlic by the gate.")).toBeVisible();
    expect(((await api(hub, "GET", `notes/${note.id}?include_content=true`)) as Row).content).toContain("Garlic by the gate.");

    // a note changed elsewhere (an AI) while it was open: Save says so, and the person's words stay
    await ui(page).getByRole("link", { name: "Edit" }).click();
    await expect(words).toHaveValue(/Garlic/);
    await api(hub, "PATCH", `notes/${note.id}`, { content: `# Garden plan ${stamp}\n\nWritten by an AI meanwhile.`, force: true });
    await words.fill(`# Garden plan ${stamp}\n\nMine, from the phone.`);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("alert")).toContainText("changed since you opened it");
    await expect(words).toHaveValue(/Mine, from the phone/);
    await page.getByRole("button", { name: "Keep mine" }).click();
    await expect(ui(page).getByText("Mine, from the phone.")).toBeVisible();

    // a new note: its first line names it
    await bar.getByRole("link", { name: "Notes" }).click();
    await ui(page).getByRole("link", { name: "New note" }).click();
    await page.getByRole("textbox", { name: "The new note" }).fill(`Seed order ${stamp}\n\nBeans, chard, nasturtiums.`);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(ui(page).getByText("Beans, chard, nasturtiums.")).toBeVisible();
    const rows = await api(hub, "GET", `notes?search=${encodeURIComponent("nasturtiums")}&include_content=true&limit=10`) as Row[];
    const fresh = rows.find((r) => r.path === `Seed order ${stamp}`);
    expect(fresh, "the new note, at the path its first line names").toBeTruthy();
    made.push(fresh!.id);

    // Connect: the vault's connector address, to copy
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await bar.getByRole("link", { name: "Connect" }).click();
    const address = `${hub.origin}/vault/${VAULT}/mcp`;
    await expect(page.getByText(address, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: `Copy the address of ${VAULT}` }).click();
    await expect(page.getByRole("button", { name: `Copied the address of ${VAULT}` })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(address);

    // Capture: one tap puts it in the home vault; its card asks; a line lands in Inbox/ (applets run on a new device
    // once its self-test has passed, as auth.setup waits for it)
    await page.goto("/settings");
    await expect(page.getByRole("status").filter({ hasText: /approved code only|run sealed/ })).toBeVisible({ timeout: 45_000 });
    await bar.getByRole("link", { name: "Capture" }).click();
    await page.getByRole("button", { name: "Add Capture" }).click();
    await expect(page.getByRole("region", { name: /asking for access/ })).toContainText("Inbox/");
    await page.getByRole("button", { name: "Allow" }).click();
    const cap = page.frameLocator("iframe.applet-frame");
    await cap.getByRole("textbox", { name: "Write it down" }).fill(`Ask about rye flour ${stamp}`);
    await cap.getByRole("button", { name: "Save" }).click();
    await expect(cap.getByText("Saved to Inbox.")).toBeVisible();
    await expect(cap.getByRole("list", { name: "Captured" })).toContainText(`Ask about rye flour ${stamp}`);
    const inbox = await api(hub, "GET", `notes?path_prefix=${encodeURIComponent("Inbox/")}&include_content=true&limit=20`) as Row[];
    const captured = inbox.find((r) => r.content === `Ask about rye flour ${stamp}`);
    expect(captured?.path, "named by its words").toBe(`Inbox/Ask about rye flour ${stamp}`);
    if (captured) made.push(captured.id);
    // the bar now goes straight to the applet
    await expect(bar.getByRole("link", { name: "Capture" })).toHaveAttribute("href", /\/v\/[^/]+\/a\//);
  } finally {
    const applets = await api(hub, "GET", `notes?path_prefix=${encodeURIComponent("Applets/Capture")}&limit=5`).catch(() => []) as Row[];
    for (const id of [...made, ...applets.map((a) => a.id)]) await api(hub, "DELETE", `notes/${id}`).catch(() => {});
  }
});
