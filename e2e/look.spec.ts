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
<style>button.mine { border-radius: 2px; } button#part { letter-spacing: 1px; }</style>
<button class="pa-button mine" id="mine">Mine</button>
<table><thead><tr><th>Seed</th><th>Count</th></tr></thead><tbody><tr><td>Rye</td><td>40</td></tr></tbody></table>
</body></html>`;

const BARE_TSX = `export default function Bare() {
  return <div><h1>Shelf</h1><p>A list with no parts and no styles.</p><button>Add</button></div>;
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
    expect(await style(page, "#part", "letter-spacing")).toBe("1px");
    // the applet's own rule, of lower specificity than the part's, still wins: the kit is in layers below it
    expect(await style(page, "#mine", "border-top-left-radius")).toBe("2px");
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
