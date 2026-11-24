// People applet (applets/people.json + people.tsx, docs/PEOPLE.md): runs in the sealed frame against a real hub.
// Exercises: Allow, Contacts list (favorites, A-Z sections, letter index, upcoming birthday), search as you type,
// filters (relation/group/tag/last in touch), sort by most recently in touch, Birthdays & In touch tabs (keep-in-touch
// cadence), person card with its timeline and "We talked", editing details and body in place, adding a person, importing a .vcf (deduping an existing contact by email
// and creating a new contact with an attached photo rendered via vault.file), and Daylight mode.
// Set PEOPLE_SHOTS=<dir> to also capture 390x844 phone screenshots (Paper + Daylight) for the walkthrough.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";
import { appletRecord } from "../applets/record.ts";
import { api, hubState, VAULT } from "./hub";

test.use({ storageState: "e2e/.signed-in.json" });

const SHOTS = process.env.PEOPLE_SHOTS || "";
const frame = (page: Page) => page.frameLocator("iframe.applet-frame:visible");

// A made-up portrait for the vCard photo: a 96x96 PNG, a warm head-and-shoulders shape on a teal ground
function portraitPng(): string {
  const W = 96, crc = (b: Buffer) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type: string, data: Buffer) => { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };
  const rows: number[] = [];
  for (let y = 0; y < W; y++) {
    rows.push(0);
    for (let x = 0; x < W; x++) {
      const head = (x - 48) ** 2 + (y - 38) ** 2 < 17 ** 2, body = (x - 48) ** 2 / 34 ** 2 + (y - 100) ** 2 / 32 ** 2 < 1;
      rows.push(...(head || body ? [214, 140, 96] : [46 + y / 4, 120 + y / 6, 128 + y / 5].map(Math.round)));
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(W, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.from(rows))), chunk("IEND", Buffer.alloc(0))]).toString("base64");
}
const PORTRAIT_B64 = portraitPng();

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: false });
}

