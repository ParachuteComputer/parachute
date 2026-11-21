// The record door (src/vault/records.ts): on a hub that has `/api/records` (core 0.9) the app reads and writes there
// and never on `/api/notes`; on one without it (0.8) it asks once and keeps `/api/notes`. CI runs this on both.
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { api, hubState, mintToken, VAULT } from "./hub";
import { ui } from "./helpers";

test.use({ storageState: "e2e/.signed-in.json" });

const hasDoor = async () => (await fetch(`${hubState().origin}/vault/${VAULT}/api/records?limit=1`, { headers: { authorization: `Bearer ${hubState().token}` } })).status === 200;
function watch(page: Page) {
  const calls: string[] = [];
  page.on("request", (r) => { const u = new URL(r.url()); const p = `/vault/${VAULT}/api/`; if (u.pathname.startsWith(p)) calls.push(u.pathname.slice(p.length - 1) + (u.searchParams.get("limit") === "1" && u.searchParams.size === 1 ? "?limit=1" : "")); });
  return calls;
}
async function readANote(page: Page) {
  await page.goto(`/v/${VAULT}`);
  await ui(page).getByRole("list", { name: /Notes/ }).getByRole("link", { name: /^Tomato toast/ }).click();
  await expect(ui(page).locator(".prose-note h1")).toHaveText("Tomato toast");
}

test("the app goes through the record door where the hub has one, and asks once per vault", async ({ page }) => {
  const door = await hasDoor();
  const calls = watch(page);
  // a vault found to have the door is remembered on the device (T-476): it is then never asked again (the start the
  // tests share remembers it, on a hub with the door)
  const kept = JSON.parse(readFileSync("e2e/.signed-in.json", "utf8")) as { origins: { localStorage: { name: string; value: string }[] }[] };
  const doors = kept.origins.flatMap((o) => o.localStorage).find((x) => x.name === "parachute.doors.v1")?.value ?? "{}";
  const remembered = Object.keys(JSON.parse(doors)).some((k) => k.includes(`/vault/${VAULT}/`));
  await readANote(page);
  const probes = calls.filter((c) => c === "/records?limit=1");
  expect(probes).toHaveLength(remembered ? 0 : 1);
  if (door) {
    expect(calls.filter((c) => c.startsWith("/notes"))).toEqual([]);
    expect(calls.filter((c) => c.startsWith("/records") && c !== "/records?limit=1").length).toBeGreaterThan(0);
  } else {
    expect(calls.filter((c) => c.startsWith("/records") && c !== "/records?limit=1")).toEqual([]);
    expect(calls.filter((c) => c.startsWith("/notes")).length).toBeGreaterThan(0);
  }
});

// It leaves `applet` and `recipe` as types for the specs after it (one worker, in order): they run on a vault whose
// owner made them types, which is the case this guards.
test("a tag that becomes a type (the door lists it under types, not tags) still finds applets and opens notes in them", async ({ page }) => {
  test.skip(!(await hasDoor()), "only a hub with the record door has types");
  const admin = mintToken(`vault:${VAULT}:admin`);
  for (const tag of ["applet", "recipe"]) {
    const r = await fetch(`${hubState().origin}/vault/${VAULT}/api/tags/${tag}`, { method: "PUT", headers: { authorization: `Bearer ${admin}`, "content-type": "application/json" }, body: JSON.stringify({ fields: { note: { type: "string" } } }) });
    expect((await r.json()).kind).toBe("type");
  }
  await page.goto(`/v/${VAULT}`);
  await expect(ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Recipe box/ })).toBeVisible();
  await readANote(page);
  await expect(ui(page).locator(".open-line")).toContainText("Cook mode or Recipe box can open this.");
  // a note an applet adds is written with its type where the door wants it (types, not tags)
  await page.goto(`/v/${VAULT}`);
  await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Recipe box/ }).click();
  await page.getByRole("button", { name: "Allow" }).click();
  const applet = page.frameLocator("iframe.applet-frame");
  await applet.getByRole("button", { name: "Add a recipe" }).click();
  await expect(applet.locator("#said")).toContainText("added Recipes/Added");
  const path = (await applet.locator("#said").textContent())!.replace("added ", "");
  const note = await api(hubState(), "GET", `notes?id=${encodeURIComponent(path)}`);
  expect(note.types).toEqual(["recipe"]);
  await api(hubState(), "DELETE", `notes/${note.id}`);
});
