// A React project of several files (e2e/fixtures/bundled: a context, two views, a helper, the npm package `ms`), made
// into one record by scripts/bundle-applet.ts's bundler, runs in the sealed frame against a real hub.
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "./test";
import { bundleApplet } from "../src/applet/bundle";
import { api, hubState, record, VAULT } from "./hub";
import { ui } from "./helpers";

test.use({ storageState: "e2e/.signed-in.json" });
const frame = (page: Page) => page.frameLocator("iframe.applet-frame:visible");
const DIR = new URL("./fixtures/bundled/", import.meta.url);

test("a project of several files, bundled into one record, runs as an applet", async ({ page }) => {
  const built = await bundleApplet(new URL("src/main.tsx", DIR).pathname);
  if (!built.ok) throw new Error(built.errors.join("\n"));
  const meta = JSON.parse(readFileSync(new URL("applet.json", DIR), "utf8"));
  const made: string[] = [];
  try {
    made.push((await api(hubState(), "POST", "notes", { path: "Shelf/The Overstory", content: "a novel" })).id);
    made.push(((await record(hubState(), "create", { path: meta.path, extension: "jsx", tags: meta.tags, fields: meta.fields, body: built.code })) as { id: string }).id);
    await page.goto(`/v/${VAULT}?with=vault`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Shelf/ }).click();
    await page.getByRole("button", { name: "Allow" }).click();
    const f = frame(page);
    await expect(f.getByRole("region", { name: /Books · 1/ })).toContainText("The Overstory");
    await f.getByRole("button", { name: "About" }).click();
    await expect(f.getByText("A loan runs 14 days.")).toBeVisible();
  } finally {
    for (const id of made) await api(hubState(), "DELETE", `notes/${id}`).catch(() => {});
  }
});
