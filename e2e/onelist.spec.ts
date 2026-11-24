// Who reaches a vault, in one list (T-476, docs/VAULT.md "Sharing"): your AIs and agents first, then people, then apps
// and devices. On the real hub: an AI with a key to the whole vault, an AI given a key to one type from Connect an AI,
// Bo (invited by name, accepted with his own key, signed in from his own Parachute) and a backup app's key. Each is in
// the list once, in its group, saying what it reaches; Bo is one row, never also his sign-in. End on each leaves it in
// the list as ended, and its next request is refused: Bo's too, and he can't sign in to the vault again.
// Needs a hub with the one list (core T-476 #144 or later); an older hub skips, unless E2E_CORE_NEXT=1 says this hub is
// a core that must have it (CI's 0.9.0-pre.2 leg; the red run).
import { createHash, randomBytes } from "node:crypto";
import { schnorr } from "@noble/curves/secp256k1.js";
import { expect, test, type FrameLocator, type Locator, type Page } from "@playwright/test";
import { signIn } from "./helpers";
import { api, cli, hubState, VAULT } from "./hub";
import { keyDoor, newKey, pubOf } from "./keys";

const REDIRECT = "https://bo-notes.example/oauth/callback";
const BO_APP = "Bo's notes";

/** NIP-98: a request signed by `secret`. */
function nip98(secret: string, url: string, method: string, body?: string): string {
  const tags = [["u", url], ["method", method], ["nonce", randomBytes(8).toString("hex")]];
  if (body) tags.push(["payload", createHash("sha256").update(body).digest("hex")]);
  const pubkey = pubOf(secret);
  const created_at = Math.floor(Date.now() / 1000);
  const id = createHash("sha256").update(JSON.stringify([0, pubkey, created_at, 27235, tags, ""])).digest();
  const sig = Buffer.from(schnorr.sign(id, Buffer.from(secret, "hex"))).toString("hex");
  return `Nostr ${Buffer.from(JSON.stringify({ id: id.toString("hex"), pubkey, created_at, kind: 27235, tags, content: "", sig })).toString("base64")}`;
}

/** One account-door tool, signed by the owner's key (inviting is the person's own, never an app's). */
async function ownerTool(name: string, args: Record<string, unknown>) {
  const hub = hubState();
  const url = `${hub.origin}/account/mcp`;
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  const r = await fetch(url, { method: "POST", headers: { authorization: nip98(hub.key, url, "POST", body), "content-type": "application/json", accept: "application/json, text/event-stream" }, body });
  const j = await r.json() as { result?: { isError?: boolean; content: { text: string }[] } };
  if (!r.ok || j.result?.isError) throw new Error(`${name}: ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  return JSON.parse(j.result!.content[0].text);
}

/** Bo's own Parachute signing in to the vault: the hub's key door with his key, then OAuth with the consent's Approve.
 *  His access token, or null when the hub gives him none for this vault. */
async function boSignsIn(secret: string): Promise<string | null> {
  const hub = hubState();
  const cookie = (await keyDoor(hub.origin, secret)).map((c) => `${c.name}=${c.value}`).join("; ");
  const reg = await (await fetch(`${hub.origin}/oauth/register`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: BO_APP, redirect_uris: [REDIRECT], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }) })).json() as { client_id: string };
  const verifier = randomBytes(32).toString("base64url");
  const params = { client_id: reg.client_id, redirect_uri: REDIRECT, response_type: "code", code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256", scope: `vault:${VAULT}:read vault:${VAULT}:write`, state: randomBytes(8).toString("hex") };
  const auth = await fetch(`${hub.origin}/oauth/authorize?${new URLSearchParams(params)}`, { redirect: "manual", headers: { cookie } });
  let location = auth.headers.get("location");
  if (auth.status !== 302) {
    const html = await auth.text();
    if (auth.status !== 200 || !html.includes('value="consent"')) return null;
    const csrf = auth.headers.getSetCookie().find((c) => c.startsWith("parachute_hub_csrf="))?.split(";")[0].slice("parachute_hub_csrf=".length) ?? "";
    const consent = await fetch(`${hub.origin}/oauth/authorize`, { method: "POST", redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: `${cookie}; parachute_hub_csrf=${csrf}`, origin: hub.origin },
      body: new URLSearchParams({ ...params, __action: "consent", __csrf: /name="__csrf"\s+value="([^"]+)"/.exec(html)?.[1] ?? csrf, approve: "yes", vault_pick: VAULT }) });
    if (consent.status !== 302) return null;
    location = consent.headers.get("location");
  }
  const code = new URL(location ?? "about:blank").searchParams.get("code");
  if (!code) return null;
  const tok = await fetch(`${hub.origin}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: reg.client_id, redirect_uri: REDIRECT, code_verifier: verifier }) });
  const j = await tok.json().catch(() => ({})) as { access_token?: string; scope?: string };
  return tok.ok && j.access_token && (j.scope ?? "").includes(`vault:${VAULT}:`) ? j.access_token : null;
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

