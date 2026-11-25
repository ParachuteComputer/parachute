// Packs and templates, one closed loop (T-476, docs/PACKS.md), on a real hub: a newcomer taps Add a pack → Core types in
// Vault, and the types, their templates and a saved view land with a receipt; New meeting starts from the meeting
// template; Make this a template makes another; adding the pack again changes nothing; an AI over MCP applying the same
// pack (the docs page's steps, here by the same applier over the MCP tools) leaves the same vault, and the app's Add
// after it changes nothing; a vault with its own `task` type keeps its fields and says so.
// Needs a hub where write access may define a type over REST (core #139); on an older one it skips.
// In its own project, `packs`, after every other: a 403 from the hub (the person's own `task` type; a server before
// #139) makes the app refresh its sign-in, which rotates the saved session's refresh token the other specs share. And
// since the `signs-in` specs retire that saved session, each test here signs in for itself.
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "./test";
import { api, hubState, mcp, mintToken, VAULT } from "./hub";
import { signIn } from "./helpers";
import { applyPack, checkPack, RECEIPTS, receiptRecord, refusalWords, type PackTarget } from "../src/kit/packs";


const PACK = checkPack(JSON.parse(readFileSync(new URL("../src/kit/packs/core-types.json", import.meta.url), "utf8")));
const TYPES = Object.keys(PACK.types);
const FOLDERS = ["Templates/", "Parachute/Views/task/", RECEIPTS, "Meetings/"];
const frame = (page: Page) => page.frameLocator("iframe.applet-frame");
const hub = () => hubState();
const admin = () => ({ ...hub(), token: mintToken(`vault:${VAULT}:admin`) });
const shot = (page: Page, name: string) => (process.env.WALKTHROUGH_DIR ? page.screenshot({ path: `${process.env.WALKTHROUGH_DIR}/${name}.png` }) : Promise.resolve());

/** Does this hub let a write pass define a type over REST (/api/types)? */
async function restTypes(): Promise<boolean> {
  const probe = `packprobe${Date.now()}`;
  const r = await fetch(`${hub().origin}/vault/${VAULT}/api/types/${probe}`, { method: "PUT", headers: { authorization: `Bearer ${hub().token}`, "content-type": "application/json" }, body: JSON.stringify({ kind: "type", fields: { x: { type: "string" } } }) });
  if (r.ok) await api(admin(), "DELETE", `types/${probe}`).catch(() => {});
  return r.ok;
}
async function cleanup() {
  const a = admin();
  for (const f of FOLDERS) for (const n of await api(a, "GET", `notes?path_prefix=${encodeURIComponent(f)}&limit=200`)) await api(a, "DELETE", `notes/${n.id}`).catch(() => {});
  for (const t of [...TYPES, "journal"]) await api(a, "DELETE", `types/${t}`).catch(() => {});
}
/** What the pack touches, as the vault has it, without ids, times or who: two vaults set up alike read the same. */
async function snapshot(times = false) {
  const types = (await api(hub(), "GET", "types?include_schema=true")) as { name: string; kind: string; description: string | null; fields: unknown }[];
  const recs = [];
  for (const f of FOLDERS) for (const r of (await api(hub(), "GET", `records?path_prefix=${encodeURIComponent(f)}&include_fields=true&limit=200`)) as any[]) {
    const fields = r.fields?.receipt ? { receipt: { ...r.fields.receipt, made: { ...r.fields.receipt.made, records: r.fields.receipt.made.records.map((x: any) => (times ? x : x.path)) } } } : r.fields;
    recs.push({ path: r.path, types: r.types, tags: r.tags, fields, body: (await api(hub(), "GET", `records/${r.id}`)).body, ...(times ? { id: r.id, updatedAt: r.updatedAt } : {}) });
  }
  return { types: types.filter((t) => TYPES.includes(t.name)).map(({ name, kind, description, fields }) => ({ name, kind, description, fields })).sort((a, b) => a.name.localeCompare(b.name)),
    records: recs.sort((a, b) => a.path.localeCompare(b.path)) };
}
/** Apply it again from inside the Vault applet's frame, as the applet calls the kit (no button offers it once it is in). */
async function addAgain(page: Page) {
  for (const f of page.frames()) {
    const r = await f.evaluate(async (vault) => {
      const p = (window as any).parachute;
      if (!p?.vaults?.addPack) return null;
      const v = (await p.vaults.list()).find((x: { name: string }) => x.name === vault);
      return p.vaults.addPack(v.key, "core-types");
    }, VAULT).catch(() => null);
    if (r) return r as { changed: boolean; added: string[] };
  }
  throw new Error("no frame with the kit");
}
/** Sign in as the person (the shared saved sign-in is retired by the `signs-in` specs before this project runs), then
 *  Vault, the vault, its Packs. */
