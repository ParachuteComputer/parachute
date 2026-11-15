// An applet written the way a chat AI with the Parachute MCP writes one: one `create-note` call, with the arguments
// from docs/WRITE-AN-APPLET.md, and nothing else. The app then shows it, asks, transpiles and runs it.
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { api, hubState, mcp, VAULT } from "./hub";

const guide = readFileSync(new URL("../docs/WRITE-AN-APPLET.md", import.meta.url), "utf8");
const example = guide.slice(guide.indexOf("## A worked example"));
/** The create-note arguments exactly as the guide gives them. */
const ARGS = JSON.parse(example.match(/```json\n([\s\S]*?)\n```/)![1]) as { path: string; content: string; metadata: Record<string, unknown> } & Record<string, unknown>;
const LAID_OUT = example.match(/```tsx\n([\s\S]*?)```/)![1];
const frame = (page: Page) => page.frameLocator("iframe.applet-frame");

test.use({ storageState: "e2e/.signed-in.json" });

async function written(args: Record<string, unknown>, run: (id: string) => Promise<void>) {
  const note = await mcp(hubState(), "create-note", args);
  try { await run(note.id as string); } finally { await api(hubState(), "DELETE", `notes/${note.id}`); }
}
const openChip = async (page: Page, name: RegExp) => {
  await page.goto(`/v/${VAULT}`);
  await page.getByRole("list", { name: "Applets" }).getByRole("link", { name }).click();
};

test("the guide's worked example is the code it lays out", () => {
  expect(ARGS.content).toBe(LAID_OUT);
});

test("a TSX applet written with one MCP create-note call shows, asks, and runs after Allow", async ({ page }) => {
  await written(ARGS, async (id) => {
    await openChip(page, /Recipe cards/);
    const card = page.getByRole("region", { name: /asking for access/ });
    await expect(card).toContainText("Read and add notes in Recipes/");
    await expect(card).toContainText("Open recipe notes in Recipes/ when you tap one");
    await expect(page.locator("iframe")).toHaveCount(0);
    await page.getByRole("button", { name: "Allow" }).click();
    await expect(frame(page).getByRole("heading", { name: "Recipe cards" })).toBeVisible();
    // its React state, filled from the vault through the kit
    await expect(frame(page).getByRole("listitem")).toHaveCount(2);
    expect((await frame(page).getByRole("listitem").allTextContents()).sort()).toEqual(["Rice and beans", "Tomato toast"]);

    // the code changes (one update-note call): the card shows again before the new version runs
    const cur = await api(hubState(), "GET", `notes?id=${id}`);
    await mcp(hubState(), "update-note", { id, content: ARGS.content.replace("<h1>Recipe cards</h1>", "<h1>Recipe cards, changed</h1>"), if_updated_at: cur.updatedAt });
    await openChip(page, /Recipe cards/);
    await expect(page.getByText("code changed since you allowed it")).toBeVisible();
    await expect(page.locator("iframe")).toHaveCount(0);
    await page.getByRole("button", { name: "Allow this version" }).click();
    await expect(frame(page).getByRole("heading", { name: "Recipe cards, changed" })).toBeVisible();
  });
});

test("TSX that doesn't compile is refused with the reason, and nothing runs", async ({ page }) => {
  const args = { ...ARGS, path: "Applets/Broken", metadata: { applet: { ...(ARGS.metadata.applet as object), id: "broken", name: "Broken" } }, content: "export default function App() { return <p>; }" };
  await written(args, async () => {
    await openChip(page, /Broken/);
    await expect(page.getByRole("alert")).toContainText("its code doesn't compile");
    await expect(page.getByRole("button", { name: "Allow" })).toHaveCount(0);
    await expect(page.locator("iframe")).toHaveCount(0);
  });
});

test("an import the app doesn't provide stops the applet with one line saying so", async ({ page }) => {
  const args = { ...ARGS, path: "Applets/Imports", metadata: { applet: { ...(ARGS.metadata.applet as object), id: "imports", name: "Imports" } }, content: 'import _ from "lodash";\nexport default () => <p>{_.now()}</p>;' };
  await written(args, async () => {
    await openChip(page, /Imports/);
    await page.getByRole("button", { name: "Allow" }).click();
    await expect(frame(page).locator(".parachute-error")).toHaveText(/it imports lodash, and an applet can import only react, .*parachute/);
  });
});
