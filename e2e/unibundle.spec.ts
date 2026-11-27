// A bundle of the person's own that takes Vault from Parachute (T-476, Aaron's switch): his `uni` bundle has its own
// Home and Journal, so it names Vault alone (`publishers: [{ url, applets: ["vault"] }]`, docs/design/PARACHUTE-SOURCE.md).
// scripts/install-applets.ts --parachute vault writes that; the list then offers Vault and none of Parachute's others,
// and each form of note link Uni writes in chat (`<vault>:<ULID>`, the old web app's address, its path with no hub)
// opens the note in Vault instead of the plain view.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "./test";
import { clearBarAndHome, expectInVault, ui } from "./helpers";
import { api, hubState, VAULT } from "./hub";

test.use({ storageState: "e2e/.signed-in.json" });
test.afterEach(clearBarAndHome);

const PUBLISHER = "https://parachute.computer/applets/";
type Row = { id: string; path: string; metadata: Record<string, any> };
const tagged = async (tag: string) => { const r = await api(hubState(), "GET", `notes?tag=${tag}&include_metadata=true`); return (Array.isArray(r) ? r : r.notes ?? []) as Row[]; };
const frame = (page: Page) => page.frameLocator("iframe.applet-frame:visible");
function install(...more: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "install-applets-"));
  writeFileSync(join(dir, "token"), hubState().token);
  return execFileSync("node", ["scripts/install-applets.ts", "--hub", hubState().origin, "--vault", VAULT, "--token-file", join(dir, "token"), ...more]).toString();
}

test("install-applets --parachute vault: the person's own bundle offers Vault alone, and Uni's note links open in it", async ({ page }) => {
  test.setTimeout(120_000);
  // as apply.sh runs it for Aaron: his own bundle over every vault on his hub, plus Vault from Parachute
  const uni = ["--bundle", "uni", "--bundle-name", "Uni", "--source", "*", "--parachute", "vault"];
  expect(install(...uni)).toContain("Nothing written");
  expect(await tagged("parachute-app")).toEqual([]);
  expect(install(...uni, "--apply")).toContain(`"publishers":[{"url":"${PUBLISHER}","applets":["vault"]}]`);
  const [rec] = await tagged("parachute-app");
  expect(rec.metadata.app.publishers).toEqual([{ url: PUBLISHER, applets: ["vault"] }]);
  expect(install(...uni, "--apply")).toContain("bundle uni: unchanged");
  // the names given replace the record's (given twice, they add up, in the app's order); `none` starts over, and alone
  // takes Parachute's own out
  expect(install("--bundle", "uni", "--parachute", "connect", "--parachute", "vault", "--apply")).toContain(`"applets":["vault","connect"]`);
  expect(install("--bundle", "uni", "--parachute", "connect", "--parachute", "none", "--apply")).toContain(`"publishers":[]`);
  expect(install(...uni, "--apply")).toContain(`"applets":["vault"]`);
  expect(() => install("--bundle", "uni", "--parachute", "prism")).toThrow(/--parachute is all, none, or names from notes, journal, capture, vault, connect, home \(not prism\)/);

  const welcome = (await api(hubState(), "GET", `notes?id=Welcome`)).id as string;
  const origin = hubState().origin;
  const text = `short: ${VAULT}:${welcome} · web: ${origin}/surface/parachute/v/${VAULT}/n/${welcome}/ · path: /surface/parachute/v/${VAULT}/n/${welcome}`;
  const code = `import { Linked } from "parachute";
export default function UniSays() { return <main><h1>Uni says</h1><p id="said"><Linked web text={${JSON.stringify(text)}} /></p></main>; }
`;
  const made = await api(hubState(), "POST", "notes", { path: "Applets/Uni says", extension: "tsx", tags: ["applet"], content: code,
    metadata: { applet: { contract: 2, id: "uni-says", name: "Uni says", glyph: "⌁" }, app: ["open"] } });
  try {
    await page.goto("about:blank"); await page.goto("/");
    // the list: Vault from Parachute, and none of its others (the person's own Home and Journal stand alone)
    const list = ui(page).getByRole("list", { name: "Applets" });
    await expect(list.getByRole("link", { name: /Uni says/ })).toBeVisible();
    await expect(list.getByRole("link", { name: /^▦?\s*Vault/ })).toBeVisible();
    for (const name of [/^.?\s*Notes\b/, /^.?\s*Capture\b/, /^.?\s*Journal\b/]) await expect(list.getByRole("link", { name })).toHaveCount(0);

    for (const [i, link] of [`${VAULT}:${welcome}`, `${origin}/surface/parachute/v/${VAULT}/n/${welcome}/`, `/surface/parachute/v/${VAULT}/n/${welcome}`].entries()) {
      await page.goto("about:blank"); await page.goto("/");
      await list.getByRole("link", { name: /Uni says/ }).click();
      if (i === 0) await page.getByRole("button", { name: "Allow" }).click();
      await frame(page).locator("#said").getByRole("link", { name: link, exact: true }).click();
      await expectInVault(page, VAULT, welcome, "Welcome");
    }
  } finally { await api(hubState(), "DELETE", `notes/${made.id}`).catch(() => {}); }
});