async function openPacks(page: Page) {
  await signIn(page);
  await page.goto(`/v/${VAULT}`);
  await expect(page).toHaveURL(/\/a\/parachute%3Avault/);
  const app = frame(page);
  await app.getByRole("button", { name: /^(Add a pack|Packs)$/ }).click({ timeout: 30_000 });
  await expect(app.getByRole("heading", { level: 1, name: "Packs" })).toBeVisible();
  return app;
}
/** An AI applying the pack over MCP with the write access a person grants: list-types, manage-types per type,
 *  create-record with if_exists "ignore" per record, the receipt last (docs: build/templates). */
const overMcp = (state: { origin: string; token: string }): PackTarget => ({
  types: async () => (await mcp(state, "list-types", { include_schema: true })).map((t: any) => ({ ...t, fields: t.fields ?? {} })),
  defineType: async (name, def) => mcp(state, "manage-types", { tag: name, kind: "type", ...def }).then(() => "ok" as const, (e: Error) => {
    if (/With write access you can/.test(e.message)) return { refused: refusalWords(e.message) };
    if (/admin/.test(e.message)) return "unsupported" as const;
    throw e;
  }),
  create: async (r) => { const x = await mcp(state, "create-record", { ...r, if_exists: "ignore" }); return { id: x.id, updatedAt: x.updatedAt ?? x.updated_at ?? null, existed: x.existed === true }; },
  receipt: async (id) => {
    const x = await mcp(state, "query-records", { id: `${RECEIPTS}${id}` }).catch(() => null);
    const r = Array.isArray(x) ? x[0] : x?.records?.[0] ?? x;
    return r?.fields?.receipt ? { receipt: r.fields.receipt, id: r.id, updatedAt: r.updatedAt ?? null } : null;
  },
  writeReceipt: async (r, was) => { const rec = receiptRecord(r); await (was ? mcp(state, "update-record", { id: was.id, fields: rec.fields, body: rec.body }) : mcp(state, "create-record", rec)); },
});

let byApp: Awaited<ReturnType<typeof snapshot>> | null = null;

