// The look an applet gets with no CSS of its own (docs/THEME.md "The order of styles"): plain HTML in a sealed frame is
// drawn in the theme (paper, the faces, the kit's button and field), an HTML applet can use the parts' `pa-` classes,
// and the applet's own CSS always wins over the kit's, whatever its specificity (the kit sits in cascade layers).
import { expect, test, type Page } from "@playwright/test";
import { api, hubState, record } from "./hub";

test.use({ storageState: "e2e/.signed-in.json" });

const PAPER = "rgb(242, 237, 226)"; // the built-in --bg, #f2ede2
const SURFACE = "rgb(251, 248, 241)"; // --surface, #fbf8f1
const frame = (page: Page) => page.frameLocator("iframe.applet-frame");
const style = (page: Page, sel: string, prop: string) => frame(page).locator(sel).first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

const manifest = (id: string, name: string) => ({ applet: { contract: 2, id, name, access: [{ vault: "here", allow: [{ path: "Notes/", verbs: ["read"] }] }] } });

const PLAIN = `<!doctype html><html><body>
<h1>Seed swap</h1>
<p>Bring what you saved. <a href="#x">How it works</a></p>
<label>Your name <input placeholder="Mira"></label>
<button id="plain">Count me in</button>
<button class="pa-button pa-primary" id="part">Done</button>
<style>button { gap: 3px; }</style>
<table><thead><tr><th>Seed</th><th>Count</th></tr></thead><tbody><tr><td>Rye</td><td>40</td></tr></tbody></table>
</body></html>`;

const BARE_TSX = `export default function Bare() {
  return <div><h1>Shelf</h1><p>A list with no parts and no styles.</p><button>Add</button></div>;
}
`;

const PARTS_TSX = `import { Fields, List, Tabs } from "parachute";
export default function Parts() {
  const long = "A very long title for a row that has to wrap onto a second line on a phone and never run off the screen";
  return <div>
    <Tabs label="Shelves" tabs={[{ key: "a", label: "Reading" }, { key: "b", label: "Read" }]} current="a" onChange={() => {}} />
    <List label="Books" rows={[{ key: "1", title: long, onPress: () => {} }]} />
    <Fields label="Book" fields={[{ name: "pages", kind: "number", value: 320 }]} onSave={() => {}} />
  </div>;
}
`;

async function opened(page: Page, path: string, extension: string, content: string, id: string, name: string, see: string) {
  const note = await record(hubState(), "create", { path, extension, tags: ["applet"], body: content, fields: manifest(id, name) });
  await page.goto(`/v/kitchen/a/${note.id}`);
  // a new applet asks first
  await page.getByRole("button", { name: "Allow" }).click();
  await expect(frame(page).getByText(see).first()).toBeVisible();
  return note.id as string;
}

test("an HTML applet with no CSS of its own is drawn in the theme, can use the parts' classes, and its own CSS wins", async ({ page }) => {
  const id = await opened(page, "Applets/Seed swap", "html", PLAIN, "seed-swap", "Seed swap", "Seed swap");
  try {
    // the page: paper, the sans for the words, the serif for the title
    expect(await style(page, "body", "background-color")).toBe(PAPER);
    expect(await style(page, "body", "font-family")).toContain("Instrument Sans");
    expect(await style(page, "h1", "font-family")).toContain("Literata");
    // a bare button and field look like the kit's, not the browser's
    expect(await style(page, "#plain", "background-color")).toBe(SURFACE);
    expect(parseFloat(await style(page, "#plain", "border-top-left-radius"))).toBeGreaterThan(6);
    expect(parseFloat(await style(page, "input", "font-size"))).toBeGreaterThanOrEqual(16);
    expect(await style(page, "th", "font-family")).toContain("Instrument Sans");
    // a part's class works in plain HTML: Button's primary look
    expect(await style(page, "#part", "border-top-left-radius")).toBe("999px");
    // the applet's own rule, of lower specificity than the part's (`button` against `.pa-button`, which sets gap: 8px),
    // still wins: the kit is in layers below it
    expect(await style(page, "#part", "gap")).toBe("3px");
  } finally { await api(hubState(), "DELETE", `notes/${id}`); }
});

test("a TSX applet that draws its own markup without the parts still gets the page: paper, the faces, the button", async ({ page }) => {
  const id = await opened(page, "Applets/Shelf", "tsx", BARE_TSX, "shelf", "Shelf", "Shelf");
  try {
    expect(await style(page, "body", "background-color")).toBe(PAPER);
    expect(await style(page, "body", "font-family")).toContain("Instrument Sans");
    expect(await style(page, "h1", "font-family")).toContain("Literata");
    expect(await style(page, "button", "background-color")).toBe(SURFACE);
  } finally { await api(hubState(), "DELETE", `notes/${id}`); }
});

