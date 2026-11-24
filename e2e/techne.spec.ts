// Techne in applets (docs/design/TECHNE.md), end to end in the web build: the Techne applet (applets/techne.tsx) reads
// the person's profile and recent posts as them, signed with their key, from its card's Allow alone; the first Post asks
// on the shell's own sheet, Not now sends nothing, Allow signs an approval of posting only and the post lands; Take back
// in Settings makes the next one ask again. A hostile applet can't reach a method nobody listed, a write its card
// doesn't name, a write without a tap, or the AppView as a plain service. The AppView is a stand-in with Techne's method
// shapes (e2e/services/techne.ts); the key is the test signer's (VITE_E2E_SIGNER=1).
import { expect, test, type Page } from "@playwright/test";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { api, hubState, record, VAULT } from "./hub";
import { installApplet, ui } from "./helpers";
import { startTechne, type Account } from "./services/techne";

test.use({ storageState: "e2e/.signed-in.json" });

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const sk = generateSecretKey();
const ME = getPublicKey(sk);
// made up
const maya: Account = { did: "did:plc:e2emaya", handle: "maya.techne.example", displayName: "Maya Example", bio: "Gardener. Fixes bikes on Thursdays.", programs: true };
const CIRCLE = "did:plc:e2ecircle";

let ap: Awaited<ReturnType<typeof startTechne>>;
test.beforeAll(async () => { ap = await startTechne({ [ME]: maya }); });
test.afterAll(async () => { await ap?.close(); });

const withKey = (page: Page) => page.addInitScript((k) => { if (window === window.top) (window as unknown as { __parachuteE2EKey: string }).__parachuteE2EKey = k; }, hex(sk));
const signedBy = (nsid: string) => ap.seen.filter((s) => s.nsid === nsid && s.pubkey === ME && !s.error).length;
const approvalsSigned = (page: Page) => page.evaluate(() => (window as unknown as { __parachuteE2EApprovals?: string[] }).__parachuteE2EApprovals ?? []);

test("techne: reads as you from the card; the first post asks and is signed for posting only; Take back asks again", async ({ page }) => {
  test.setTimeout(120_000);
  await withKey(page);
  const host = new URL(ap.origin).host;
  const applet = await installApplet("techne", { techne: `${ap.origin}/`, circle: CIRCLE });
  try {
    await page.goto(`/v/${VAULT}?with=vault`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Techne/ }).click();
    const card = page.getByRole("region", { name: /asking for access/ });
    await expect(card).toContainText(`As you on Techne at ${host} (your key): reads what you see there, your private circles included.`);
    await expect(card).toContainText(`Asks you first, once, before it can post as you in your circles at ${host}.`);
    await expect(card.getByText("Act as you on Techne")).toHaveCount(1);
    await page.getByRole("button", { name: "Allow" }).click();

    // read at once, as Maya, signed with her key
    const app = page.frameLocator("iframe.applet-frame");
    await expect(app.getByRole("heading", { name: "Maya Example" })).toBeVisible({ timeout: 30_000 });
    await expect(app.getByRole("region", { name: "Your recent posts" })).toContainText("Seed swap at the library");
    expect([signedBy("com.atproto.server.getSession"), signedBy("social.scenius.getProfile"), signedBy("pub.techne.draft.query.listRecords")].every((n) => n > 0)).toBe(true);
    expect(signedBy("social.scenius.createCirclePost")).toBe(0);

    // the first post asks; Not now sends nothing
    const sheet = page.getByRole("dialog", { name: "«Techne» wants to post as you on Techne" });
    await app.getByLabel("Post in your circle").fill("Tomatoes are ready to share, come by the garden.");
    await app.getByRole("button", { name: "Post" }).click();
    await expect(sheet).toContainText(`In your circles at ${host}, using your Techne account. Once you allow it, it does this without asking again.`);
    await sheet.getByRole("button", { name: "Cancel" }).click();
    await expect(sheet).toBeHidden();
    expect(ap.seen.filter((s) => s.nsid === "social.scenius.createCirclePost")).toEqual([]);

    // Allow: an approval of posting only is signed, and the post lands
    const before = (await approvalsSigned(page)).length;
    await app.getByRole("button", { name: "Post" }).click();
    await sheet.getByRole("button", { name: "Allow from now on" }).click();
    await expect(app.getByRole("region", { name: "Your recent posts" })).toContainText("Tomatoes are ready to share", { timeout: 20_000 });
    expect(ap.posts.some((p) => p.author === maya.did && p.value.text === "Tomatoes are ready to share, come by the garden.")).toBe(true);
    expect((await approvalsSigned(page)).slice(before)).toEqual(["Techne"]);
    const kept = (await api(hubState(), "GET", `notes?path_prefix=${encodeURIComponent("Parachute/Approvals/")}&limit=200`)) as { path: string }[];
    expect(kept.some((n) => n.path.endsWith(`${applet.id}.techne.post`))).toBe(true);

    // the second post doesn't ask
    await app.getByLabel("Post in your circle").fill("Bike co-op is open late on Thursday.");
    await app.getByRole("button", { name: "Post" }).click();
    await expect(app.getByRole("region", { name: "Your recent posts" })).toContainText("Bike co-op is open late", { timeout: 20_000 });
    await expect(sheet).toBeHidden();
    expect(signedBy("social.scenius.createCirclePost")).toBe(2);

    // Take back in Settings: the next post asks again
    await page.goto("/settings");
    const line = page.getByRole("list", { name: "On Techne for Techne" }).getByRole("listitem").filter({ hasText: "Posts as you on Techne" });
    await line.getByRole("button", { name: "Take back" }).click();
    await expect(line).toHaveCount(0);
    await page.goto(`/v/${VAULT}?with=vault`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Techne/ }).click();
    await expect(app.getByRole("heading", { name: "Maya Example" })).toBeVisible({ timeout: 30_000 });
    await app.getByLabel("Post in your circle").fill("This one waits for a yes.");
    await app.getByRole("button", { name: "Post" }).click();
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "Cancel" }).click();
    expect(signedBy("social.scenius.createCirclePost")).toBe(2);
  } finally { await applet.remove(); }
});

