// Vault at 5,000 records (opt-in: VIEWER_5000=1; out of CI, it seeds and removes 5,000 records). Seeds five types into
// `pantry` on the e2e hub, then times what a person does: a type of 2,000 opening as a table, the next page as the table
// is scrolled, a sort by a field, a record opened, a search. Writes the times to e2e/.viewer-5000.json, and screenshots
// of the real build (phone, then Mac) to VIEWER_SHOTS when it is set.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { api, hubState, mintToken, record } from "./hub";

const VAULT = "pantry";
const RUN = !!process.env.VIEWER_5000;
const SHOTS = process.env.VIEWER_SHOTS ?? "";
test.use({ storageState: "e2e/.signed-in.json" });
test.skip(!RUN, "opt-in: VIEWER_5000=1");
test.setTimeout(240_000);
const v = (page: Page) => page.frameLocator("iframe.applet-frame");
const w = () => ({ ...hubState(), token: mintToken(`vault:${VAULT}:write`) });
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`) }); };

const TYPES: Record<string, Record<string, unknown>> = {
  task: { status: { type: "string", enum: ["open", "doing", "done"] }, due: { type: "date" }, priority: { type: "integer" }, urgent: { type: "boolean" } },
  book: { author: { type: "string" }, book_status: { type: "string", enum: ["to-read", "reading", "read"] }, rating: { type: "integer" }, finished: { type: "date" } },
  person: { email: { type: "string" }, company: { type: "string" }, met: { type: "date" } },
  meeting: { held_on: { type: "date" }, attendees: { type: "array" } },
  recipe: { servings: { type: "integer" }, cuisine: { type: "string", enum: ["italian", "mexican", "indian", "japanese", "other"] } },
};
const words = ["river", "garden", "lantern", "harbor", "orchard", "meadow", "copper", "willow", "ember", "quarry", "tide", "cedar"];
const names = ["Ada Moss", "Bea Reed", "Cyd Vale", "Dov Hart", "Eli Lark", "Fay Finch", "Gus Rowe", "Hal Shaw"];
const day = (i: number) => new Date(Date.UTC(2026, 0, 1) + (i % 320) * 86400000).toISOString().slice(0, 10);
const pick = <T,>(a: T[], i: number) => a[i % a.length];
function records() {
  const out: Record<string, unknown>[] = [];
  const add = (type: string, n: number, f: (k: number) => Record<string, unknown>) => { for (let k = 0; k < n; k++) out.push({ types: [type], ...f(k) }); };
  add("task", 2000, (k) => ({ path: `Tasks/${pick(words, k)} ${pick(words, k * 7 + 3)} ${k}`, content: `# Task ${k}\n\nFor [[People/${pick(names, k)} ${k % 750}]].`, metadata: { status: pick(["open", "doing", "done"], k), due: day(k), priority: (k % 5) + 1, urgent: k % 9 === 0 } }));
  add("book", 1000, (k) => ({ path: `Books/${pick(words, k)} ${pick(words, k * 5 + 1)} ${k}`, content: "A made-up book.", metadata: { author: pick(names, k * 3), book_status: pick(["to-read", "reading", "read"], k), rating: (k % 5) + 1, ...(k % 3 === 2 ? { finished: day(k) } : {}) } }));
  add("person", 750, (k) => ({ path: `People/${pick(names, k)} ${k}`, content: `Met at the ${pick(words, k)} meetup.`, metadata: { email: `p${k}@example.com`, company: `${pick(words, k * 5)} co`, met: day(k * 3) } }));
  add("meeting", 750, (k) => ({ path: `Meetings/${day(k)} ${pick(words, k)} ${k}`, content: `- about [[Tasks/${pick(words, k)} ${pick(words, k * 7 + 3)} ${k}]]`, metadata: { held_on: day(k), attendees: [pick(names, k), pick(names, k + 1)] } }));
  add("recipe", 500, (k) => ({ path: `Recipes/${pick(words, k)} ${pick(words, k * 11 + 2)} ${k}`, content: "## Ingredients\n- salt", metadata: { servings: (k % 6) + 1, cuisine: pick(["italian", "mexican", "indian", "japanese", "other"], k) } }));
  return out;
}
const made: string[] = [];
// the 5,000 stay in pantry (deleting them takes minutes): the run's throwaway hub goes at teardown with them
async function clean() {
  made.length = 0;
  for (const n of await api(w(), "GET", "notes?path=Applets%2FVault", undefined, "kitchen").catch(() => [])) await api(hubState(), "DELETE", `notes/${n.id}`).catch(() => {});
}