test("People applet: open, search, filter, view links, add, edit, import vCard with photo, and Daylight", async ({ page }) => {
  test.setTimeout(240_000);
  if (SHOTS) await page.setViewportSize({ width: 390, height: 844 });

  const r = appletRecord("people");
  const hub = hubState();
  const createdIds: string[] = [];

  const seed = async (path: string, content: string, tags: string[], metadata: Record<string, unknown> = {}, extension?: string) => {
    const n = await api(hub, "POST", "notes", { path, content, tags, metadata, ...(extension ? { extension } : {}) });
    createdIds.push(n.id);
    return n as { id: string; path: string };
  };

  // Compute an upcoming birthday 5 days from today so the birthday callout and tab always show it
  const inFive = new Date(Date.now() + 5 * 86_400_000);
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const upcomingBday = `1991-${pad2(inFive.getMonth() + 1)}-${pad2(inFive.getDate())}`;

  try {
    const applet = await seed(r.path, r.body, r.tags, r.fields, r.extension);

    // Seed made-up people fitting Aaron's vault schema + additive fields
    await seed(
      "People/Maya Lin",
      "## Memories and moments\n\nHiked Green Mountain together and talked about wood-fired kilns.\n",
      ["person"],
      {
        relation: "friend",
        status: "active",
        summary: "Ceramicist and trail runner in Boulder",
        email: "maya@example.test",
        phones: ["mobile: +1 303-555-0142"],
        address: "412 Pine St\nBoulder, CO 80302",
        birthday: upcomingBday,
        links: ["https://mayastudio.example"],
        tags: ["boulder", "ceramics"],
        groups: ["Close friends", "Climbing"],
        ways_of_working: ["Prefers voice notes over long emails"],
        source: "Pottery studio open house",
        how_we_met: "At the pottery studio open house",
        met: "2023-06-10",
        favorite: true,
      },
    );

    await seed(
      "People/Devon Park",
      "## Memories and moments\n\nPaired on synth firmware in the spring.\n",
      ["person"],
      {
        relation: "collaborator",
        status: "active",
        summary: "Hardware designer and field recordist",
        email: "devon@example.test",
        phones: ["work: +1 415-555-0188"],
        birthday: "--03-14",
        tags: ["hardware", "audio"],
        groups: ["Techne"],
        source: "Local synth meetup",
        keep_in_touch: "every month",
      },
    );

    await seed(
      "People/Amara Osei",
      "## Memories and moments\n\nSunday dinner host.\n",
      ["person"],
      {
        relation: "family",
        status: "active",
        summary: "Architect and avid sourdough baker",
        email: "amara@example.test",
        phones: ["mobile: +1 206-555-0119"],
        tags: ["baking"],
        groups: ["Family"],
        favorite: true,
      },
    );

    await seed(
      "People/Tessa Cho",
      "## Memories and moments\n\nRecommended two great essays on urban forestry.\n",
      ["person"],
      {
        relation: "influence",
        status: "active",
        summary: "Botanist and essayist",
        email: "tessa@example.test",
        tags: ["trees", "writing"],
        groups: ["Reading circle"],
      },
    );

    // Seed linked notes mentioning Maya Lin (so her timeline and last connection come from real vault links)
    await seed("Meetings/2026-11-20 Coffee with Maya", "Caught up with [[People/Maya Lin]] about the winter kiln firing.", ["meeting"]);
    await seed("Journal/2026/11-21/08-30", "Morning trail run with [[People/Maya Lin]] up Sanitas.", ["journal"]);

    // 1. Open applet and allow access
    await page.goto(`/v/${VAULT}/a/${applet.id}`);
    await expect(page.getByRole("region", { name: /asking for access/ })).toContainText("People/");
    await page.getByRole("button", { name: "Allow" }).click();

    const f = frame(page);
    await expect(f.getByRole("heading", { name: "People" })).toBeVisible({ timeout: 30_000 });
    await expect(f.getByRole("region", { name: /Favorites · 2/ })).toContainText("Maya Lin");
    await expect(f.getByRole("region", { name: /Favorites · 2/ })).toContainText("Amara Osei");
    await expect(f.getByText("Birthdays coming up")).toBeVisible();
    await expect(f.getByRole("navigation", { name: "Letter index" })).toBeVisible();
    await shot(page, "01-contacts-list-paper");

    // 2. Search as you type (by name and by phone digits)
    const searchBox = f.getByRole("searchbox", { name: "Search people" });
    await searchBox.fill("5550188");
    await expect(f.getByRole("button", { name: "Devon Park" })).toBeVisible();
    await expect(f.getByRole("button", { name: "Maya Lin" })).toHaveCount(0);
    await searchBox.fill("");
    await expect(f.getByRole("button", { name: "Maya Lin" }).first()).toBeVisible();

    // 3. Filter by relation / tag / group
    await f.getByRole("button", { name: "Filters" }).click();
    await expect(f.getByRole("dialog", { name: "Filter people" })).toBeVisible();
    await shot(page, "02-filter-drawer");
    await f.getByRole("dialog", { name: "Filter people" }).getByRole("button", { name: /#boulder/ }).click();
    await f.getByRole("dialog", { name: "Filter people" }).getByRole("button", { name: /Show 1/ }).click();
    await expect(f.getByRole("button", { name: "#boulder ×" })).toBeVisible();
    await expect(f.getByRole("button", { name: "Maya Lin" }).first()).toBeVisible();
    await expect(f.getByRole("button", { name: "Devon Park" })).toHaveCount(0);
    await f.getByRole("button", { name: "Clear", exact: true }).click();

    // 3b. Sort by most recently in touch, and filter by it
    await f.getByRole("button", { name: "Recent", exact: true }).click();
    const recent = f.getByRole("region", { name: /Most recently in touch · 4/ });
    await expect(recent.getByRole("button").first()).toContainText("Maya Lin");
    await expect(recent).toContainText("Journal: 2026 / 11-21 / 08-30");
    await shot(page, "02b-recent-sort");
    await f.getByRole("button", { name: "Filters" }).click();
    await f.getByRole("dialog", { name: "Filter people" }).getByRole("button", { name: "Never", exact: true }).click();
    await f.getByRole("dialog", { name: "Filter people" }).getByRole("button", { name: /Show 3/ }).click();
    await expect(f.getByRole("button", { name: "In touch: Never ×" })).toBeVisible();
    await expect(f.getByRole("button", { name: "Maya Lin" })).toHaveCount(0);
    await f.getByRole("button", { name: "Clear", exact: true }).click();
    await f.getByRole("button", { name: "A–Z", exact: true }).click();
    await expect(f.getByRole("navigation", { name: "Letter index" })).toBeVisible();

    // 4. Birthdays & In touch tabs
    await f.getByRole("button", { name: /Birthdays/ }).click();
    await expect(f.getByRole("region", { name: /Next 60 days/ })).toContainText("Maya Lin");
    await shot(page, "03-birthdays-tab");

    await f.getByRole("button", { name: "In touch", exact: true }).click();
    // Devon is kept in touch with every month and never has been: time to reach out; he isn't listed again below
    await expect(f.getByRole("region", { name: "Time to reach out" })).toContainText("Devon Park");
    await expect(f.getByRole("region", { name: /No connection yet · 2/ })).toContainText("Tessa Cho");
    await expect(f.getByRole("region", { name: /No connection yet/ })).not.toContainText("Devon Park");
    await shot(page, "04-in-touch-tab");

    await f.getByRole("button", { name: /Contacts/ }).click();

    // 5. Open Maya Lin's contact card and verify contact info, tags, groups, body, and linked mentions
    await f.getByRole("region", { name: /Favorites/ }).getByRole("button", { name: "Maya Lin" }).click();
    await expect(f.locator("header").getByRole("heading", { name: "Maya Lin" })).toBeVisible();
    await expect(f.getByText("Ceramicist and trail runner in Boulder")).toBeVisible();
    await expect(f.getByText("+1 303-555-0142")).toBeVisible();
    await expect(f.getByText("maya@example.test")).toBeVisible();
    await expect(f.getByText("Hiked Green Mountain together")).toBeVisible();
    await expect(f.getByText("How we met: At the pottery studio open house")).toBeVisible();
    await expect(f.getByText(/Last in touch .* · 2026 \/ 11-21 \/ 08-30/)).toBeVisible();
    const timeline = f.getByRole("region", { name: /Timeline · 3/ });
    await expect(timeline.getByRole("button").first()).toContainText("2026 / 11-21 / 08-30");
    await expect(timeline).toContainText("2026-11-20 Coffee with Maya");
    await expect(timeline.getByRole("listitem").last()).toContainText("At the pottery studio open house");
    await f.locator("body").evaluate(() => window.scrollTo(0, 0));
    await shot(page, "05-person-card-paper");
    await timeline.scrollIntoViewIfNeeded();
    await shot(page, "05b-person-card-timeline");

    // 5b. We talked: a line in her timeline, kept on her card in the vault
    await f.getByRole("button", { name: "We talked" }).click();
    const talk = f.getByRole("dialog", { name: "In touch with Maya Lin" });
    await talk.getByLabel("What about (optional)").fill("Tea at the studio; she'll send the glaze notes");
    await shot(page, "05c-we-talked");
    await talk.getByRole("button", { name: "Save" }).click();
    await expect(f.getByText("Noted: in touch today.")).toBeVisible();
    await expect(f.getByRole("region", { name: /Timeline · 4/ }).getByRole("listitem").first()).toContainText("Tea at the studio; she'll send the glaze notes");
    await expect(f.getByText("Last in touch today · Tea at the studio; she'll send the glaze notes")).toBeVisible();
    const talked = (await api(hub, "GET", `notes?id=${encodeURIComponent("People/Maya Lin")}&include_metadata=true`));
    const talkedRow = Array.isArray(talked) ? talked[0] : talked;
    expect(talkedRow.metadata.talked).toEqual([expect.stringMatching(/^\d{4}-\d{2}-\d{2}: Tea at the studio; she'll send the glaze notes$/)]);
    // put it right: tap the talk on the timeline; the entry is replaced, not added to
    await f.getByRole("region", { name: /Timeline · 4/ }).getByRole("button", { name: /Tea at the studio/ }).click();
    const fix = f.getByRole("dialog", { name: "Put this right" });
    await expect(fix.getByLabel("What about (optional)")).toHaveValue("Tea at the studio; she'll send the glaze notes");
    await fix.getByLabel("What about (optional)").fill("Tea at the studio; glaze notes coming");
    await fix.getByRole("button", { name: "Save" }).click();
    await expect(f.getByRole("region", { name: /Timeline · 4/ }).getByRole("listitem").first()).toContainText("glaze notes coming");
    const fixed = await api(hub, "GET", `notes?id=${encodeURIComponent("People/Maya Lin")}&include_metadata=true`);
    expect((Array.isArray(fixed) ? fixed[0] : fixed).metadata.talked).toEqual([expect.stringMatching(/^\d{4}-\d{2}-\d{2}: Tea at the studio; glaze notes coming$/)]);
    // a half-written talk doesn't follow you to the next card: Back with the drawer open, then open someone else
    await f.getByRole("button", { name: "We talked" }).click();
    await f.getByRole("dialog", { name: "In touch with Maya Lin" }).getByLabel("What about (optional)").fill("meant for Maya");
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(f.getByRole("heading", { name: "People" })).toBeVisible();
    await f.getByRole("button", { name: "Devon Park" }).first().click();
    await expect(f.locator("header").getByRole("heading", { name: "Devon Park" })).toBeVisible();
    await expect(f.getByRole("dialog")).toHaveCount(0);
    await f.getByRole("button", { name: "← People" }).click();
    await f.getByRole("region", { name: /Favorites/ }).getByRole("button", { name: "Maya Lin" }).click();

    // 6. Edit details in place & edit notes in place
    await f.getByRole("button", { name: "Edit details" }).click();
    const summaryInput = f.getByLabel("Summary");
    await summaryInput.fill("Ceramicist, trail runner, and tea fan in Boulder");
    await summaryInput.press("Enter");
    await expect(f.getByText("Saved")).toBeVisible();
    // off the phone's Contacts, and back: only "off" is written down
    const onPhone = f.getByLabel("On my phone (Contacts sync)");
    await expect(onPhone).toBeChecked();
    await onPhone.uncheck();
    await expect.poll(async () => { const r = await api(hub, "GET", `notes?id=${encodeURIComponent("People/Maya Lin")}&include_metadata=true`); return (Array.isArray(r) ? r[0] : r).metadata.on_phone; }).toBe(false);
    await onPhone.check();
    await expect.poll(async () => { const r = await api(hub, "GET", `notes?id=${encodeURIComponent("People/Maya Lin")}&include_metadata=true`); return (Array.isArray(r) ? r[0] : r).metadata.on_phone; }).toBeUndefined();
    await f.getByRole("button", { name: "Done" }).click();
    await expect(f.getByText("Ceramicist, trail runner, and tea fan in Boulder")).toBeVisible();

    await f.getByRole("button", { name: "Edit notes" }).click();
    await f.getByRole("textbox", { name: "Notes and memories" }).fill("## Memories and moments\n\nHiked Green Mountain and shared roasted oolong tea.\n");
    // her own change to a field while the notes are open isn't a conflict with them: unfavorite, favorite again, then Save
    await f.getByRole("button", { name: "★ Favorite" }).click();
    await f.getByRole("button", { name: "☆ Favorite" }).click();
    await expect(f.getByRole("button", { name: "★ Favorite" })).toBeVisible();
    await expect(f.getByText("Added to favorites.")).toBeVisible();
    await f.getByRole("button", { name: "Save" }).click();
    await expect(f.getByText("shared roasted oolong tea")).toBeVisible();
    await expect(f.getByText(/Someone else changed/)).toHaveCount(0);
    // and Save tapped while a field change of hers is still on its way: it waits for it, no conflict
    await f.getByRole("button", { name: "Edit notes" }).click();
    await f.getByRole("textbox", { name: "Notes and memories" }).fill("## Memories and moments\n\nHiked Green Mountain and shared roasted oolong tea. Twice.\n");
    // a slow line: the favourite's write takes a while to reach the hub
    let slowed = false;
    const hubWrites = (u: URL) => u.origin === new URL(hub.origin).origin;
    await page.route(hubWrites, async (route) => {
      if (!slowed && route.request().method() !== "GET" && (route.request().postData() ?? "").includes("favorite")) { slowed = true; await new Promise((r) => setTimeout(r, 1500)); }
      await route.continue().catch(() => {});
    });
    await f.getByRole("button", { name: "★ Favorite" }).click();
    await f.getByRole("button", { name: "Save" }).click();
    await expect(f.getByText("shared roasted oolong tea. Twice.")).toBeVisible();
    expect(slowed).toBe(true);
    await expect(f.getByText(/Someone else changed/)).toHaveCount(0);
    await f.getByRole("button", { name: "☆ Favorite" }).click();
    await expect(f.getByRole("button", { name: "★ Favorite" })).toBeVisible();
    await page.unroute(hubWrites);

    // Verify persisted on the hub
    const mayaSaved = await api(hub, "GET", `notes?id=${encodeURIComponent("People/Maya Lin")}&include_content=true&include_metadata=true`);
    const mayaRow = Array.isArray(mayaSaved) ? mayaSaved[0] : mayaSaved;
    expect(mayaRow.metadata.summary).toBe("Ceramicist, trail runner, and tea fan in Boulder");
    expect(mayaRow.content).toContain("roasted oolong tea");

    // but a draft begun before someone else changed her notes stays a conflict, whatever she saves of her own after
    await f.getByRole("button", { name: "Edit notes" }).click();
    await f.getByRole("textbox", { name: "Notes and memories" }).fill("## Memories and moments\n\nA draft from before.\n");
    await page.waitForTimeout(400);
    await f.getByRole("button", { name: "← People" }).click();
    await api(hub, "PATCH", `notes/${mayaRow.id}`, { content: "## Memories and moments\n\nWritten on another device.\n", if_updated_at: mayaRow.updatedAt });
    await f.getByRole("region", { name: /Favorites/ }).getByRole("button", { name: "Maya Lin" }).click();
    await expect(f.getByRole("textbox", { name: "Notes and memories" })).toHaveValue(/A draft from before/);
    await f.getByRole("button", { name: "★ Favorite" }).click();
    await expect(f.getByText("Removed from favorites.")).toBeVisible();
    await f.getByRole("button", { name: "Save" }).click();
    await expect(f.getByText(/Someone else changed/)).toBeVisible();
    expect((await api(hub, "GET", `notes/${mayaRow.id}?include_content=true`)).content).toContain("Written on another device.");
    await f.getByRole("button", { name: "Cancel" }).click();
    await f.getByRole("button", { name: "☆ Favorite" }).click();
    await expect(f.getByRole("button", { name: "★ Favorite" })).toBeVisible();

    // Back to list
    await f.getByRole("button", { name: "← People" }).click();
    await expect(f.getByRole("heading", { name: "People" })).toBeVisible();

    // 7. Add a new person in place
    await f.getByRole("button", { name: "Add", exact: true }).click();
    const addDialog = f.getByRole("dialog", { name: "Add person" });
    await expect(addDialog).toBeVisible();
    await addDialog.getByLabel("Name").fill("Leo Vance");
    await addDialog.getByLabel("Summary").fill("Bicycle mechanic and mapmaker");
    await addDialog.getByLabel("Email").fill("leo@example.test");
    await addDialog.getByLabel("Email").blur();
    await addDialog.getByRole("button", { name: "Add person" }).click();

    await expect(f.locator("header").getByRole("heading", { name: "Leo Vance" })).toBeVisible();
    const leoHub = await api(hub, "GET", `notes?id=${encodeURIComponent("People/Leo Vance")}&include_metadata=true`);
    const leoRow = Array.isArray(leoHub) ? leoHub[0] : leoHub;
    createdIds.push(leoRow.id);
    expect(leoRow.tags).toContain("person");
    expect(leoRow.metadata.email).toBe("leo@example.test");

    await f.getByRole("button", { name: "← People" }).click();

    // 8. Import a .vcf file (1 matching existing person by email -> additive merge, 1 new person with base64 PNG photo)
    const vcfText = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Devon P.",
      "EMAIL:devon@example.test",
      "TEL;TYPE=CELL:+1 415-555-0199",
      "CATEGORIES:Sound",
      "END:VCARD",
      "BEGIN:VCARD",
      "VERSION:4.0",
      "FN:Nadia Okafor",
      "EMAIL:nadia@example.test",
      "TEL;TYPE=cell:+1 503-555-0164",
      "CATEGORIES:Designers",
      `PHOTO:data:image/png;base64,${PORTRAIT_B64}`,
      "END:VCARD",
    ].join("\r\n");

    await f.getByRole("button", { name: "vCard" }).click();
    await expect(f.getByRole("dialog", { name: "Contacts in and out" })).toBeVisible();
    await f.getByRole("button", { name: "Choose .vcf file" }).click();
    const picker = page.getByRole("dialog", { name: /People asks for (a file|files)/ });
    await expect(picker).toBeVisible();
    await picker.locator("input[type=file]").setInputFiles({
      name: "contacts.vcf",
      mimeType: "text/vcard",
      buffer: Buffer.from(vcfText, "utf8"),
    });

    await expect(f.getByText(/Matches Devon Park by email/)).toBeVisible();
    await expect(f.getByText("Nadia Okafor")).toBeVisible();
    await shot(page, "06-vcard-import-preview");

    await f.getByRole("dialog", { name: "Contacts in and out" }).getByRole("button", { name: /Import 2/ }).click();
    await expect(f.getByText(/1 added, 1 merged/)).toBeVisible({ timeout: 20_000 });

    // Confirm zero duplication for Devon Park and additive merge preserved existing fields
    const allPeopleNotes = await api(hub, "GET", `notes?path_prefix=${encodeURIComponent("People/")}&include_metadata=true&limit=50`);
    const devonRows = (allPeopleNotes as { id: string; path: string; metadata: Record<string, unknown> }[]).filter((n) => n.metadata?.email === "devon@example.test");
    expect(devonRows).toHaveLength(1);
    expect(devonRows[0].metadata.relation).toBe("collaborator");
    expect(devonRows[0].metadata.phones).toEqual(["work: +1 415-555-0188", "mobile: +1 415-555-0199"]);
    expect(devonRows[0].metadata.groups).toEqual(["Techne", "Sound"]);

    const nadiaRow = (allPeopleNotes as { id: string; path: string; metadata: Record<string, unknown> }[]).find((n) => n.path === "People/Nadia Okafor");
    expect(nadiaRow).toBeTruthy();
    createdIds.push(nadiaRow!.id);
    expect(typeof nadiaRow!.metadata.photo).toBe("string");

    // Open Nadia Okafor and confirm her attached photo renders via vault.file as a real blob: <img>
    await f.getByRole("button", { name: "Nadia Okafor" }).click();
    await expect(f.locator("header").getByRole("heading", { name: "Nadia Okafor" })).toBeVisible();
    await expect(f.locator("img.pe-avatar-img")).toBeVisible({ timeout: 15_000 });
    await shot(page, "06b-person-card-photo");
    await f.getByRole("button", { name: "← People" }).click();
    // back on the list; what it saves (no one open) reaches the app within 250 ms, then the page reloads
    await expect(f.getByRole("heading", { name: "People" })).toBeVisible();
    await page.waitForTimeout(500);

    // 9. Daylight mode check + screenshots at 390px
    await page.evaluate(() => localStorage.setItem("parachute.screen.v1", "daylight"));
    await page.reload();
    // a reload stops the applet; the person opens it again
    await page.getByRole("button", { name: "Open People" }).click();
    await expect(f.getByRole("heading", { name: "People" })).toBeVisible({ timeout: 30_000 });
    const bg = await f.locator("body").evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).toBe("rgb(255, 255, 255)");
    await shot(page, "07-contacts-list-daylight");

    await f.getByRole("region", { name: /Favorites/ }).getByRole("button", { name: "Maya Lin" }).click();
    await expect(f.locator("header").getByRole("heading", { name: "Maya Lin" })).toBeVisible();
    await shot(page, "08-person-card-daylight");
  } finally {
    for (const id of createdIds) await api(hub, "DELETE", `notes/${id}`).catch(() => {});
  }
});

// Installed as Uni installs it (scripts/install-applets.ts --applet people), over a folder of three pages of people:
// everyone listed; a .vcf whose notes match two of them reads those two, and its preview says truly what changes.
test("People installed by install-applets lists 130 people and previews an import against them", async ({ page }) => {
  test.setTimeout(180_000);
  if (SHOTS) await page.setViewportSize({ width: 390, height: 844 });
  const hub = hubState();
  const createdIds: string[] = [];
  const dir = mkdtempSync(join(tmpdir(), "people-t476-install-"));
  try {
    writeFileSync(join(dir, "token"), hub.token, { mode: 0o600 });
    const out = execFileSync("node", ["scripts/install-applets.ts", "--hub", hub.origin, "--vault", VAULT, "--token-file", join(dir, "token"), "--applet", "people", "--apply"]).toString();
    expect(out).toContain("Applets/People");
    const installed = (await api(hub, "GET", `notes?path_prefix=${encodeURIComponent("Applets/People")}&limit=5`) as { id: string; path: string }[])
      .find((n) => n.path === "Applets/People");
    expect(installed).toBeTruthy();
    createdIds.push(installed!.id);

    const pad = (i: number) => String(i).padStart(3, "0");
    for (let i = 1; i <= 130; i++) {
      const n = await api(hub, "POST", "notes", {
        path: `People/Bulk Person ${pad(i)}`,
        content: `## Memories and moments\n\nMet bulk ${pad(i)} at the co-op.\n`,
        tags: ["person"],
        metadata: { relation: "friend", email: `bulk${pad(i)}@example.test` },
      });
      createdIds.push(n.id);
    }

    await page.goto(`/v/${VAULT}/a/${installed!.id}`);
    await page.getByRole("button", { name: "Allow" }).click();
    const f = frame(page);
    await expect(f.getByRole("heading", { name: "People" })).toBeVisible({ timeout: 30_000 });
    await f.getByRole("searchbox", { name: "Search people" }).fill("Bulk Person");
    await expect(f.getByText(/^130 of \d+ people$/)).toBeVisible({ timeout: 30_000 });
    await expect(f.getByRole("button", { name: "Bulk Person 001" })).toBeVisible();
    await shot(page, "09-many-people");
    await f.getByRole("searchbox", { name: "Search people" }).fill("Bulk Person 130");
    await expect(f.getByRole("button", { name: "Bulk Person 130" })).toBeVisible();

    const vcf = [
      "BEGIN:VCARD", "VERSION:3.0", "FN:Bulk Person 007", "EMAIL:bulk007@example.test", "NOTE:Met bulk 007 at the co-op.", "END:VCARD",
      "BEGIN:VCARD", "VERSION:3.0", "FN:Bulk Person 120", "EMAIL:bulk120@example.test", "NOTE:Plays cello on Sundays.", "END:VCARD",
      "BEGIN:VCARD", "VERSION:3.0", "FN:Rowan Vale", "EMAIL:rowan@example.test", "END:VCARD",
    ].join("\r\n");
    await f.getByRole("button", { name: "vCard" }).click();
    await f.getByRole("button", { name: "Choose .vcf file" }).click();
    await page.getByRole("dialog", { name: /People asks for (a file|files)/ }).locator("input[type=file]")
      .setInputFiles({ name: "bulk.vcf", mimeType: "text/vcard", buffer: Buffer.from(vcf, "utf8") });
    await expect(f.getByText("Already up to date (Bulk Person 007)")).toBeVisible();
    await expect(f.getByText(/Matches Bulk Person 120 by email · will merge/)).toBeVisible();
    await expect(f.getByText("rowan@example.test")).toBeVisible();
    await shot(page, "10-import-preview-many");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    for (const id of createdIds) await api(hub, "DELETE", `notes/${id}`).catch(() => {});
  }
});
