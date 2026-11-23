// An applet with a screen of its own holds Back (the kit's onBack, src/applet/modules/back.ts): the app's Back (the bar's
// ‹, and a phone's Back, which is the browser's) closes that screen first, and the person stays in the applet; with
// none open, Back leaves as before.
import { expect, test, type Page } from "@playwright/test";
import { api, hubState, record, VAULT } from "./hub";
import { ui } from "./helpers";

test.use({ storageState: "e2e/.signed-in.json" });
const frame = (page: Page) => page.frameLocator("iframe.applet-frame:visible");

const CODE = `import { useEffect, useState } from "react";
import { onBack } from "parachute";
export default function Layers() {
  const [open, setOpen] = useState(null);
  // while a screen of its own is open, Back closes it
  useEffect(() => (open ? onBack(() => setOpen(null)) : undefined), [open]);
  if (open) return <main><h1>{open}</h1><button onClick={() => setOpen(null)}>Close</button></main>;
  return <main><h1>Layers</h1>{["Plum", "Quince"].map((x) => <button key={x} onClick={() => setOpen(x)}>{x}</button>)}</main>;
}
`;
const ARGS = { path: "Applets/Layers", extension: "tsx", tags: ["applet"], body: CODE,
  fields: { applet: { contract: 2, id: "layers", name: "Layers", glyph: "◇", note: "a test applet", access: [{ vault: "here", allow: [{ path: "Layers/", verbs: ["read"] }] }] } } };

test("Back closes an applet's own screen first, then leaves it", async ({ page }) => {
  const note = await record(hubState(), "create", ARGS) as { id: string };
  try {
    await page.goto(`/v/${VAULT}?with=vault`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Layers/ }).click();
    await page.getByRole("button", { name: "Allow" }).click();
    const f = frame(page);
    const at = page.url();
    await f.getByRole("button", { name: "Plum" }).click();
    await expect(f.getByRole("heading", { name: "Plum" })).toBeVisible();
    // the bar's Back: the applet's screen closes, the person stays
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(f.getByRole("heading", { name: "Layers" })).toBeVisible();
    expect(page.url()).toBe(at);
    // a phone's Back (the browser's): the same
    await f.getByRole("button", { name: "Quince" }).click();
    await expect(f.getByRole("heading", { name: "Quince" })).toBeVisible();
    await page.goBack();
    await expect(f.getByRole("heading", { name: "Layers" })).toBeVisible();
    expect(page.url()).toBe(at);
    // closed from inside: the entry it held goes, so one Back leaves
    await f.getByRole("button", { name: "Plum" }).click();
    await f.getByRole("button", { name: "Close" }).click();
    await expect(f.getByRole("heading", { name: "Layers" })).toBeVisible();
    // nothing of its own open: Back leaves the applet
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page).not.toHaveURL(at);
    await expect(ui(page).getByRole("list", { name: "Applets" })).toBeVisible();
  } finally {
    await api(hubState(), "DELETE", `notes/${note.id}`);
  }
});
