// Who reaches a vault, and a key for an AI (T-476, docs/VAULT.md "Sharing"; core: the 1.0 grants slice). The person
// opens Vault's Sharing, asks once to manage who reaches kitchen (the app's own sheet, then the hub's Approve), makes a
// key named for an AI that may read and add one type only, and the list names it. With that key, at the vault's REST and
// MCP doors as an AI uses them, recipes are added and read, and a journal record is as if it didn't exist: by id, by
// search, in the type list and in its history. Ending it in the list makes its very next request fail.
// Needs a hub with typed keys (core uni/t476-typed-keys or later); an older hub (CI installs core from npm) skips.
import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import { signIn } from "./helpers";
import { api, cli, hubState, VAULT } from "./hub";

const vaultApi = (token: string, method: string, path: string, body?: unknown) =>
  fetch(`${hubState().origin}/vault/${VAULT}/api/${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

/** One MCP tool call with the AI's key; the tool's text, or the refusal's status. */
async function mcp(token: string, name: string, args: Record<string, unknown>): Promise<{ status: number; text: string }> {
  const r = await fetch(`${hubState().origin}/vault/${VAULT}/mcp`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
  return { status: r.status, text: await r.text() };
}

/** The hub's Approve, until the app is back (on any of its own pages). */
async function approveBack(page: Page, appOrigin: string) {
  const approve = page.getByRole("button", { name: "Approve" });
  for (let i = 0; i < 4; i++) {
    await expect.poll(async () => new URL(page.url()).origin === appOrigin && !/\/oauth\/callback/.test(page.url()) ? "back" : (await approve.isVisible().catch(() => false)) ? "asked" : "wait", { timeout: 30_000 }).not.toBe("wait");
    if (new URL(page.url()).origin === appOrigin) return;
    const before = page.url();
    await approve.click();
    await page.waitForURL((u) => u.href !== before);
  }
}

test("a key for an AI reaches recipes only; the list names it; ending it stops its next request", async ({ page }) => {
  test.setTimeout(240_000);
  const hub = hubState();
  const stamp = Date.now().toString(36);
  const admin = cli(hub, ["auth", "mint-token", "--scope", `vault:${VAULT}:admin`, "--json"]).token as string;
  const list = await fetch(`${hub.origin}/account/vaults/${VAULT}/statements`, { headers: { authorization: `Bearer ${admin}` } });
  test.skip(list.status === 404 || list.status === 405, "a hub without typed keys (core before the 1.0 grants slice)");

  // the owner's vault: a recipe, and a journal entry with a word only it holds
  const [recipe, journal] = [`recipe${stamp}`, `journal${stamp}`];
  for (const t of [recipe, journal]) await api(hub, "PUT", `types/${t}`, { fields: { note: { type: "string" } } });
  const soup = await api(hub, "POST", "records", { path: `Kitchen ${stamp}/Soup`, body: "# Soup\n\nLeeks and stock.", types: [recipe] }) as { id: string };
  const secret = `zq${stamp}private`;
  const entry = await api(hub, "POST", "records", { path: `Journal ${stamp}/Today`, body: `A ${secret} day.`, types: [journal] }) as { id: string };
  await api(hub, "PATCH", `records/${entry.id}`, { body: `A ${secret} day, again.`, force: true });

  await signIn(page);
  const app = new URL(page.url()).origin;
  // Vault opened on a record (a tap on one): the way back from the hub still leads to Sharing
  await page.goto(`/vault?vault=${VAULT}&record=${soup.id}`);
  await page.frameLocator('iframe.applet-frame[title="Vault"]').getByRole("button", { name: "← Close" }).or(page.frameLocator('iframe.applet-frame[title="Vault"]').getByRole("button", { name: new RegExp(`${VAULT}$`) })).first().click();
  const v: FrameLocator = page.frameLocator('iframe.applet-frame[title="Vault"]');
  await v.getByRole("button", { name: "Sharing" }).click();
  const who = v.getByRole("region", { name: `Who reaches ${VAULT}` });
  await expect(who).toContainText("Parachute, on this device", { timeout: 30_000 });

  // managing asks once: the app's own sheet, then the hub's page; back on Sharing
  await v.getByRole("button", { name: "Show them all" }).click();
  const manage = page.getByRole("dialog", { name: `Manage who reaches ${VAULT}?` });
  await expect(manage).toBeVisible();
  await page.waitForTimeout(800);
  await manage.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL((u) => u.origin === hub.origin || u.pathname === "/oauth/callback");
  await approveBack(page, app);
  await expect(page).toHaveURL(/show=sharing/);
  await expect(v.getByRole("button", { name: "Give an AI a key" })).toBeVisible({ timeout: 30_000 });

  // a key for an AI: its name, read and add, one type
  const name = `claude-${stamp}`;
  await v.getByRole("button", { name: "Give an AI a key" }).click();
  await v.getByLabel("Its name").fill(name);
  await v.getByRole("group", { name: "Which types" }).getByRole("button", { name: new RegExp(recipe, "i") }).click();
  await v.getByRole("button", { name: "Make the key" }).click();
  const give = page.getByRole("dialog", { name: `Give ${name} a key to ${VAULT}?` });
  await expect(give).toBeVisible();
  await expect(give).toContainText(`${name} can read, add, change and delete ${recipe} records`);
  await page.waitForTimeout(800);
  await give.getByRole("button", { name: "Make the key" }).click();
  // the secret is shown once on the app's own sheet, outside the applet's frame
  const shown = page.getByRole("dialog", { name: `${name}'s key` });
  await expect(shown).toBeVisible({ timeout: 20_000 });
  const token = (await shown.locator("p[data-secret]").textContent())!.trim();
  expect(token.split(".")).toHaveLength(3);
  await expect(shown).toContainText("won't show it again");
  expect(await v.locator("body").innerText()).not.toContain(token);
  // copying a key into an AI takes a while: the sheet stays as long as the person needs, and the key is made all the same
  await page.waitForTimeout(25_000);
  await shown.getByRole("button", { name: "Done" }).click();

  // the list names it: what it may do, to which type, until when
  const row = who.getByRole("listitem").filter({ hasText: name });
  await expect(row).toContainText(new RegExp(`reads and changes ${recipe}`, "i"));
  await expect(row).toContainText("until");

  // the key at the REST door: recipes yes, the journal as if it didn't exist
  const made = await vaultApi(token, "POST", "records", { path: `Kitchen ${stamp}/Bread`, body: "# Bread", types: [recipe] });
  expect(made.status).toBe(201);
  expect((await vaultApi(token, "GET", `records/${soup.id}`)).status).toBe(200);
  expect((await vaultApi(token, "GET", `records/${entry.id}`)).status).toBe(404);
  const search = await (await vaultApi(token, "GET", `records?search=${secret}`)).text();
  expect(search).not.toContain(entry.id);
  expect((await vaultApi(token, "GET", `records/${entry.id}/versions`)).status).toBe(404);
  expect(await (await vaultApi(token, "GET", "types")).text()).not.toContain(journal);
  expect((await vaultApi(token, "POST", "records", { path: `Journal ${stamp}/Not mine`, body: "no", types: [journal] })).status).toBe(403);
  // and at the MCP door: a recipe is there, the journal isn't
  const recipeById = await mcp(token, "query-notes", { id: soup.id });
  expect(recipeById.status).toBe(200);
  expect(recipeById.text).toContain("Leeks and stock");
  const byId = await mcp(token, "query-notes", { id: entry.id });
  expect(byId.status).toBe(200);
  expect(byId.text).not.toContain(secret);
  const found = await mcp(token, "query-notes", { search: secret });
  expect(found.text).not.toContain(entry.id);

  // ending it in the list: its next request fails, and it leaves the list
  await row.getByRole("button", { name: `End ${name}` }).click();
  const end = page.getByRole("dialog", { name: `End ${name}?` });
  await expect(end).toBeVisible();
  await page.waitForTimeout(800);
  await end.getByRole("button", { name: "End it" }).click();
  await expect(who.getByRole("listitem").filter({ hasText: name })).toHaveCount(0, { timeout: 20_000 });
  expect((await vaultApi(token, "GET", `records/${soup.id}`)).status).toBe(401);
  expect((await mcp(token, "query-notes", { id: soup.id })).status).toBe(401);

  // leaving Sharing gives the hub's yes back: ended at the hub, not only forgotten here
  const statements = `${hub.origin}/account/vaults/${VAULT}/statements`;
  const held = async () => page.evaluate(() => (JSON.parse(sessionStorage.getItem("parachute.manage") ?? "[]") as { access: string }[])[0]?.access ?? null);
  const first = await held();
  expect(first).not.toBeNull();
  expect((await fetch(statements, { headers: { authorization: `Bearer ${first}` } })).status).toBe(200);
  await v.getByRole("button", { name: new RegExp(`${VAULT}$`) }).first().click();
  await expect.poll(held).toBeNull();
  await expect.poll(async () => (await fetch(statements, { headers: { authorization: `Bearer ${first}` } })).status).toBe(401);

  // and when the shell leaves the applet (its own Back), not the applet
  await v.getByRole("button", { name: "Sharing" }).click();
  await v.getByRole("button", { name: "Show them all" }).click();
  await page.waitForTimeout(800);
  await page.getByRole("dialog", { name: `Manage who reaches ${VAULT}?` }).getByRole("button", { name: "Continue" }).click();
  await page.waitForURL((u) => u.origin === hub.origin || u.pathname === "/oauth/callback");
  await approveBack(page, app);
  await expect(v.getByRole("button", { name: "Give an AI a key" })).toBeVisible({ timeout: 30_000 });
  const second = await held();
  expect(second).not.toBeNull();
  await page.getByRole("button", { name: "Back" }).first().click();
  await expect.poll(held).toBeNull();
  await expect.poll(async () => (await fetch(statements, { headers: { authorization: `Bearer ${second}` } })).status).toBe(401);
});