test.describe.serial("Packs", () => {
  test.setTimeout(120_000);
  test.beforeAll(cleanup);
  test.afterAll(cleanup);

  test("a newcomer adds Core types with one tap; New meeting starts from its template; adding it again changes nothing", async ({ page }) => {
    test.skip(!(await restTypes()), "the app makes types over REST: needs core #139 (write may define a type on /api/types)");
    const app = await openPacks(page);
    await expect(app.getByText("No packs in kitchen yet.")).toBeVisible();
    await expect(app.getByRole("region", { name: "Core types" })).toContainText("meeting (date, people, project)");
    // a pack of types alone (Library) lists its types and no empty "Records: ."
    await expect(app.getByRole("region", { name: "Library" })).toContainText("chapter (book, part, order, words)");
    await expect(app.getByRole("region", { name: "Library" })).not.toContainText("Records:");
    await shot(page, "01-add-a-pack");
    await app.getByRole("button", { name: "Add Core types" }).click();
    await expect(app.getByRole("region", { name: "What Core types did" })).toContainText("Added the types person, project, meeting, task and template, 4 templates and the saved view Open.");
    await expect(app.getByRole("region", { name: "Installed packs" })).toContainText("Core types");
    await expect(app.getByRole("region", { name: "Installed packs" })).toContainText("up to date");
    await shot(page, "02-added");

    // the vault has them: the types with the pack's fields, a template each, the view, and the receipt saying what it made
    const types = (await api(hub(), "GET", "types?include_schema=true")) as { name: string; fields: Record<string, { type: string }> }[];
    for (const [t, def] of Object.entries(PACK.types)) expect([t, Object.keys(types.find((x) => x.name === t)?.fields ?? {}).sort()]).toEqual([t, Object.keys(def.fields).sort()]);
    const receipt = (await api(hub(), "GET", `records/${encodeURIComponent(`${RECEIPTS}core-types`)}`)) as { tags: string[]; fields: { receipt: any } };
    expect(receipt.tags).toEqual(["parachute-receipt"]);
    expect(receipt.fields.receipt.version).toBe(1);
    expect(Object.keys(receipt.fields.receipt.made.types).sort()).toEqual([...TYPES].sort());
    expect(receipt.fields.receipt.made.records.map((r: { path: string }) => r.path).sort()).toEqual(PACK.records.map((r) => r.path).sort());
    byApp = await snapshot();

    // applying twice changes nothing: not a record, not a time, not the receipt
    const before = await snapshot(true);
    const again = await addAgain(page);
    expect(again.changed).toBe(false);
    expect(again.added).toEqual([]);
    expect(await snapshot(true)).toEqual(before);

    // New meeting starts from Templates/meeting/Meeting
    await app.getByRole("button", { name: "meeting", exact: true }).click();
    await expect(app.getByText("A new meeting starts from the template Meeting.")).toBeVisible();
    await app.getByRole("textbox", { name: "New meeting" }).fill("Kickoff with Sam");
    await app.getByRole("button", { name: "Add", exact: true }).click();
    await expect(app.getByRole("article", { name: "Kickoff with Sam" })).toContainText("Decisions");
    // its people, a reference to many, is a box to fill in
    await expect(app.getByRole("textbox", { name: "people" })).toBeEditable();
    // and what is typed there is saved as a list, as the field declares (one path, then the vault holds ["…"])
    await app.getByRole("textbox", { name: "people" }).fill("People/Sam Okafor");
    await app.getByRole("textbox", { name: "people" }).press("Enter");
    await expect.poll(async () => ((await api(hub(), "GET", "records?type=meeting&include_fields=true")) as { path: string; fields: Record<string, unknown> }[]).find((r) => r.path.endsWith("Kickoff with Sam"))?.fields.people).toEqual(["People/Sam Okafor"]);
    // and it stays a box once it holds one: a second person can be added
    await expect(app.getByRole("textbox", { name: "people" })).toBeEditable();
    const kick = ((await api(hub(), "GET", "records?type=meeting&include_body=true")) as { path: string; body: string }[]).find((r) => r.path.endsWith("Kickoff with Sam"));
    expect(kick?.body).toBe(PACK.records.find((r) => r.path === "Templates/meeting/Meeting")!.body);
    await shot(page, "03-new-meeting");

    // Make this a template: the record's headings, for meeting, not the default (Meeting is)
    await app.getByRole("button", { name: "Make this a template" }).click();
    await expect(app.getByRole("article", { name: "Kickoff with Sam" }).last()).toBeVisible();
    await expect.poll(async () => ((await api(hub(), "GET", `records?path_prefix=${encodeURIComponent("Templates/meeting/")}&include_fields=true`)) as { path: string }[]).map((r) => r.path).sort())
      .toEqual(["Templates/meeting/Kickoff with Sam", "Templates/meeting/Meeting"]);
    const made = (await api(hub(), "GET", `records/${encodeURIComponent("Templates/meeting/Kickoff with Sam")}`)) as { types: string[]; fields: Record<string, unknown>; body: string };
    expect(made.types).toEqual(["template"]);
    expect(made.fields).toMatchObject({ for: "meeting", default: false });
    expect(made.body).toBe("## Attendees\n\n## Notes\n\n## Decisions\n\n## Actions\n");
    await shot(page, "04-made-a-template");
  });

  test("an AI over MCP applying the same pack leaves the same vault, and the app's Add after it changes nothing", async ({ page }) => {
    test.skip(!(await restTypes()) || !byApp, "needs the first test's vault to compare with");
    await cleanup();
    const ai = await applyPack(PACK, overMcp(hub()));
    expect(ai.changed).toBe(true);
    expect(await snapshot()).toEqual(byApp);
    // the app sees it as installed, and adding it changes nothing
    const app = await openPacks(page);
    await expect(app.getByRole("region", { name: "Installed packs" })).toContainText("Core types");
    const before = await snapshot(true);
    expect((await addAgain(page)).changed).toBe(false);
    expect(await snapshot(true)).toEqual(before);
    // and the other way: the AI after the app changes nothing either
    expect((await applyPack(PACK, overMcp(hub()))).changed).toBe(false);
    expect(await snapshot(true)).toEqual(before);
    // an AI that wrote the receipt in a shape of its own (a cold AI did, T-476): the app writes it again in the
    // contract's shape, and changes nothing else
    const rec = (await api(hub(), "GET", `records/${encodeURIComponent(`${RECEIPTS}core-types`)}`)) as { id: string; updatedAt: string };
    await api(hub(), "PATCH", `records/${rec.id}`, { fields: { receipt: { pack: "core-types", version: 1, types_added: TYPES } }, if_updated_at: rec.updatedAt });
    const fixed = await addAgain(page);
    expect(fixed.changed).toBe(true);
    expect(fixed.added).toEqual([]);
    const after = await snapshot(true);
    expect(after.types).toEqual(before.types);
    expect(after.records.filter((r) => !r.path.startsWith(RECEIPTS))).toEqual(before.records.filter((r) => !r.path.startsWith(RECEIPTS)));
    const receipt = (await api(hub(), "GET", `records/${encodeURIComponent(`${RECEIPTS}core-types`)}`)).fields.receipt;
    expect(receipt).toMatchObject({ contract: 1, id: "core-types", version: 1 });
  });

  test("a vault with its own task type, an indexed date of its own and a record at the template's path keeps them, gains the rest, and says so", async ({ page }) => {
    test.skip(!(await restTypes()), "needs core #139");
    await cleanup();
    await api(admin(), "PUT", "types/task", { kind: "type", description: "Mine", fields: { status: { type: "string", enum: ["open", "closed"] }, priority: { type: "integer" } } });
    // core refuses a field declared otherwise elsewhere (its kind, or whether it is indexed): the pack leaves it out
    await api(admin(), "PUT", "types/journal", { kind: "type", fields: { date: { type: "date", indexed: true } } });
    await api(hub(), "POST", "records", { path: "Templates/meeting/Meeting", body: "My own meeting notes.\n" });
    const app = await openPacks(page);
    await app.getByRole("button", { name: "Add Core types" }).click();
    const said = app.getByRole("region", { name: "What Core types did" });
    await expect(said).toContainText("task is already a type here and keeps its own fields. The pack's due, project and who weren't added: adding fields to a type made elsewhere needs admin.");
    await expect(said).toContainText("Templates/meeting/Meeting is already a record of yours, so it stays as it is.");
    await expect(said).toContainText("meeting's date wasn't added: your type journal has a date field of its own, set up differently.");
    expect(Object.keys(((await api(hub(), "GET", "types/meeting")) as { fields: object }).fields).sort()).toEqual(["people", "project"]);
    await shot(page, "05-own-task-kept");
    const task = (await api(hub(), "GET", "types/task")) as { description: string; fields: Record<string, { enum?: string[] }> };
    expect(task.description).toBe("Mine");
    expect(Object.keys(task.fields).sort()).toEqual(["priority", "status"]);
    expect(task.fields.status.enum).toEqual(["open", "closed"]);
    expect((await api(hub(), "GET", `records/${encodeURIComponent("Templates/meeting/Meeting")}`)).body).toBe("My own meeting notes.\n");
    const receipt = (await api(hub(), "GET", `records/${encodeURIComponent(`${RECEIPTS}core-types`)}`)).fields.receipt;
    expect(Object.keys(receipt.made.types).sort()).toEqual(["meeting", "person", "project", "template"]);
    expect(receipt.made.records.map((r: { path: string }) => r.path)).not.toContain("Templates/meeting/Meeting");
    expect(receipt.skipped.join(" ")).toContain("task is already a type here");
  });

  test("on a server where write can't define a type yet, Add a pack says so and writes nothing", async ({ page }) => {
    const door = (await fetch(`${hub().origin}/vault/${VAULT}/api/records?limit=1`, { headers: { authorization: `Bearer ${hub().token}` } })).ok;
    test.skip(!door || (await restTypes()), "for a 0.9 server before core #139 (0.8 has no types; Packs says so)");
    await cleanup();
    const app = await openPacks(page);
    await app.getByRole("button", { name: "Add Core types" }).click();
    await expect(app.getByText("This vault's server doesn't let Parachute make types yet. Nothing was changed.")).toBeVisible();
    const types = (await api(hub(), "GET", "types?include_schema=true")) as { name: string; fields: unknown }[];
    expect(types.filter((t) => TYPES.includes(t.name) && t.fields)).toEqual([]);
    expect(await api(hub(), "GET", `notes?path_prefix=${encodeURIComponent(RECEIPTS)}`)).toEqual([]);
    expect(await api(hub(), "GET", `notes?path_prefix=${encodeURIComponent("Templates/")}`)).toEqual([]);
  });
});
