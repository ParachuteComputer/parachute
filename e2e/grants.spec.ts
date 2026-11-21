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
  await page.goto(`/vault?vault=${VAULT}`);
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
  const secretKey = v.locator("p.addr[data-secret]");
  await expect(secretKey).toBeVisible({ timeout: 20_000 });
  const token = (await secretKey.textContent())!.trim();
  expect(token.split(".")).toHaveLength(3);
  await expect(v.getByText("it isn't shown again")).toBeVisible();

  // the list names it: what it may do, to which type, until when
  await v.getByRole("button", { name: "Done" }).click();
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
  // and at the MCP door
  const byId = await mcp(token, "query-notes", { id: entry.id });
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

  // leaving Sharing gives the hub's yes back: the app holds no admin of the vault
  await v.getByRole("button", { name: new RegExp(`${VAULT}$`) }).first().click();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("parachute.manage") ?? "[]")).toBe("[]");
});
