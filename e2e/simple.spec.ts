// Parachute Simplified (docs/SIMPLE.md), as a person whose settings choose it signs in on a new device: they land on
// Notes, find a note, change it (the first Save saves), write a new one, copy the hub's one address and a vault's own, capture a
// line into Inbox/ and write a Journal entry, both Parachute's own applets with no card. Against the real hub: what the app writes is read back.
import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";
import { api, hubState, VAULT } from "./hub";

type Row = { id: string; path: string; content?: string; tags?: string[] };

test("Parachute Simplified: sign in → Notes → find, edit and write a note → Connect → Capture a line → Journal", async ({ page, context }) => {
  const hub = hubState();
  const stamp = Date.now().toString(36);
  const made: string[] = [];
  // the person's settings say simple (a Cloud person's first sign-in writes it; here their agent did), the only note so
  for (const n of await api(hub, "GET", "notes?tag=parachute-settings") as Row[]) await api(hub, "DELETE", `notes/${n.id}`);
  const settings = await api(hub, "POST", "notes", { path: "Parachute/Settings", tags: ["parachute-settings"], content: "settings", metadata: { parachute: { bundle: "simple" } } }) as Row;
  made.push(settings.id);
  const note = await api(hub, "POST", "notes", { path: `Garden plan ${stamp}`, content: `# Garden plan ${stamp}\n\nKale in the north bed.` }) as Row;
  made.push(note.id);
  // more captures than Capture lists (12): the newest must still show
  for (let i = 0; i < 13; i++) made.push((await api(hub, "POST", "notes", { path: `Inbox/2026-01-${String(i + 1).padStart(2, "0")} 09-00 old line ${i} ${stamp}`, content: `old line ${i}` }) as Row).id);
  try {
    await signIn(page);
    // Notes: Parachute's own applet (docs/design/PARACHUTE-SOURCE.md), no card: the home's newest notes; the bar says
    // Notes, Journal, Capture, Vault, Connect
    const notes = page.frameLocator('iframe.applet-frame[title="Notes"]');
    await expect(notes.getByRole("heading", { level: 1, name: "Notes" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Allow" })).toHaveCount(0);
    const bar = page.getByRole("navigation", { name: "Bar" });
    await expect(bar.getByRole("link", { name: "Notes" })).toHaveAttribute("aria-current", "page");
    await expect(bar.getByRole("link", { name: "Capture" })).toBeVisible();
    // each vault the sign-in didn't read is a line in Settings
    await page.goto("/settings");
    await expect(page.getByRole("button", { name: "Open letters", exact: true })).toBeVisible();
    await bar.getByRole("link", { name: "Notes" }).click();

    // find it by its words, across the vaults: it opens in Vault, Parachute's own (no card), where its words change
    await notes.getByRole("searchbox", { name: "Search every vault" }).fill(`north bed`);
    await notes.getByRole("region", { name: "Search results" }).getByRole("button", { name: new RegExp(`Garden plan ${stamp}`) }).click();
    await expect(page).toHaveURL(/\/a\/parachute%3Avault\?/);
    await expect(page.getByRole("button", { name: "Allow" })).toHaveCount(0);
    const vault = page.frameLocator('iframe.applet-frame[title="Vault"]');
    const rec = vault.getByRole("article", { name: `Garden plan ${stamp}` });
    await rec.getByRole("button", { name: "Edit words" }).click();
    const words = rec.getByLabel("The record's words");
    await expect(words).toHaveValue(/Kale in the north bed/);
    await words.fill(`# Garden plan ${stamp}\n\nKale in the north bed. Garlic by the gate.`);
    // the sign-in asked the home at write (Parachute's own applets write there): the first Save saves
    await rec.getByRole("button", { name: "Save" }).click();
    await expect(rec.getByText("Garlic by the gate.")).toBeVisible();
    expect(((await api(hub, "GET", `notes/${note.id}?include_content=true`)) as Row).content).toContain("Garlic by the gate.");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // a note changed elsewhere (an AI) while it was being written: Save says so, the person's words stay, and Save
    // again keeps them
    await rec.getByRole("button", { name: "Edit words" }).click();
    await api(hub, "PATCH", `notes/${note.id}`, { content: `# Garden plan ${stamp}\n\nWritten by an AI meanwhile.`, force: true });
    await words.fill(`# Garden plan ${stamp}\n\nMine, from the phone.`);
    await rec.getByRole("button", { name: "Save" }).click();
    await expect(vault.getByText("It changed meanwhile. It's read again: try once more.")).toBeVisible();
    await expect(words).toHaveValue(/Mine, from the phone/);
    await rec.getByRole("button", { name: "Save" }).click();
    await expect(rec.getByText("Mine, from the phone.")).toBeVisible();
    expect(((await api(hub, "GET", `notes/${note.id}?include_content=true`)) as Row).content).toContain("Mine, from the phone.");

    // a new note, in Notes: its first line names it
    await bar.getByRole("link", { name: "Notes" }).click();
    await notes.getByRole("button", { name: "New note" }).click();
    await notes.getByRole("textbox", { name: "The new note" }).fill(`Seed order ${stamp}\n\nBeans, chard, nasturtiums.`);
    await notes.getByRole("button", { name: `Save to ${VAULT}` }).click();
    // it opens where a note opens: in Vault
    await expect(vault.getByText("Beans, chard, nasturtiums.")).toBeVisible();
    const rows = await api(hub, "GET", `notes?search=${encodeURIComponent("nasturtiums")}&include_content=true&limit=10`) as Row[];
    const fresh = rows.find((r) => r.path === `Seed order ${stamp}`);
    expect(fresh, "the new note, at the path its first line names").toBeTruthy();
    made.push(fresh!.id);

    // Connect: the hub's one address for an AI first (T-476: `mcp_endpoint`, or on a hub from before it the account
    // door it names), then the vault's own under "Just one vault"; each to copy
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await bar.getByRole("link", { name: "Connect" }).click();
    // Parachute's own applet, no card
    const connect = page.frameLocator('iframe.applet-frame[title="Connect"]');
    const said = await (await fetch(`${hub.origin}/.well-known/parachute-account`)).json() as { mcp_endpoint?: string; account_mcp_endpoint?: string };
    const one = said.mcp_endpoint ?? said.account_mcp_endpoint;
    expect(one, "the hub names an address for every vault").toBeTruthy();
    await expect(connect.getByText(one!, { exact: true })).toBeVisible();
    await connect.getByRole("button", { name: /^Copy the address of all your vaults/ }).click();
    await expect(connect.getByRole("button", { name: /^Copied the address of all your vaults/ })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(one);
    const address = `${hub.origin}/vault/${VAULT}/mcp`;
    const justOne = connect.getByRole("region", { name: "Just one vault" });
    await expect(justOne.getByText(address, { exact: true })).toBeVisible();
    await justOne.getByRole("button", { name: `Copy the address of ${VAULT}` }).click();
    await expect(justOne.getByRole("button", { name: `Copied the address of ${VAULT}` })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(address);
    // then what to ask it: a cold AI connected by the address finds no word of applets in the vault (T-476 stranger
    // walk), so the person hands it the ask and the guide
    await expect(connect.getByRole("heading", { name: "Then ask it for an applet" })).toBeVisible();
    await connect.getByRole("button", { name: "Copy what to ask" }).click();
    await expect(connect.getByRole("button", { name: "Copied what to ask" })).toBeVisible();
    const ask = await page.evaluate(() => navigator.clipboard.readText());
    expect(ask).toContain("Make me one in my Parachute app that");
    expect(ask).toContain("https://github.com/ParachuteComputer/parachute/blob/main/docs/WRITE-AN-APPLET.md");

    // Capture: Parachute's own (docs/design/PARACHUTE-SOURCE.md), no card, nothing written to add it; a line lands in
    // Inbox/ (applets run on a new device once its self-test has passed, as auth.setup waits for it)
    await page.goto("/settings");
    await expect(page.getByRole("status").filter({ hasText: /approved code only|run sealed/ })).toBeVisible({ timeout: 45_000 });
    await bar.getByRole("link", { name: "Capture" }).click();
    const cap = page.frameLocator('iframe.applet-frame[title="Capture"]');
    await expect(cap.getByRole("textbox", { name: "Write it down" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Allow" })).toHaveCount(0);
    await cap.getByRole("textbox", { name: "Write it down" }).fill(`Ask about rye flour ${stamp}`);
    await cap.getByRole("button", { name: "Save" }).click();
    await expect(cap.getByText("Saved to Inbox.")).toBeVisible();
    await expect(cap.getByRole("region", { name: "Captured" })).toContainText(`Ask about rye flour ${stamp}`);
    const inbox = await api(hub, "GET", `notes?path_prefix=${encodeURIComponent("Inbox/")}&include_content=true&limit=20`) as Row[];
    const captured = inbox.find((r) => r.content === `Ask about rye flour ${stamp}`);
    expect(captured?.path, "named by its words").toBe(`Inbox/Ask about rye flour ${stamp}`);
    if (captured) made.push(captured.id);
    // the same words again: a note of its own, its name with the time
    await cap.getByRole("textbox", { name: "Write it down" }).fill(`Ask about rye flour ${stamp}`);
    await cap.getByRole("button", { name: "Save" }).click();
    await expect.poll(async () => ((await api(hub, "GET", `notes?path_prefix=${encodeURIComponent("Inbox/")}&include_content=true&limit=30`)) as Row[])
      .filter((r) => r.content === `Ask about rye flour ${stamp}`).map((r) => r.path).sort()).toEqual([
      `Inbox/Ask about rye flour ${stamp}`, expect.stringMatching(new RegExp(`^Inbox/Ask about rye flour ${stamp} \\d{4}-\\d{2}-\\d{2} \\d{2}-\\d{2}$`))]);
    for (const r of (await api(hub, "GET", `notes?path_prefix=${encodeURIComponent("Inbox/")}&limit=30`)) as Row[]) if (r.path.startsWith(`Inbox/Ask about rye flour ${stamp} `)) made.push(r.id);
    // the bar goes straight to Parachute's own Capture
    await expect(bar.getByRole("link", { name: "Capture" })).toHaveAttribute("href", /\/v\/[^/]+\/a\/parachute%3Acapture$/);

    // Journal: Parachute's own, the same applet the Uni app runs, no card; an entry lands in Journal/, by day
    await bar.getByRole("link", { name: "Journal" }).click();
    const jr = page.frameLocator("iframe.applet-frame[title=\"Journal\"]");
    await expect(page.getByRole("button", { name: "Allow" })).toHaveCount(0);
    await jr.getByRole("textbox", { name: "Write in your journal" }).fill(`Planted the garlic ${stamp}`);
    await jr.getByRole("button", { name: "Save" }).click();
    await expect(jr.getByText("Saved to Journal.")).toBeVisible();
    await expect.poll(async () => ((await api(hub, "GET", `notes?path_prefix=${encodeURIComponent("Journal/")}&include_content=true&limit=30`)) as Row[])
      .filter((r) => (r.content ?? "").includes(`Planted the garlic ${stamp}`)).map((r) => r.path)).toEqual([expect.stringMatching(/^Journal\/\d{4}\/\d{2}-\d{2}\//)]);
    for (const r of (await api(hub, "GET", `notes?path_prefix=${encodeURIComponent("Journal/")}&include_content=true&limit=30`)) as Row[]) if ((r.content ?? "").includes(stamp)) made.push(r.id);
    // nothing was written into the vault to add them
    expect([...await api(hub, "GET", `notes?path_prefix=${encodeURIComponent("Applets/")}&limit=50`) as Row[]].filter((r) => /^Applets\/(Capture|Journal)/.test(r.path))).toEqual([]);
  } finally {
    for (const id of made) await api(hub, "DELETE", `notes/${id}`).catch(() => {});
  }
});