/** A credential's read of the vault: its status. */
const reads = (token: string) => fetch(`${hubState().origin}/vault/${VAULT}/api/records?limit=1`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.status);

/** End a row from the list: its End, the app's own sheet, and the row stays, said ended. */
async function endRow(page: Page, group: Locator, name: string, sheet: string, act: string) {
  await group.getByRole("button", { name: `End ${name}` }).click();
  const ask = page.getByRole("dialog", { name: sheet });
  await expect(ask).toBeVisible();
  await page.waitForTimeout(800);
  await ask.getByRole("button", { name: act, exact: true }).click();
  await expect(group.getByRole("listitem").filter({ hasText: name })).toContainText("ended", { timeout: 20_000 });
  await expect(group.getByRole("button", { name: `End ${name}` })).toHaveCount(0);
}

test("one list: AIs, then people, then apps; each once, each ended, each refused after", async ({ page }) => {
  test.setTimeout(300_000);
  const hub = hubState();
  const admin = cli(hub, ["auth", "mint-token", "--scope", `vault:${VAULT}:admin`, "--json"]).token as string;
  const statements = `${hub.origin}/account/vaults/${VAULT}/statements`;
  const listed = await fetch(statements, { headers: { authorization: `Bearer ${admin}` } });
  const rows = listed.ok ? ((await listed.json()) as { grants: { kind: string; by?: string }[] }).grants : [];
  // a hub with the one list says who a key is for (kind) and lists a person by self; an older one has neither
  const probe = await fetch(`${hub.origin}/account/keys`, { method: "POST", headers: { authorization: `Bearer ${admin}`, "content-type": "application/json" }, body: JSON.stringify({ name: "x", vault: VAULT, can: "read", kind: "nope" }) });
  const oneList = listed.ok && /kind:/.test(await probe.text());
  test.skip(!oneList && process.env.E2E_CORE_NEXT !== "1", `a hub before the one list (core T-476 #144): ${listed.status}, ${rows.length} rows`);

  const stamp = Date.now().toString(36);
  const recipe = `recipe${stamp}`;
  await api(hub, "PUT", `types/${recipe}`, { fields: { note: { type: "string" } } });
  await api(hub, "POST", "records", { path: `Kitchen ${stamp}/Soup`, body: "# Soup", types: [recipe] });

  // an AI with a key to the whole vault, and a backup app's key: made at the hub as a script would
  const mint = async (body: Record<string, unknown>) => {
    const r = await fetch(`${hub.origin}/account/keys`, { method: "POST", headers: { authorization: `Bearer ${admin}`, "content-type": "application/json" }, body: JSON.stringify({ vault: VAULT, ...body }) });
    expect(r.status, await r.clone().text()).toBe(201);
    return ((await r.json()) as { token: string }).token;
  };
  const claude = `claude-${stamp}`;
  const backup = `backup-${stamp}`;
  const claudeKey = await mint({ name: claude, can: "write", kind: "agent" });
  const backupKey = await mint({ name: backup, can: "read" });

  // Bo: invited by name with the owner's key, accepts with his own, and signs in from his own Parachute
  const boKey = newKey();
  const made = await ownerTool("invite-to-vault", { vault: VAULT, name: "Bo", from: "Aaron" });
  const code = String(made.url).split("#")[1];
  const acceptUrl = `${hub.origin}/account/invites/accept`;
  const acceptBody = JSON.stringify({ code });
  expect((await fetch(acceptUrl, { method: "POST", headers: { authorization: nip98(boKey, acceptUrl, "POST", acceptBody), "content-type": "application/json" }, body: acceptBody })).status).toBe(200);
  const boToken = await boSignsIn(boKey);
  expect(boToken).not.toBeNull();
  expect(await reads(boToken!)).toBe(200);

  // the owner opens Vault → Sharing, and asks once to see them all
  await signIn(page);
  const app = new URL(page.url()).origin;
  await page.goto(`/vault?vault=${VAULT}`);
  const v: FrameLocator = page.frameLocator('iframe.applet-frame[title="Vault"]');
  await v.getByRole("button", { name: "Sharing" }).click();
  const who = v.getByRole("region", { name: `Who reaches ${VAULT}` });
  await expect(who).toBeVisible({ timeout: 30_000 });
  await v.getByRole("button", { name: "Show them all" }).click();
  await page.waitForTimeout(800);
  await page.getByRole("dialog", { name: `Manage who reaches ${VAULT}?` }).getByRole("button", { name: "Continue" }).click();
  await page.waitForURL((u) => u.origin === hub.origin || u.pathname === "/oauth/callback");
  await approveBack(page, app);
  await expect(page).toHaveURL(/show=sharing/);
  const ais = who.getByRole("region", { name: "AIs and agents" });
  await expect(ais.getByRole("listitem").filter({ hasText: claude })).toBeVisible({ timeout: 30_000 });

  // Connect an AI, at the top: its address, or a key of its own to one type
  const typed = `recipes-ai-${stamp}`;
  await v.getByRole("button", { name: "Connect an AI" }).click();
  await expect(who).toContainText(`/vault/${VAULT}/mcp`);
  await v.getByRole("button", { name: "Give an AI a key" }).click();
  await v.getByLabel("Its name").fill(typed);
  await v.getByRole("button", { name: "Read", exact: true }).click();
  await v.getByRole("group", { name: "Which types" }).getByRole("button", { name: new RegExp(recipe, "i") }).click();
  await v.getByRole("button", { name: "Make the key" }).click();
  await page.waitForTimeout(800);
  await page.getByRole("dialog", { name: `Give ${typed} a key to ${VAULT}?` }).getByRole("button", { name: "Make the key" }).click();
  const shown = page.getByRole("dialog", { name: `${typed}'s key` });
  await expect(shown).toBeVisible({ timeout: 20_000 });
  const typedKey = (await shown.locator("p[data-secret]").textContent())!.trim();
  await shown.getByRole("button", { name: "Done" }).click();
  expect(await reads(typedKey)).toBe(200);

  // one list: AIs and agents, then People, then Apps and devices, in that order, each saying what it reaches
  const people = who.getByRole("region", { name: "People" });
  const apps = who.getByRole("region", { name: "Apps and devices" });
  await expect(ais.getByRole("listitem").filter({ hasText: claude })).toContainText("reads and changes every type");
  await expect(ais.getByRole("listitem").filter({ hasText: typed })).toContainText(new RegExp(`reads ${recipe}`, "i"));
  await expect(people.getByRole("listitem").filter({ hasText: "You" })).toContainText("owner");
  const bo = people.getByRole("listitem").filter({ hasText: /^Bo/ });
  await expect(bo).toHaveCount(1);
  await expect(bo).toContainText("reads and changes everything");
  await expect(apps.getByRole("listitem").filter({ hasText: backup })).toContainText("reads every type");
  await expect(apps).toContainText("Parachute, on this device");
  // in reading order: a page's columns run left to right (docs/LOOK.md), and within one, top to bottom
  const y = async (l: Locator) => { const b = (await l.boundingBox())!; return Math.round(b.x) * 100_000 + b.y; };
  expect(await y(ais)).toBeLessThan(await y(people));
  expect(await y(people)).toBeLessThan(await y(apps));
  // nothing twice: Bo is one row, and his own sign-in isn't another; each key is in one group
  await expect(who.getByText("Bo", { exact: true })).toHaveCount(1);
  await expect(who).not.toContainText(BO_APP);
  for (const name of [claude, typed, backup]) await expect(who.getByRole("listitem").filter({ hasText: name })).toHaveCount(1);

  // End each: it stays in the list, ended, and its next request is refused
  await endRow(page, ais, claude, `End ${claude}?`, "End it");
  await endRow(page, ais, typed, `End ${typed}?`, "End it");
  await endRow(page, people, "Bo", `End Bo's access to ${VAULT}?`, "End");
  await endRow(page, apps, backup, `End ${backup}?`, "End it");
  expect(await reads(claudeKey)).toBe(401);
  expect(await reads(typedKey)).toBe(401);
  expect(await reads(backupKey)).toBe(401);
  expect(await reads(boToken!)).toBe(401);
  // ending Bo ended his membership, not one sign-in: the hub lets him in no more, and gives him no new sign-in
  const access = await ownerTool("list-access", { vault: VAULT }) as { access: { pubkey: string }[] };
  expect(access.access.map((r) => r.pubkey)).not.toContain(pubOf(boKey));
  expect(await boSignsIn(boKey)).toBeNull();
});
