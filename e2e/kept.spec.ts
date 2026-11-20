// Applets kept running while the person is elsewhere (src/shell/kept.tsx): back to one is the same running frame, at
// once; hidden, it is told so and gets no tap; shown again, its note is read again, so changed code asks on the card.
import { expect, test, type Page } from "@playwright/test";
import { api, hubState, record, VAULT } from "./hub";
import { fromAppletMenu, ui } from "./helpers";

test.use({ storageState: "e2e/.signed-in.json" });
const frame = (page: Page) => page.frameLocator("iframe.applet-frame:visible");

// It says when it booted (a new frame boots again), each time it was hidden or shown, and what a call that needs a tap
// gets while it is hidden.
const CODE = `import { useEffect, useState } from "react";
import { app, onShown } from "parachute";
const booted = Math.random().toString(36).slice(2, 8);
export default function Kept() {
  const [seen, setSeen] = useState<string[]>([]);
  useEffect(() => onShown((on: boolean) => {
    setSeen((s) => [...s, on ? "shown" : "hidden"]);
    if (!on) Promise.resolve(app.open("/v/" + "x" + "/a/" + "y")).then((r: unknown) => setSeen((s) => [...s, "open while hidden: " + String(r)]), () => setSeen((s) => [...s, "open while hidden: refused"]));
  }), []);
  return <main><h1>Kept</h1><p id="booted">Booted {booted}</p><p id="seen">{seen.join(", ")}</p></main>;
}
`;
const ARGS = { path: "Applets/Kept", extension: "tsx", tags: ["applet"], body: CODE,
  fields: { applet: { contract: 2, id: "kept", name: "Kept", glyph: "◇", note: "a test applet", access: [] }, app: ["open"] } };
const OTHER = { ...ARGS, path: "Applets/Kept too", body: CODE.replace("<h1>Kept</h1>", "<h1>Kept too</h1>"), fields: { ...ARGS.fields, applet: { ...ARGS.fields.applet, id: "kept-too", name: "Kept too" } } };
const openChip = async (page: Page, name: RegExp) => {
  await page.goto(`/v/${VAULT}`);
  await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name }).click();
};

test("an applet left for another screen keeps running hidden, and is the same frame when the person comes back", async ({ page }) => {
  const note = await record(hubState(), "create", ARGS);
  try {
    await page.goto(`/v/${VAULT}`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Kept/ }).click();
    await page.getByRole("button", { name: "Allow" }).click();
    const booted = (await frame(page).locator("#booted").textContent())!;
    const own = page.url();
    expect(booted).toMatch(/^Booted \w+$/);

    // elsewhere in the app (the bar's Launcher): its frame stays, hidden; it is told, and a tap-only call is refused
    await page.getByRole("navigation", { name: "Bar" }).getByRole("link", { name: "Applets" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("iframe.applet-frame")).toHaveCount(1);
    await expect(page.locator("iframe.applet-frame")).toBeHidden();

    // back: the same frame (not booted again), shown at once, and it heard both changes
    await page.goBack();
    await expect(frame(page).locator("#booted")).toHaveText(booted, { timeout: 1_000 });
    await expect(frame(page).locator("#seen")).toHaveText("hidden, open while hidden: false, shown");
    await expect(page).toHaveURL(own); // still the applet's own address: what it tried to open while hidden didn't

    // its code changes while it is kept: shown again, the card asks before the new code runs
    await page.getByRole("navigation", { name: "Bar" }).getByRole("link", { name: "Applets" }).click();
    const cur = await api(hubState(), "GET", `notes?id=${note.id}`);
    await record(hubState(), "update", { id: note.id, body: CODE.replace("<h1>Kept</h1>", "<h1>Kept, changed</h1>"), if_updated_at: cur.updatedAt });
    await page.goBack();
    await expect(page.getByText("code changed since you allowed it")).toBeVisible();
    await expect(page.locator("iframe.applet-frame")).toHaveCount(0);
    await page.getByRole("button", { name: "Allow this version" }).click();
    await expect(frame(page).getByRole("heading", { name: "Kept, changed" })).toBeVisible();
  } finally {
    await api(hubState(), "DELETE", `notes/${note.id}`);
  }
});

test("an applet that is stopped or asking is not kept: back to it is as before", async ({ page }) => {
  const note = await record(hubState(), "create", ARGS);
  try {
    await page.goto(`/v/${VAULT}`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Kept/ }).click();
    await expect(page.getByRole("region", { name: /asking for access/ })).toBeVisible();
    await page.getByRole("navigation", { name: "Bar" }).getByRole("link", { name: "Applets" }).click();
    await expect(page.locator("iframe.applet-frame")).toHaveCount(0);
    await expect(page.locator(".kept-applet")).toHaveCount(0);
    // allowed and then stopped: it goes when the person leaves, and back is the stopped screen
    await page.goBack();
    await page.getByRole("button", { name: "Allow" }).click();
    await expect(frame(page).locator("#booted")).toBeVisible();
    await fromAppletMenu(page, "Stop");
    await page.getByRole("navigation", { name: "Bar" }).getByRole("link", { name: "Applets" }).click();
    await expect(page.locator("iframe.applet-frame")).toHaveCount(0);
    await page.goBack();
    await expect(page.getByText("Kept is stopped.")).toBeVisible();
  } finally {
    await api(hubState(), "DELETE", `notes/${note.id}`);
  }
});

test("two applets kept: back and forth between them, each is the frame it was, booted once", async ({ page }) => {
  const a = await record(hubState(), "create", ARGS), b = await record(hubState(), "create", OTHER);
  try {
    // A allowed (then left, kept), B allowed; in-app moves only from here (a reload would start everything again)
    await openChip(page, /Kept(?! too)/);
    await page.getByRole("button", { name: "Allow" }).click();
    const bootA = (await frame(page).locator("#booted").textContent())!;
    const atA = page.url();
    await page.goBack();
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Kept too/ }).click();
    await page.getByRole("button", { name: "Allow" }).click();
    await expect(frame(page).getByRole("heading", { name: "Kept too" })).toBeVisible();
    const bootB = (await frame(page).locator("#booted").textContent())!;
    await expect(page.locator("iframe.applet-frame")).toHaveCount(2);
    // back to A, then to B again, by their chips: neither frame is loaded again (moving a frame in the page would reload it)
    const chip = (name: RegExp) => ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name });
    await page.goBack();
    await chip(/Kept(?! too)/).click();
    await expect(page).toHaveURL(atA);
    await expect(frame(page).locator("#booted")).toHaveText(bootA, { timeout: 1_000 });
    await page.goBack();
    await chip(/Kept too/).click();
    await expect(frame(page).locator("#booted")).toHaveText(bootB, { timeout: 1_000 });
    await expect(frame(page).locator("#seen")).toHaveText("hidden, open while hidden: false, shown");
  } finally {
    await api(hubState(), "DELETE", `notes/${a.id}`);
    await api(hubState(), "DELETE", `notes/${b.id}`);
  }
});
