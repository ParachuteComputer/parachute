// Note links in an applet, drawn by the kit (src/kit/links.tsx, docs/WRITE-AN-APPLET.md "Links"): a test applet whose
// text holds each form. A tap opens the note in the app, where open-with decides (a recipe in the Recipe box, the
// Welcome note in the plain view); a vault name the person doesn't have stays plain text; an address of a vault this
// device doesn't hold leads to the link's screen, which offers to add it.
import { expect, test, type Page } from "@playwright/test";
import { api, hubState, VAULT } from "./hub";
import { expectInVault, ui } from "./helpers";

test.use({ storageState: "e2e/.signed-in.json" });

// the applet on screen (the app keeps one it left running, hidden)
const frame = (page: Page) => page.frameLocator("iframe.applet-frame:visible");
const noteId = async (path: string) => (await api(hubState(), "GET", `notes?id=${encodeURIComponent(path)}`)).id as string;
const chip = async (page: Page, name: RegExp) => {
  await page.goto(`/v/${VAULT}?with=vault`);
  await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name }).click();
};

test("note links in an applet: an address, vault:ULID and a [[wikilink]] open their notes; an unknown vault stays text", async ({ page }) => {
  test.setTimeout(90_000);
  const [toast, welcome] = await Promise.all(["Recipes/Tomato toast", "Welcome"].map(noteId));
  const origin = hubState().origin;
  const away = `https://hub.example/vault/garden/view/${welcome}`;
  const text = `Toast: ${origin}/vault/${VAULT}/view/${toast} · welcome: ${VAULT}:${welcome} · nowhere: nosuch:${welcome} · not there: letters:${welcome} · away: ${away}`;
  const body = "See [[Recipes/Rice and beans]], or [[Nothing by this name]].";
  const code = `import { Linked, Note } from "parachute";
export default function LinkTest() {
  return <main><h1>Link test</h1><p id="said"><Linked web text={${JSON.stringify(text)}} /></p><section id="note"><Note body={${JSON.stringify(body)}} path="Notes/Linking" /></section></main>;
}
`;
  const made = await api(hubState(), "POST", "notes", { path: "Applets/Link test", extension: "tsx", tags: ["applet"], content: code,
    metadata: { applet: { contract: 2, id: "link-test", name: "Link test", glyph: "⌁", access: [{ vault: "here", allow: [{ path: "Recipes/", verbs: ["read"] }] }] }, app: ["open"] } });
  try {
    // the Recipe box, allowed: a recipe opens in it
    await chip(page, /Recipe box/);
    await page.getByRole("button", { name: "Allow" }).click();
    await expect(frame(page).locator("#opened")).toBeVisible();
    await chip(page, /Link test/);
    await expect(page.getByRole("region", { name: /asking for access/ })).toContainText("Take you to a note or an applet when you tap, see which note links lead to a note, and know its vault's web address");
    await page.getByRole("button", { name: "Allow" }).click();
    const said = frame(page).locator("#said");
    await expect(said.getByRole("link", { name: `${VAULT}:${welcome}` })).toBeVisible();
    // a vault name this device doesn't hold, and a held vault without that note: plain text, no guess
    await expect(said).toContainText(`nosuch:${welcome}`);
    await expect(said).toContainText(`letters:${welcome}`);
    await expect(said.getByRole("link")).toHaveCount(3);
    await expect(said.getByRole("link", { name: /nosuch|letters/ })).toHaveCount(0);
    // a wikilink to nothing in the vault is drawn as missing, the other as a link
    await expect(frame(page).locator("#note a", { hasText: "Recipes/Rice and beans" })).toBeVisible();

    // vault:ULID → the Welcome note, in Vault (no applet opens it)
    await said.getByRole("link", { name: `${VAULT}:${welcome}` }).click();
    await expectInVault(page, VAULT, welcome, "Welcome");

    // the note's address → the recipe, in the applet that opens recipes
    await chip(page, /Link test/);
    await frame(page).locator("#said").getByRole("link", { name: new RegExp(`/view/${toast}`) }).click();
    await expect(frame(page).locator("#opened")).toHaveText("Opened: Recipes/Tomato toast");

    // [[wikilink]] inside a note → the note it names, in the same vault
    await chip(page, /Link test/);
    await frame(page).locator("#note a", { hasText: "Recipes/Rice and beans" }).click();
    await expect(frame(page).locator("#opened")).toHaveText("Opened: Recipes/Rice and beans");

    // a long-press (a right-click here) asks with Open with…
    await chip(page, /Link test/);
    await frame(page).locator("#said").getByRole("link", { name: new RegExp(`/view/${toast}`) }).click({ button: "right" });
    await expect(ui(page).getByRole("dialog", { name: "Open with" })).toBeVisible();
    await expect(ui(page).getByRole("dialog", { name: "Open with" })).toContainText("Recipe box");

    // an address of a vault this device doesn't hold: the link's screen, which offers to add it
    await chip(page, /Link test/);
    await frame(page).locator("#said").getByRole("link", { name: away }).click();
    await expect(page.getByRole("alert")).toContainText("This device doesn't hold the garden vault on hub.example");
    await expect(page.getByRole("link", { name: "Add a Parachute" })).toBeVisible();
  } finally { await api(hubState(), "DELETE", `notes/${made.id}`).catch(() => {}); }
});
