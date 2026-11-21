// Changes (T-476, docs/VAULT.md "Changes"): an AI with its own write key changes three records and deletes one over MCP,
// as an AI connected to the vault does. Home says so in a line; Vault's Changes shows all four under the AI's name, each
// with its before and after; Put all back puts them back, the deleted one too; and the record's history shows the put
// back as a change of its own. Against the real hub: what the hub holds is read back after each step.
// Deletes need a hub that lists deleted records to write access (core T-476). On an older hub (CI installs core from
// npm) Changes says deleted records aren't listed, and the test checks that instead of the delete.
import { expect, test, type FrameLocator } from "@playwright/test";
import { signIn } from "./helpers";
import { api, cli, hubState, VAULT } from "./hub";

type Rec = { id: string; path: string; body: string; fields: Record<string, unknown>; types: string[]; updatedAt: string };

/** One tool call over the vault's MCP with the AI's key, as a connected AI makes it. */
async function mcp(token: string, name: string, args: Record<string, unknown>) {
  const r = await fetch(`${hubState().origin}/vault/${VAULT}/mcp`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
  const text = await r.text();
  if (r.status >= 300 || /"error"|"isError":true/.test(text)) throw new Error(`${name}: ${r.status} ${text.slice(0, 300)}`);
}

test("an AI changes three records and deletes one; Changes shows them under its name and puts them all back", async ({ page }) => {
  test.setTimeout(240_000);
  const hub = hubState();
  const stamp = Date.now().toString(36);
  // the records door (core 0.9): Vault's own e2e runs there only
  const door = await fetch(`${hub.origin}/vault/${VAULT}/api/records?limit=1`, { headers: { authorization: `Bearer ${hub.token}` } });
  test.skip(door.status === 404, "a hub before the record door (core 0.8): Vault's e2e runs on 0.9");
  // the AI's own key, named as a person names it: its writes are stamped key:<name>
  let ai = "claude";
  let made: { token?: string } = {};
  try { made = cli(hub, ["keys", "new", ai, "--vault", VAULT, "--can", "write", "--json"]); } catch { ai = `claude-${stamp}`; made = cli(hub, ["keys", "new", ai, "--vault", VAULT, "--can", "write", "--json"]); }
  const key = made.token!;
  const first = [
    { path: `Pantry ${stamp}/Soup`, body: "# Soup\n\nLeeks, potatoes, stock.", fields: { serves: 2, status: "tried" } },
    { path: `Pantry ${stamp}/Bread`, body: "# Bread\n\nFlour, water, salt.", fields: { serves: 6 } },
    { path: `Pantry ${stamp}/Jam`, body: "# Jam\n\nPlums and sugar.", fields: { jars: 3 } },
    { path: `Pantry ${stamp}/Pie`, body: "# Pie\n\nApples, butter.", fields: { serves: 8 } },
  ];
  const recs: Rec[] = [];
  for (const f of first) recs.push(await api(hub, "POST", "records", { ...f, types: [`dish${stamp}`] }) as Rec);
  // the person's own hub token (REST, no key name) makes one record and changes it twice: three changes, one record
  const cake = await api(hub, "POST", "records", { path: `Pantry ${stamp}/Cake`, body: "# Cake\n\nFlour, eggs.", fields: { serves: 8 }, types: [`dish${stamp}`] }) as Rec;
  await api(hub, "PATCH", `records/${cake.id}`, { fields: { serves: 10 }, force: true });
  await api(hub, "PATCH", `records/${cake.id}`, { fields: { serves: 12 }, force: true });
  // the AI: three changes and a delete, over MCP
  await mcp(key, "update-record", { id: recs[0].id, body: "# Soup\n\nLeeks, potatoes, stock.\nA little cream.", fields: { serves: 4 }, force: true });
  await mcp(key, "update-record", { id: recs[1].id, fields: { serves: 12, status: "for the fair" }, force: true });
  await mcp(key, "update-record", { id: recs[2].id, body: "# Jam\n\nPlums, sugar and a lemon.", force: true });
  await mcp(key, "delete-record", { id: recs[3].id });
  const deletes = (await fetch(`${hub.origin}/vault/${VAULT}/api/history/deleted?limit=1`, { headers: { authorization: `Bearer ${hub.token}` } })).status === 200;

  await signIn(page);
  // Home: the quiet line names the AI, and opens Vault's Changes
  await page.goto(`/v/${VAULT}/a/parachute%3Ahome`);
  const home = page.frameLocator('iframe.applet-frame[title="Home"]');
  const line = home.locator("p.changed").filter({ hasText: /changed \d+\+? things? today/ });
  await expect(line).toBeVisible({ timeout: 30_000 });
  await expect(line).toContainText(ai);
  await home.getByRole("button", { name: "See what changed" }).click();
  await expect(page).toHaveURL(/\/a\/parachute%3Avault\?vault=kitchen&show=changes/);
  const vault: FrameLocator = page.frameLocator('iframe.applet-frame[title="Vault"]');
  await expect(vault.getByRole("heading", { level: 1, name: "Changes" })).toBeVisible({ timeout: 30_000 });

  // all four under the AI's name, newest first: the delete, then the three changes
  const run = vault.getByRole("region", { name: new RegExp(`^${ai}, Today$`) });
  const n = deletes ? 4 : 3;
  await expect(run.getByRole("button")).toHaveCount(n);
  for (const t of ["Soup", "Bread", "Jam", ...(deletes ? ["Pie"] : [])]) await expect(run.getByRole("button", { name: new RegExp(`${t}: see what changed`) })).toBeVisible();
  if (deletes) await expect(run.getByRole("button", { name: /Deleted Pie/ })).toBeVisible();
  else await expect(vault.getByText("Deleted records aren't listed: this vault's hub shows them only to its admin.")).toBeVisible();
  // the person's own hub token reads as them, in plain words: not "A key with no name (REST)"
  // (other specs on the same hub write as the person too: the run that holds the cake)
  const you = vault.getByRole("region", { name: "You, in another app, Today" }).filter({ has: vault.getByRole("button", { name: /Cake: see what changed/ }) });
  await expect(you).toBeVisible();
  await expect(vault.getByText(/with no name|\bREST\b|\bMCP\b/i)).toHaveCount(0);
  // and its counts agree: the group says how many changes it has, "Put all N back" says how many records that puts back,
  // and the line between them says what the rest are (the cake's two later changes go back with the cake, so they aren't counted again)
  const header = you.locator("xpath=ancestor::div[contains(@class,'chg')][1]/preceding-sibling::div[contains(@class,'run')][1]");
  const changes = Number(/(\d+) changes/.exec(await header.innerText())![1]);
  await expect(you.getByRole("button")).toHaveCount(changes);
  const all = Number(/^Put all (\d+) back, by You/.exec(await header.getByRole("button").getAttribute("aria-label") ?? "")![1]);
  const covers = header.locator("xpath=following-sibling::p[contains(@class,'lede')][1]");
  await expect(covers).toHaveText(new RegExp(`^Put all ${all} back covers ${all} of these ${changes} changes\\. Not counted: .*\\d+ more changes to a record already counted\\.`));
  // the cake's two later changes are among them; every other change in the run is a record counted, or one of the reasons
  expect(Number(/(\d+) more changes to a record already counted/.exec(await covers.innerText())![1])).toBeGreaterThanOrEqual(2);
  expect(all).toBeLessThan(changes);
  // what one change did: the field before and after, and the words line by line
  await expect(run.getByRole("button", { name: /Changed Soup/ })).toContainText("serves 2 → 4, the words");
  await run.getByRole("button", { name: /Changed Soup/ }).click();
  const soup = vault.getByRole("article", { name: "Changed Soup" });
  await expect(soup.getByRole("table", { name: "Fields" })).toContainText("serves");
  await expect(soup.getByLabel("Words")).toContainText("A little cream.");
  await expect(soup).toContainText(`Changed by ${ai}`);
  // on a phone the change takes the list's place: back to the list
  await vault.getByRole("button", { name: "← Close" }).click();

  // Put all back: every record as it was, the deleted one too
  await vault.getByRole("button", { name: `Put all ${n} back, by ${ai}` }).click();
  await expect(vault.getByText(`${n} records are back as they were.`)).toBeVisible({ timeout: 20_000 });
  for (let i = 0; i < n; i++) {
    const now = await api(hub, "GET", `records/${recs[i].id}`) as Rec;
    expect(now.body, first[i].path).toBe(first[i].body);
    expect(now.fields, first[i].path).toEqual(first[i].fields);
  }
  // the AI's run is marked put back, and the put back is a run of its own, by this Parachute
  await expect(vault.getByRole("region", { name: "You, in Parachute here, Today" }).getByRole("button")).toHaveCount(n, { timeout: 20_000 });
  await expect(run.getByRole("button", { name: /Changed Soup/ })).toContainText("put back since", { timeout: 20_000 });

  // the record's history shows the put back, by whom, beside the AI's change
  await vault.getByRole("region", { name: "You, in Parachute here, Today" }).getByRole("button", { name: /Soup/ }).click();
  await vault.getByRole("button", { name: "Open the record" }).click();
  const rec = vault.getByRole("article", { name: "Soup" });
  await expect(rec.getByRole("region", { name: "Versions" }).getByRole("button", { name: /^Put back by You, in Parachute here/ })).toBeVisible();
  await expect(rec.getByRole("region", { name: "Versions" }).getByRole("button", { name: new RegExp(`^Changed by ${ai}`) })).toBeVisible();
  // the hub's history agrees: the newest version is the put back, stamped with this app's key, not the AI's
  const versions = await api(hub, "GET", `records/${recs[0].id}/versions`) as { versions: { op: string; via: string }[] };
  expect(versions.versions[0].op).toBe("restore");
  expect(versions.versions[0].via).not.toBe(`key:${ai}`);
});