test("the base leaves the kit's parts alone: a pressable row wraps and stays square, a tab and a field keep their size", async ({ page }) => {
  const id = await opened(page, "Applets/Parts here", "tsx", PARTS_TSX, "parts-here", "Parts here", "Books");
  try {
    const row = frame(page).locator("button.pa-row").first();
    expect(await row.evaluate((el) => getComputedStyle(el).whiteSpace)).toBe("normal");
    expect(await row.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe("0px");
    expect(await row.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true); // nothing runs off
    expect(await frame(page).locator(".pa-tab").first().evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe("0px");
    expect(await frame(page).locator(".pa-finput").first().evaluate((el) => el.getBoundingClientRect().height)).toBeLessThan(34);
  } finally { await api(hubState(), "DELETE", `notes/${id}`); }
});

const NOTE_TSX = `import { Note } from "parachute";
export default function Read() {
  return <Note path="Notes/Bread" tags={["recipe"]} body={"# Bread\\n\\n## Ingredients\\n\\n- 500 g rye\\n\\n## Method\\n\\n1. Mix the \\\`rye\\\` and water.\\n\\n> Rest it overnight.\\n"} />;
}
`;

test("a note the kit draws keeps the note renderer's own look: the base stays out of it, and the renderer's rules still win their ties", async ({ page }) => {
  const id = await opened(page, "Applets/Note here", "tsx", NOTE_TSX, "note-here", "Note here", "Rest it overnight");
  try {
    // a recipe is drawn rich, by the renderer (.rn)
    await expect(frame(page).locator(".pa-note .rn blockquote")).toBeVisible();
    // the base's inline-code ring never reaches inside a note
    expect(await style(page, ".pa-note .rn code", "box-shadow")).toBe("none");
    // the renderer's blockquote (2px solid), not the part's double rule: its sheet comes after the parts' in their layer
    expect(await style(page, ".pa-note .rn blockquote", "border-left-style")).toBe("solid");
  } finally { await api(hubState(), "DELETE", `notes/${id}`); }
});

const OWN_BODY = `<!doctype html><html><head><style>body { max-width: 700px; margin: 2rem auto; }</style></head><body>
<h1>Letters</h1><p id="words">A column of its own, seven hundred pixels wide.</p>
<button id="long">A button with a long label that has to wrap on a phone rather than run off the side of the screen</button>
</body></html>`;

test("an applet's own body width is its own, and a long bare button wraps instead of running off the screen", async ({ page }) => {
  const id = await opened(page, "Applets/Letters", "html", OWN_BODY, "letters-own", "Letters own", "Letters");
  try {
    // on a phone: the button wraps inside the page
    expect(await frame(page).locator("html").evaluate((h) => h.scrollWidth <= h.clientWidth + 1)).toBe(true);
    expect(await frame(page).locator("#long").evaluate((b) => b.scrollWidth <= b.clientWidth + 1)).toBe(true);
    // on a wide screen: its 700px column keeps all 700px for its words (the kit's margins don't squeeze it)
    await page.setViewportSize({ width: 1400, height: 900 });
    await expect.poll(() => frame(page).locator("#words").evaluate((p) => Math.round(p.getBoundingClientRect().width))).toBe(700);
  } finally { await api(hubState(), "DELETE", `notes/${id}`); }
});

test("a theme note's look and its own tokens restyle an applet while it runs; deleting the note brings the default back", async ({ page }) => {
  const id = await opened(page, "Applets/Seed swap two", "html", PLAIN, "seed-swap-two", "Seed swap two", "Seed swap");
  const themeRows = async () => { const r = await api(hubState(), "GET", "notes?tag=parachute-theme"); return (Array.isArray(r) ? r : r.notes) as { id: string }[]; };
  for (const n of await themeRows()) await api(hubState(), "DELETE", `notes/${n.id}`);
  try {
    expect(await style(page, "#part", "border-top-left-radius")).toBe("999px");
    // as an agent writes it: the book look, and one token of the person's own
    await api(hubState(), "POST", "notes", { path: "Parachute/Theme", tags: ["parachute-theme"], metadata: { theme: { look: "book", tokens: { "radius-button": "4px" } } } });
    await expect.poll(() => style(page, "body", "background-color")).toBe("rgb(246, 241, 231)"); // book's paper, #f6f1e7
    expect(await style(page, "#part", "border-top-left-radius")).toBe("4px");
    expect(await style(page, "th", "border-bottom-style")).toBe("double"); // book's rule over a table
    for (const n of await themeRows()) await api(hubState(), "DELETE", `notes/${n.id}`);
    await expect.poll(() => style(page, "body", "background-color")).toBe(PAPER);
    expect(await style(page, "#part", "border-top-left-radius")).toBe("999px");
  } finally {
    for (const n of await themeRows()) await api(hubState(), "DELETE", `notes/${n.id}`);
    await api(hubState(), "DELETE", `notes/${id}`);
  }
});

test("Daylight is this screen's own: chosen in Settings it draws black on white here, and writes nothing to the theme note", async ({ page }) => {
  const themeRows = async () => { const r = await api(hubState(), "GET", "notes?tag=parachute-theme"); return (Array.isArray(r) ? r : r.notes) as { id: string }[]; };
  const shellBg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const before = (await themeRows()).length;
  await page.goto("/settings");
  await page.getByRole("radio", { name: /^Daylight/ }).check();
  await expect.poll(shellBg).toBe("rgb(255, 255, 255)");
  expect(await themeRows()).toHaveLength(before);
  // it stays on this device across a start
  await page.reload();
  await expect.poll(shellBg).toBe("rgb(255, 255, 255)");
  await page.getByRole("radio", { name: "As the theme" }).check();
  await expect.poll(shellBg).toBe(PAPER);
});

// the most common CSS reset, and a full-height body: an applet's own body rules mean what they mean in any page
const RESET = `<!doctype html><html><head><style>*, *::before, *::after { box-sizing: border-box; } html, body { height: 100%; }
body { max-width: 700px; margin: 0 auto; display: flex; flex-direction: column; } main { flex: 1; } footer { padding: 8px 0; }</style></head>
<body><main><h1>Ledger</h1><p id="words">A column of its own, under the common reset.</p></main><footer id="foot">Pinned to the foot</footer></body></html>`;

test("an applet with the common reset and a full-height body: its column keeps its width, and nothing scrolls past the screen", async ({ page }) => {
  const id = await opened(page, "Applets/Ledger", "html", RESET, "ledger-reset", "Ledger reset", "Ledger");
  try {
    await page.setViewportSize({ width: 1400, height: 900 });
    await expect.poll(() => frame(page).locator("#words").evaluate((p) => Math.round(p.getBoundingClientRect().width))).toBe(700);
    expect(await frame(page).locator("html").evaluate((h) => h.scrollHeight <= h.clientHeight + 1 && h.scrollWidth <= h.clientWidth + 1)).toBe(true);
    expect(await frame(page).locator("#foot").evaluate((f) => f.getBoundingClientRect().bottom <= innerHeight + 1)).toBe(true);
  } finally { await api(hubState(), "DELETE", `notes/${id}`); }
});

// as a real applet in use does it (Recipes): its own margin and padding, and a wide layout of its own
const OWN_PADDING = `<!doctype html><html><head><style>html, body { margin: 0; } body { padding: 18px; } .book { max-width: 1180px; margin: 0 auto; }</style></head>
<body><div class="book" id="book"><h1>Recipes</h1><p>A book of its own width.</p></div></body></html>`;

test("an applet that sets its own body margin and padding lays out exactly as in any page: the kit's column steps aside", async ({ page }) => {
  const id = await opened(page, "Applets/Own padding", "html", OWN_PADDING, "own-padding", "Own padding", "Recipes");
  try {
    expect(await frame(page).locator("#book").evaluate((b) => Math.round(b.getBoundingClientRect().left))).toBe(18);
    await page.setViewportSize({ width: 1400, height: 900 });
    await expect.poll(() => frame(page).locator("#book").evaluate((b) => Math.round(b.getBoundingClientRect().width))).toBe(1180);
  } finally { await api(hubState(), "DELETE", `notes/${id}`); }
});

// three more of an applet's own: a margin of its own with a paragraph first, a padded box of its own, and text alone
const OWN_MORE = `<!doctype html><html><head><style>body { max-width: 600px; margin: 2rem auto; } .box { width: 300px; padding: 20px; border: 2px solid; }</style></head>
<body><p id="first">A paragraph first, under a margin of its own.</p><div class="box" id="box">A padded box</div></body></html>`;
const TEXT_ONLY = `<!doctype html><html><body>Just a line of words, no element around them.</body></html>`;

test("an applet's own margin, padded box and bare text: as in any page, and bare text sits in the column", async ({ page }) => {
  const id = await opened(page, "Applets/Own more", "html", OWN_MORE, "own-more", "Own more", "A paragraph first");
  try {
    // the paragraph's margin collapses through the body's, as in any page: 32px (2rem) from the top, not 32 + 16
    expect(await frame(page).locator("#first").evaluate((p) => Math.round(p.getBoundingClientRect().top))).toBe(32);
    // its own box keeps the browser's sizing: 300 + 2 × 20 + 2 × 2
    expect(await frame(page).locator("#box").evaluate((b) => Math.round(b.getBoundingClientRect().width))).toBe(344);
  } finally { await api(hubState(), "DELETE", `notes/${id}`); }
  const t = await opened(page, "Applets/Text only", "html", TEXT_ONLY, "text-only", "Text only", "Just a line");
  try {
    expect(await frame(page).locator("body").evaluate((b) => Math.round(b.getBoundingClientRect().left))).toBeGreaterThanOrEqual(14);
  } finally { await api(hubState(), "DELETE", `notes/${t}`); }
});
