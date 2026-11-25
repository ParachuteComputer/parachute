// An applet with a screen of its own holds Back (the kit's onBack, src/applet/modules/back.ts): the app's Back (the bar's
// ‹; Android's goes the same way, shell/nativeBack.ts) closes that screen first, and the person stays in the applet;
// with none open, Back leaves as before. It gets one Back for each screen it opened during a tap: one that holds Back
// without being tapped keeps no one in.
import { expect, test, type Page } from "./test";
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
  // a re-read after a moment (no tap) hands the screen a new object: the effect runs again
  useEffect(() => { if (!open || open.again) return; const t = setTimeout(() => setOpen((o) => (o ? { ...o, again: true } : o)), 600); return () => clearTimeout(t); }, [open]);
  if (open) return <main><h1>{open.name}</h1><p>{open.again ? "read again" : "first read"}</p><button onClick={() => setOpen(null)}>Close</button><button onClick={() => setOpen({ name: open.name + " too" })}>Next</button></main>;
  // twenty holds in one tap: one Back for it, not twenty
  const hoard = () => { for (let i = 0; i < 20; i++) onBack(() => {}); };
  return <main><h1>Layers</h1>{["Plum", "Quince"].map((x) => <button key={x} onClick={() => setOpen({ name: x })}>{x}</button>)}<button onClick={hoard}>Hoard</button></main>;
}
`;
// holds Back from the start, with no tap: a trap, if Back obeyed it
const TRAP = `import { useEffect } from "react";
import { onBack } from "parachute";
export default function Trap() {
  useEffect(() => onBack(() => {}), []);
  return <main><h1>Trap</h1></main>;
}
`;
const ARGS = { path: "Applets/Layers", extension: "tsx", tags: ["applet"], body: CODE,
  fields: { applet: { contract: 2, id: "layers", name: "Layers", glyph: "◇", note: "a test applet", access: [{ vault: "here", allow: [{ path: "Layers/", verbs: ["read"] }] }] } } };
const TRAP_ARGS = { path: "Applets/Trap", extension: "tsx", tags: ["applet"], body: TRAP,
  fields: { applet: { contract: 2, id: "trap", name: "Trap", glyph: "◇", note: "a test applet", access: [{ vault: "here", allow: [{ path: "Trap/", verbs: ["read"] }] }] } } };

test("Back closes an applet's own screen first, then leaves it", async ({ page }) => {
  const note = await record(hubState(), "create", ARGS) as { id: string };
  try {
    await page.goto(`/v/${VAULT}?with=vault`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Layers/ }).click();
    await page.getByRole("button", { name: "Allow" }).click();
    const f = frame(page);
    const at = page.url();
    const barBack = () => page.getByRole("button", { name: "Back", exact: true }).click();
    // a screen of its own: the bar's Back closes it, the person stays
    await f.getByRole("button", { name: "Plum" }).click();
    await expect(f.getByRole("heading", { name: "Plum" })).toBeVisible();
    await barBack();
    await expect(f.getByRole("heading", { name: "Layers" })).toBeVisible();
    expect(page.url()).toBe(at);
    // one screen replaced by another (a tap each): Back closes the one showing; closed from inside, nothing is held
    await f.getByRole("button", { name: "Quince" }).click();
    await f.getByRole("button", { name: "Next" }).click();
    await expect(f.getByRole("heading", { name: "Quince too" })).toBeVisible();
    await barBack();
    await expect(f.getByRole("heading", { name: "Layers" })).toBeVisible();
    await f.getByRole("button", { name: "Plum" }).click();
    await f.getByRole("button", { name: "Close" }).click();
    await expect(f.getByRole("heading", { name: "Layers" })).toBeVisible();
    // read again after the tap, the person elsewhere in the app (the frame not focused): it still holds its Back
    await f.getByRole("button", { name: "Plum" }).click();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await expect(f.getByText("read again")).toBeVisible();
    await barBack();
    await expect(f.getByRole("heading", { name: "Layers" })).toBeVisible();
    expect(page.url()).toBe(at);
    // twenty holds in one tap earn one Back: the second leaves
    await f.getByRole("button", { name: "Hoard" }).click();
    await barBack();
    await expect(f.getByRole("heading", { name: "Layers" })).toBeVisible();
    expect(page.url()).toBe(at);
    await barBack();
    await expect(page).not.toHaveURL(at);
    await expect(ui(page).getByRole("list", { name: "Applets" })).toBeVisible();
  } finally {
    await api(hubState(), "DELETE", `notes/${note.id}`);
  }
});

test("an applet that holds Back without a tap keeps no one in", async ({ page }) => {
  const note = await record(hubState(), "create", TRAP_ARGS) as { id: string };
  try {
    await page.goto(`/v/${VAULT}?with=vault`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Trap/ }).click();
    await page.getByRole("button", { name: "Allow" }).click();
    await expect(frame(page).getByRole("heading", { name: "Trap" })).toBeVisible();
    const at = page.url();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page).not.toHaveURL(at);
  } finally {
    await api(hubState(), "DELETE", `notes/${note.id}`);
  }
});
