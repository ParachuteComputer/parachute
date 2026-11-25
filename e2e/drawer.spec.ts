// A drawer applet from the Uni app runs in Parachute as it is (docs/PARITY.md "Applets from the Uni app's drawer"). The
// Uni app's drawer lists every note tagged `applet` in any vault on the device; a room makes one with uni-ops'
// `applet publish`, which writes `Applets/<Name>`: the HTML, the tag, the contract 2 manifest and (beside it) what it
// opens. Here one is published that way into a vault of the person's own that isn't their home (`pantry`, as Recipes
// lives in its own vault `recipes`), with its seed notes, and the person lists it, allows it, reads a recipe, marks it
// made and edits it (updateNote, each conditioned on what the last answered; a change made elsewhere meanwhile is refused)
// and adds one (createNote; it opens by the id answered), each checked in the vault.
// CI runs e2e/fixtures/drawer (written as the Uni app's are, with the same controls and calls as Recipes). With
// UNI_APPLET_DIR set to an applet folder (applet.html, applet.json, opens.json, seed/), it runs that one: the real
// Recipes from uni-ops, for one.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./test";
import { api, hubState, mintToken } from "./hub";
import { ui } from "./helpers";

test.use({ storageState: "e2e/.signed-in.json" });
const DIR = process.env.UNI_APPLET_DIR || join(import.meta.dirname, "fixtures/drawer");
const VAULT = "pantry";
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

test("a drawer applet from the Uni app, published as uni-ops publishes it in another vault, runs: lists, reads, marks made, adds", async ({ page }) => {
  test.setTimeout(120_000);
  const st = { origin: hubState().origin, token: mintToken(`vault:${VAULT}:write`) };
  const manifest = JSON.parse(readFileSync(join(DIR, "applet.json"), "utf8"));
  const opens = existsSync(join(DIR, "opens.json")) ? JSON.parse(readFileSync(join(DIR, "opens.json"), "utf8")) : undefined;
  const made: string[] = [];
  const add = async (body: Record<string, unknown>) => { const n = await api(st, "POST", "notes", body, VAULT); made.push(n.id); return n; };
  const seeds = readdirSync(join(DIR, "seed")).filter((f) => f.endsWith(".md"));
  try {
    // as `applet publish` writes it (uni-ops bin/applet: the path, html, the tag, the manifest and opens in metadata)
    await add({ path: `Applets/${manifest.name}`, extension: "html", tags: ["applet"], content: readFileSync(join(DIR, "applet.html"), "utf8"), metadata: { applet: manifest, ...(opens ? { opens } : {}) } });
    for (const f of seeds) await add({ path: `Recipes/${f.replace(/\.md$/, "")}`, content: readFileSync(join(DIR, "seed", f), "utf8"), tags: ["recipe"] });

    // listed on the app's own Applets list with the vault it is in, as the Uni app's drawer lists it
    await page.goto(`/v/${VAULT}?with=vault`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: new RegExp(manifest.name) }).click();
    const card = page.getByRole("region", { name: /asking for access/ });
    await expect(card).toContainText("Read, add and change notes in Recipes/");
    await page.getByRole("button", { name: "Allow" }).click();
    const app = page.frameLocator("iframe.applet-frame");
    const note = async (id: string) => String((await api(st, "GET", `notes?id=${id}`, undefined, VAULT)).content);

    // the seeded recipes are listed
    const first = seeds[0].replace(/\.md$/, "");
    for (const f of seeds) await expect(app.getByRole("button", { name: new RegExp(f.replace(/\.md$/, "")) }).first()).toBeVisible({ timeout: 30_000 });
    // one read, then marked made today (updateNote with if_updated_at): the note in the vault says so
    await app.getByRole("button", { name: new RegExp(first) }).first().click();
    await expect(app.getByRole("heading", { name: first, level: 2 })).toBeVisible();
    await app.getByRole("button", { name: "We made this today" }).click();
    await expect(app.getByRole("button", { name: "Made today" })).toBeVisible();
    const id = made[1];
    await expect.poll(() => note(id)).toContain(`- ${today()}`);
    // edited after: the update is conditioned on what the last one answered (its updatedAt), so it goes in
    await app.getByRole("button", { name: "Edit" }).click();
    await app.locator("#f-notes").fill("Good with a poached egg.");
    await app.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => note(id)).toContain("Good with a poached egg.");
    // changed elsewhere meanwhile (another device, an AI): the next edit is refused, in the applet's own words
    const cur = await api(st, "GET", `notes?id=${id}`, undefined, VAULT);
    await api(st, "PATCH", `notes/${id}`, { content: `${cur.content}\nA line from elsewhere.\n`, if_updated_at: cur.updatedAt }, VAULT);
    await app.getByRole("button", { name: "Edit" }).click();
    await app.locator("#f-notes").fill("This one should not land.");
    await app.getByRole("button", { name: "Save", exact: true }).click();
    await expect(app.getByText("It changed elsewhere since you opened it")).toBeVisible();
    expect(await note(id)).not.toContain("This one should not land.");

    // one added: it opens by the id the vault answered with, and is a note under Recipes/
    const back = app.getByRole("button", { name: /All recipes|Back to the recipe/ });
    while (await back.count()) await back.first().click();
    await app.getByRole("button", { name: "Add a recipe" }).click();
    await app.locator("#f-title").fill("Toast with honey");
    await app.locator("#f-ingredients").fill("2 slices bread\n1 spoon honey");
    await app.getByRole("button", { name: "Add to the book" }).click();
    await expect(app.getByRole("heading", { name: "Toast with honey", level: 2 })).toBeVisible();
    await expect.poll(async () => {
      const rows = await api(st, "GET", `notes?path_prefix=${encodeURIComponent("Recipes/")}&limit=50`, undefined, VAULT);
      const n = (Array.isArray(rows) ? rows : rows.notes ?? []).find((r: { path: string }) => r.path === "Recipes/Toast with honey");
      if (n && !made.includes(n.id)) made.push(n.id);
      return n ? note(n.id) : "";
    }, { timeout: 20_000 }).toContain("honey");
  } finally {
    // a leftover Applets/Recipes in pantry would trouble firstrun.spec (it writes one there too): say so if one stays
    for (const id of made.reverse()) await api(st, "DELETE", `notes/${id}`, undefined, VAULT).catch((e) => console.error(`drawer.spec: couldn't delete ${id}: ${e}`));
  }
});
