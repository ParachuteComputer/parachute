// A section of Settings from an applet (src/views/BundleSections.tsx, docs/WRITE-AN-APPLET.md "A section of Settings"):
// the shell's heading, then the named screen in a small frame that reads what the card allowed and changes nothing;
// nothing runs there before the person allowed the applet, or after its code changed.
// Aaron, 11-22: "it was easy to see Claude usage in settings. I wonder about being able to add things into settings
// within an app bundle more directly, just for small things".
import { expect, test, type Page } from "@playwright/test";
import { api, hubState, record, VAULT } from "./hub";
import { ui } from "./helpers";

test.use({ storageState: "e2e/.signed-in.json" });

// It says where it runs (`ready().place`, `screen`), what it read, and whether a write went through.
const CODE = `import { useEffect, useState } from "react";
import { ready, vault } from "parachute";
export default function Use() {
  const [where, setWhere] = useState(""); const [read, setRead] = useState(""); const [wrote, setWrote] = useState("");
  useEffect(() => { ready().then(async (r: any) => {
    setWhere(r.place === "settings" ? "In Settings at " + r.screen : "On its own screen");
    const n = await vault.getRecord("Uses/Today"); setRead(n.body);
    try { await vault.createRecord({ path: "Uses/Wrote " + Date.now(), body: "x" }); setWrote("wrote"); } catch { setWrote("not written"); }
  }); }, []);
  return <main><h1 id="where">{where}</h1><p id="read">{read}</p><p id="wrote">{wrote}</p><div style={{ height: 300 }} /><button id="leave" onClick={() => { location.href = "https://example.com/"; }}>Leave</button></main>;
}
`;
const ARGS = { path: "Applets/Use", extension: "tsx", tags: ["applet"], body: CODE,
  fields: { applet: { contract: 2, id: "use", name: "Use", glyph: "◔", note: "a test applet", access: [{ vault: "here", allow: [{ path: "Uses/", verbs: ["read", "create"] }] }],
    screens: [{ id: "home", name: "Use" }, { id: "short", name: "Use, in short" }] }, settings: { name: "How much is used", screen: "short" } } };
const section = (page: Page) => page.getByRole("region", { name: "How much is used" });
// another applet with a section, allowed first: once its section shows, the vault's applets have been read
const CONTROL = { path: "Applets/Glance", extension: "tsx", tags: ["applet"], body: "export default function G() { return <main><p id=\"g\">glance</p></main>; }\n",
  fields: { applet: { contract: 2, id: "glance", name: "Glance", glyph: "◇", note: "a test applet", access: [], screens: [{ id: "home", name: "Glance" }] }, settings: { name: "A glance", screen: "home" } } };
const inSection = (page: Page) => section(page).frameLocator("iframe");

test("an applet's section of Settings: asks first, then reads what it was allowed and changes nothing; changed code stops it", async ({ page }) => {
  const used = await record(hubState(), "create", { path: "Uses/Today", extension: "md", body: "41% of the week" });
  const note = await record(hubState(), "create", ARGS);
  const control = await record(hubState(), "create", CONTROL);
  try {
    await page.goto(`/v/${VAULT}?with=vault`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Glance/ }).click();
    await page.getByRole("button", { name: "Allow" }).click();
    // not allowed yet: Settings draws nothing of it, not its heading either (anything that writes the vault could
    // otherwise put a heading in Settings)
    await page.goto("/settings");
    await expect(page.getByRole("region", { name: "A glance" }).frameLocator("iframe").locator("#g")).toHaveText("glance");
    await expect(page.getByRole("heading", { name: "How much is used" })).toHaveCount(0);

    // its card says the section once; Allow on its own screen
    await page.goto(`/v/${VAULT}?with=vault`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /^Use/ }).click();
    await expect(page.getByText("Show a section in Settings", { exact: true })).toHaveCount(1);
    await expect(page.getByText("Shows a section in Settings, «How much is used» (its screen short): what it reads, nothing it changes.")).toBeVisible();
    await page.getByRole("button", { name: "Allow" }).click();
    const own = page.frameLocator("iframe.applet-frame:visible");
    await expect(own.locator("#where")).toHaveText("On its own screen");
    await expect(own.locator("#wrote")).toHaveText("wrote");

    // in Settings: the screen it named, what it read, and no write
    await page.goto("/settings");
    await expect(inSection(page).locator("#where")).toHaveText("In Settings at short");
    await expect(inSection(page).locator("#read")).toHaveText("41% of the week");
    await expect(inSection(page).locator("#wrote")).toHaveText("not written");
    // drawn at its content's height, not a page of its own (measured once it is on screen: the last section of Settings)
    await section(page).scrollIntoViewIfNeeded();
    const h = () => section(page).locator("iframe").evaluate((f) => (f as HTMLElement).getBoundingClientRect().height);
    await expect.poll(h).toBeGreaterThan(60);
    expect(await h()).toBeLessThan(640);
    await expect(section(page).getByRole("link", { name: /Use/ }).last()).toHaveAttribute("href", new RegExp(`/v/${VAULT}/a/`));

    // the frame leaves on purpose (it is stopped and drawn as one line): its place in Settings doesn't shrink
    const before = await section(page).evaluate((e) => (e.parentElement as HTMLElement).getBoundingClientRect().height);
    await inSection(page).locator("#leave").click();
    await expect(section(page).locator("iframe")).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(await section(page).evaluate((e) => (e.parentElement as HTMLElement).getBoundingClientRect().height)).toBeGreaterThanOrEqual(before - 1);

    // its code changes (an agent's update): the section goes until it is allowed again
    const cur = await api(hubState(), "GET", `notes?id=${note.id}`);
    await record(hubState(), "update", { id: note.id, body: CODE.replace("On its own screen", "On its own screen, changed"), if_updated_at: cur.updatedAt });
    await page.goto("/settings");
    await expect(page.getByRole("region", { name: "A glance" }).frameLocator("iframe").locator("#g")).toHaveText("glance");
    await expect(section(page)).toHaveCount(0);
  } finally {
    for (const n of (await api(hubState(), "GET", "notes?path_prefix=Uses/&limit=50")) as { id: string }[]) await api(hubState(), "DELETE", `notes/${n.id}`);
    await api(hubState(), "DELETE", `notes/${note.id}`);
    await api(hubState(), "DELETE", `notes/${control.id}`);
    void used;
  }
});