test.beforeAll(async ({}, info) => {
  info.setTimeout(300_000);
  if (!RUN) return;
  const admin = { ...hubState(), token: mintToken(`vault:${VAULT}:admin`) };
  for (const [name, fields] of Object.entries(TYPES)) await api(admin, "PUT", `types/${name}`, { fields }, VAULT);
  const all = records();
  for (let i = 0; i < all.length; i += 100) {
    const r = await api(w(), "POST", "records", { records: all.slice(i, i + 100) }, VAULT);
    for (const x of (r.records ?? r) as { id: string }[]) made.push(x.id);
  }
});
test.afterAll(async ({}, info) => { info.setTimeout(300_000); if (RUN) await clean(); });

async function timed<T>(times: Record<string, number>, name: string, f: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  const out = await f();
  times[name] = Date.now() - t0;
  return out;
}

async function addAllow(page: Page) {
  await page.goto("/vault");
  const add = page.getByRole("button", { name: "Add Vault" }), allow = page.getByRole("button", { name: "Allow" });
  await expect(add.or(allow)).toBeVisible();
  if (await add.isVisible()) await add.click();
  await expect(allow).toBeVisible();
}

test("5,000 records: a type of 2,000 as a table, the next page, a sort, a record, a search", async ({ page, browser }) => {
  expect(made.length).toBe(5000);
  const times: Record<string, number> = {};
  await addAllow(page);
  await shot(page, "phone-01-card");
  await page.getByRole("button", { name: "Allow" }).click();
  await expect(v(page).getByRole("button", { name: /^pantry/ })).toBeVisible();
  await shot(page, "phone-02-vaults");
  await v(page).getByRole("button", { name: /^pantry/ }).click();
  const types = v(page).getByRole("region", { name: "Types" });
  await timed(times, "vault: types with counts", () => expect(types.getByRole("button", { name: /task.*2000/ })).toBeVisible());
  await shot(page, "phone-03-vault");
  await timed(times, "open a type of 2,000: first rows", async () => { await types.getByRole("button", { name: /^task/ }).click(); await expect(v(page).getByRole("table", { name: "task" }).getByRole("row").nth(1)).toBeVisible(); });
  const table = v(page).getByRole("table", { name: "task" });
  await shot(page, "phone-04-table");
  await timed(times, "scroll to the foot: the next 100", async () => {
    await table.getByRole("row").nth(100).scrollIntoViewIfNeeded();
    await expect(table.getByRole("row").nth(150)).toBeAttached();
  });
  await timed(times, "sort by priority (a field the hub sorts)", async () => {
    await table.getByRole("columnheader", { name: "priority" }).getByRole("button").click();
    await expect(table.getByRole("row").nth(1).getByRole("cell").nth(2)).toHaveText("1");
    await table.getByRole("columnheader", { name: "priority" }).getByRole("button").click();
    await expect(table.getByRole("row").nth(1).getByRole("cell").nth(2)).toHaveText("5");
  });
  await timed(times, "open a record", async () => { await table.getByRole("rowheader").nth(3).getByRole("button").click(); await expect(v(page).getByRole("article")).toBeVisible(); await expect(v(page).getByText("Fields")).toBeVisible(); });
  await shot(page, "phone-05-record");
  await v(page).getByRole("button", { name: /Close/ }).click();
  await timed(times, "search in the type", async () => { await v(page).getByLabel("Search task").first().fill("willow ember"); await expect(table.getByRole("row").nth(1)).toContainText("willow"); });
  writeFileSync(join(import.meta.dirname, ".viewer-5000.json"), JSON.stringify({ records: made.length, at: new Date().toISOString(), ms: times }, null, 2));
  console.log("viewer-5000", JSON.stringify(times));

  if (!SHOTS) return;
  // the same at a Mac's size, a desktop browser of its own (its own Allow)
  const mac = await browser.newContext({ storageState: "e2e/.signed-in.json", viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, baseURL: test.info().project.use.baseURL });
  const m = await mac.newPage();
  try {
    await addAllow(m);
    await m.getByRole("button", { name: "Allow" }).click();
    await v(m).getByRole("button", { name: /^pantry/ }).click();
    await expect(v(m).getByRole("region", { name: "Types" })).toBeVisible();
    await shot(m, "mac-01-vault");
    await v(m).getByRole("region", { name: "Types" }).getByRole("button", { name: /^task/ }).click();
    const t = v(m).getByRole("table", { name: "task" });
    await expect(t.getByRole("row").nth(1)).toBeVisible();
    await shot(m, "mac-02-table");
    await t.getByRole("columnheader", { name: "priority" }).getByRole("button").click();
    await t.getByRole("columnheader", { name: "priority" }).getByRole("button").click();
    await expect(t.getByRole("row").nth(1).getByRole("cell").nth(2)).toHaveText("5");
    await shot(m, "mac-03-sorted");
    // filter by a field's value, then group by another
    await v(m).getByRole("button", { name: /^Filter/ }).click();
    await v(m).getByRole("definition").filter({ has: v(m).locator("select") }).first().locator("select").selectOption("open");
    await expect(t.getByRole("row").nth(1)).toContainText("open");
    await shot(m, "mac-03b-filtered");
    await v(m).getByRole("button", { name: /^Filter/ }).click();
    await v(m).getByRole("button", { name: /^Group/ }).click();
    await v(m).locator(".chips.group").getByRole("button", { name: "urgent" }).click();
    await expect(t.getByRole("row").filter({ hasText: /^no/ }).first()).toBeVisible();
    await shot(m, "mac-03c-grouped");
    await v(m).locator(".chips.group").getByRole("button", { name: "No groups" }).click();
    await v(m).getByRole("button", { name: /^Group/ }).click();
    await v(m).getByRole("button", { name: /^Filter/ }).click();
    await v(m).getByRole("definition").filter({ has: v(m).locator("select") }).first().locator("select").selectOption("");
    await v(m).getByRole("button", { name: /^Filter/ }).click();
    await t.getByRole("columnheader", { name: "priority" }).getByRole("button").click();
    await t.getByRole("columnheader", { name: "priority" }).getByRole("button").click();
    await expect(t.getByRole("row").nth(1).getByRole("cell").nth(2)).toHaveText("5");
    // the first row (priority 5, willow orchard 1999) is "doing": the shot after shows it "done"
    await t.getByRole("rowheader").nth(0).getByRole("button").click();
    const rec = v(m).getByRole("article");
    await expect(rec.getByText("Fields")).toBeVisible();
    await expect(rec.getByLabel("status")).toHaveValue("doing");
    await shot(m, "mac-04-record");
    await rec.getByLabel("status").selectOption("done");
    await expect(v(m).getByText(/Saved|done/).first()).toBeVisible();
    await m.waitForTimeout(600);
    await shot(m, "mac-05-field-changed");
    // an AI writes a task over MCP: it lands at the top of the table, no reload
    await record(w(), "create", { path: "Tasks/Call the plumber (from Claude)", body: "Claude wrote this.", types: ["task"], fields: { status: "open", priority: 5, due: "2026-11-21", urgent: true } }, VAULT);
    const [ai] = await api(w(), "GET", `notes?path=${encodeURIComponent("Tasks/Call the plumber (from Claude)")}`, undefined, VAULT);
    made.push(ai.id);
    await expect(t.getByRole("button", { name: "Open Call the plumber (from Claude)" })).toBeVisible({ timeout: 15_000 });
    await shot(m, "mac-06-ai-wrote");
    // a record no other applet opens, tapped anywhere in the app, opens here
    await m.goto(`/v/${VAULT}/n/${made[7]}`);
    await m.getByRole("button", { name: "Open Vault" }).click();
    await expect(v(m).getByRole("article")).toBeVisible();
    await shot(m, "mac-07-opened-here");
    // Sharing
    await m.goto(`/v/${VAULT}`);
    await m.getByRole("button", { name: "Open Vault" }).click();
    await v(m).getByRole("button", { name: "Sharing" }).click();
    await expect(v(m).getByText("Your AI")).toBeVisible();
    await shot(m, "mac-08-sharing");
  } finally { await mac.close(); }
});