test("on a hub without the list (an older core, Parachute Cloud for now), Sharing offers nothing it can't do", async ({ page }) => {
  test.setTimeout(120_000);
  const hub = hubState();
  const admin = cli(hub, ["auth", "mint-token", "--scope", `vault:${VAULT}:admin`, "--json"]).token as string;
  const list = await fetch(`${hub.origin}/account/vaults/${VAULT}/statements`, { headers: { authorization: `Bearer ${admin}` } });
  test.skip(list.status !== 404 && list.status !== 405, "this hub has the list (the test above runs)");
  // Vault's own e2e runs on 0.9, as changes.spec's: a hub before the record door (core 0.8) is skipped
  const door = await fetch(`${hub.origin}/vault/${VAULT}/api/records?limit=1`, { headers: { authorization: `Bearer ${hub.token}` } });
  test.skip(door.status === 404, "a hub before the record door (core 0.8): Vault's e2e runs on 0.9");
  await signIn(page);
  await page.goto(`/vault?vault=${VAULT}`);
  const v: FrameLocator = page.frameLocator('iframe.applet-frame[title="Vault"]');
  await v.getByRole("button", { name: "Sharing" }).click();
  await expect(v.getByRole("region", { name: `Who reaches ${VAULT}` })).toContainText("Parachute, on this device", { timeout: 30_000 });
  await expect(v.getByText("Your hub can't list them here yet.")).toBeVisible({ timeout: 20_000 });
  await expect(v.getByRole("button", { name: "Show them all" })).toHaveCount(0);
  await expect(v.getByRole("button", { name: "Give an AI a key" })).toHaveCount(0);
});