/** An HTML applet that tries what it shouldn't, once each, and writes what happened. */
const hostile = `<pre id="out">running</pre>
<script>
(async function () {
  var P = window.parachute, T = P.techne, r = {};
  async function step(name, f) { try { r[name] = { ok: true, v: await f() }; } catch (e) { r[name] = { ok: false, code: e.code || null, msg: String(e.message || e) }; } }
  await P.ready();
  await step("me", function () { return T.me(); });
  await step("read", function () { return T.call("social.scenius.getProfile", { params: { did: "${maya.did}" } }); });
  await step("deleteAccount", function () { return T.call("social.scenius.deleteAccount", { input: { code: "000000" } }); });
  await step("methods", function () { return T.call("pub.techne.draft.identity.manageMethods", { input: {} }); });
  await step("follow", function () { return T.call("social.scenius.offerConnection", { input: { subject: "did:plc:someone" } }); });
  await step("untapped", function () { return T.call("social.scenius.createCirclePost", { input: { collective: "${CIRCLE}", post: { text: "spam", createdAt: new Date().toISOString() } } }); });
  await step("plain", function () { return P.services.fetch("appview", "social.scenius.deleteAccount", { method: "POST", body: "{}" }); });
  var out = document.getElementById("out"); out.textContent = JSON.stringify(r); out.setAttribute("data-done", "1");
})();
</script>`;

test("techne: a hostile applet reaches no unlisted method, no write its card doesn't name, no write without a tap, and not the AppView as a service", async ({ page }) => {
  test.setTimeout(90_000);
  await withKey(page);
  const note = await record(hubState(), "create", {
    path: "Applets/Techne probe", extension: "html", tags: ["applet"], body: hostile,
    fields: { applet: { contract: 2, id: "techne-probe", name: "Techne probe" }, needs: 8, techne: { at: `${ap.origin}/`, can: ["read", "post"] },
      services: [{ id: "appview", kind: "http", url: `${ap.origin}/xrpc/`, auth: "nip98" }] },
  });
  const from = ap.seen.length;
  try {
    await page.goto(`/v/${VAULT}?with=vault`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Techne probe/ }).click();
    // the AppView as a plain service was refused: the card names no server to sign requests for
    await expect(page.getByRole("region", { name: /asking for access/ })).not.toContainText("send requests to");
    await page.getByRole("button", { name: "Allow" }).click();
    const out = page.frameLocator("iframe.applet-frame").locator("#out[data-done]");
    await expect(out).toBeAttached({ timeout: 30_000 });
    const r = JSON.parse(await out.textContent() ?? "{}") as Record<string, { ok: boolean; code: string | null; msg: string; v?: unknown }>;
    expect(r.me).toMatchObject({ ok: true, v: { did: maya.did } });
    expect(r.read).toMatchObject({ ok: true, v: { displayName: "Maya Example" } });
    expect(r.deleteAccount).toMatchObject({ ok: false, code: "out_of_scope" });
    expect(r.methods).toMatchObject({ ok: false, code: "out_of_scope" });
    expect(r.follow).toMatchObject({ ok: false, code: "out_of_scope" });
    expect(r.untapped).toMatchObject({ ok: false });
    expect(r.untapped.msg).toMatch(/while you tap/);
    // its service at the AppView was refused whole, so it has no services at all
    expect(r.plain).toMatchObject({ ok: false, code: "unknown_namespace" });
    // and none of it reached the AppView
    const reached = ap.seen.slice(from).map((s) => s.nsid);
    expect(reached.filter((n) => !["com.atproto.server.getSession", "social.scenius.getProfile"].includes(n))).toEqual([]);
  } finally { await api(hubState(), "DELETE", `notes/${note.id}`).catch(() => {}); }
});
