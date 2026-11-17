// The broker's promises (docs/design/SERVICES.md), end to end in the web build: an applet declares a relay and a
// NIP-98 server; the card says so; after Allow the shell signs in to the relay, publishes and subscribes for it, signs
// its requests, moves its files and its private notes, and refuses everything it didn't declare. The applet never sees
// the key. A changed address or changed code asks again. The servers are fakes with real checks (e2e/services/servers.ts);
// the key is the test signer's (a build with VITE_E2E_SIGNER=1), which signs what the shell's policy hands it.
import { expect, test, type Page } from "@playwright/test";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { api, hubState, record, VAULT } from "./hub";
import { ui } from "./helpers";
import { startHttp, startRelay } from "./services/servers";

test.use({ storageState: "e2e/.signed-in.json" });

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const sk = generateSecretKey();
const me = getPublicKey(sk);
const other = generateSecretKey();
// a 1×1 PNG
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

let relay: Awaited<ReturnType<typeof startRelay>>;
let http: Awaited<ReturnType<typeof startHttp>>;
test.beforeAll(async () => { relay = await startRelay(); http = await startHttp(); });
test.afterAll(async () => { await relay?.close(); await http?.close(); });

const withKey = (page: Page) => page.addInitScript((k) => { if (window === window.top) (window as unknown as { __parachuteE2EKey: string }).__parachuteE2EKey = k; }, hex(sk));
const services = (relayUrl: string, httpOrigin: string) => [
  { id: "rooms", kind: "nostr-relay", url: relayUrl, publish: [9, 5], media: true, private: [{ kind: 30078, d: "read-state:", t: "read-state" }] },
  { id: "mail", kind: "http", url: `${httpOrigin}/mail/`, auth: "nip98" },
];

/** An HTML applet that tries everything once and writes what happened. */
const code = (otherId: string, httpOrigin: string) => `<pre id="out">running</pre><img id="img" alt="uploaded"><audio id="aud"></audio>
<script>
(async function () {
  var P = window.parachute, S = P.services, r = {};
  async function step(name, f) { try { r[name] = { ok: true, v: await f() }; } catch (e) { r[name] = { ok: false, code: e.code || null, msg: String(e.message || e) }; } }
  await P.ready();
  await step("me", function () { return S.me(); });
  var relay = S.relay("rooms"), got = [];
  var stop = relay.subscribe([{ kinds: [9], "#h": ["room-1"] }], function (evs) { got = got.concat(evs.map(function (e) { return e.content; })); });
  await step("publish", function () { return relay.publish({ kind: 9, content: "hello from an applet", tags: [["h", "room-1"]] }); });
  await new Promise(function (res) { setTimeout(res, 800); });
  r.got = got;
  await step("profile", function () { return relay.publish({ kind: 0, content: "{}", tags: [] }); });
  await step("authTag", function () { return relay.publish({ kind: 9, content: "x", tags: [["h", "room-1"], ["u", "http://x.example/"]] }); });
  await step("deleteOther", function () { return relay.publish({ kind: 5, content: "", tags: [["e", "${otherId}"]] }); });
  await step("deleteMine", function () { return relay.publish({ kind: 5, content: "", tags: [["e", r.publish.v.id]] }); });
  await step("echo", function () { return S.fetch("mail", "echo", { method: "POST", body: "hi there", as: "json" }); });
  await step("escape", function () { return S.fetch("mail", "../account/mcp", {}); });
  await step("undeclared", function () { return S.fetch("elsewhere", "x", {}); });
  await step("direct", function () { return fetch("${httpOrigin}/mail/direct").then(function (x) { return x.status; }); });
  await step("keyHere", function () { return typeof window.__parachuteE2EKey; });
  await step("keyParent", function () { try { return typeof parent.__parachuteE2EKey; } catch (e) { return "blocked"; } });
  var png = Uint8Array.from(atob("${PNG}"), function (c) { return c.charCodeAt(0); });
  await step("upload", function () { return S.upload("rooms", png.buffer, "image/png"); });
  await step("media", async function () {
    var m = await S.media("rooms", r.upload.v.sha256, "png");
    var img = document.getElementById("img"); img.src = URL.createObjectURL(new Blob([m.bytes], { type: m.type })); await img.decode(); return img.naturalWidth;
  });
  await step("audio", async function () {
    var n = 8000, b = new ArrayBuffer(44 + n * 2), v = new DataView(b), w = function (o, s) { for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVEfmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true);
    var a = document.getElementById("aud");
    await new Promise(function (res, rej) { a.onloadedmetadata = res; a.onerror = function () { rej(new Error("audio refused " + (a.error && a.error.code) + " " + (a.error && a.error.message))); }; a.src = URL.createObjectURL(new Blob([b], { type: "audio/wav" })); });
    return a.duration > 0.5;
  });
  await step("private", async function () { await relay.savePrivate("read-state:t1", JSON.stringify({ v: 1, contexts: { "room-1": 5 } })); var l = await relay.loadPrivate("read-state:"); return l.map(function (x) { return x.text; }); });
  await step("privateOther", function () { return relay.savePrivate("wallet:x", "no"); });
  stop();
  var out = document.getElementById("out"); out.textContent = JSON.stringify(r); out.setAttribute("data-done", "1");
})();
</script>`;

const applet = (svc: unknown, body: string) => ({
  path: "Applets/Broker check", extension: "html", tags: ["applet"], body,
  fields: { applet: { contract: 2, id: "broker-check", name: "Broker check", access: [{ vault: "here", allow: [{ path: "Notes/", verbs: ["read"] }] }] }, services: svc },
});
const open = async (page: Page) => {
  await page.goto(`/v/${VAULT}`);
  await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Broker check/ }).click();
};
const frame = (page: Page) => page.frameLocator("iframe.applet-frame");

test("an applet reaches only the servers it declared, the shell signing for it; it never holds the key", async ({ page }) => {
  await withKey(page);
  const theirs = finalizeEvent({ kind: 9, content: "not yours", tags: [["h", "room-1"]], created_at: Math.floor(Date.now() / 1000) }, other);
  relay.events.push(theirs);
  const note = await record(hubState(), "create", applet(services(relay.url, http.origin), code(theirs.id, http.origin)));
  try {
    await open(page);
    const card = page.getByRole("region", { name: /asking for access/ });
    const host = new URL(relay.origin).host;
    await expect(card).toContainText(`Sign in to ${host} on this device as you`);
    await expect(card).toContainText("Post as you in your rooms there: messages");
    await expect(card).toContainText("Delete your messages and reactions there");
    await expect(card).toContainText("Send and open files there as you");
    await expect(card).toContainText(`Send requests to ${new URL(http.origin).host} on this device signed as you`);
    await expect(card).toContainText(`What it reads here could reach ${new URL(http.origin).host}`);
    // nothing reached any server before Allow
    expect(relay.signIns.length + http.seen.length).toBe(0);
    await page.getByRole("button", { name: "Allow" }).click();

    const out = frame(page).locator("#out[data-done]");
    await expect(out).toBeVisible({ timeout: 30_000 });
    const r = JSON.parse(await out.textContent() ?? "{}");
    // who it signs as, and the relay sign-in, for the declared relay only
    expect(r.me).toEqual({ ok: true, v: { pubkey: me } });
    expect(relay.signIns.map((e) => e.pubkey)).toContain(me);
    // a post, signed as the person, on the relay, and back through its subscription
    expect(r.publish.ok && r.publish.v.ok).toBe(true);
    expect(relay.events.some((e) => e.pubkey === me && e.kind === 9 && e.content === "hello from an applet")).toBe(true);
    expect(r.got).toContain("hello from an applet");
    expect(r.got).toContain("not yours");
    // kinds and tags it may not have signed
    expect(r.profile).toMatchObject({ ok: false, code: "out_of_scope" });
    expect(r.authTag).toMatchObject({ ok: false, code: "out_of_scope" });
    expect(relay.events.some((e) => e.kind === 0)).toBe(false);
    // deleting: its own post, yes; someone else's, no
    expect(r.deleteOther).toMatchObject({ ok: false, code: "out_of_scope" });
    expect(r.deleteMine.ok && r.deleteMine.v.ok).toBe(true);
    // a signed request to the declared server, for exactly that URL, method and body
    expect(r.echo).toMatchObject({ ok: true, v: { status: 200, body: { ok: true, pubkey: me, method: "POST", body: "hi there" } } });
    expect(r.echo.v.headers["set-cookie"]).toBeUndefined();
    expect(http.seen.filter((s) => s.url.endsWith("/mail/echo")).map((s) => s.error)).toEqual([null]);
    // a path out of its prefix, a service it didn't declare, the network itself: refused, and nothing was sent
    expect(r.escape).toMatchObject({ ok: false, code: "out_of_scope" });
    expect(r.undeclared).toMatchObject({ ok: false, code: "not_granted" });
    expect(r.direct.ok).toBe(false);
    expect(http.seen.some((s) => /account|direct/.test(s.url))).toBe(false);
    // the key is nowhere it can reach
    expect(r.keyHere.v).toBe("undefined");
    expect(r.keyParent.v).toBe("blocked");
    // a file up and back, drawn and played from blob: addresses
    expect(r.upload.ok).toBe(true);
    expect(r.media).toEqual({ ok: true, v: 1 });
    expect(r.audio).toEqual({ ok: true, v: true });
    expect(relay.media.map((m) => `${m.op}:${m.ok}`)).toEqual(["upload:true", "get:true"]);
    // its private notes: sealed on the relay, open only to it
    expect(r.private).toEqual({ ok: true, v: [JSON.stringify({ v: 1, contexts: { "room-1": 5 } })] });
    const sealed = relay.events.find((e) => e.kind === 30078 && e.pubkey === me);
    expect(sealed?.content).not.toContain("room-1");
    expect(r.privateOther).toMatchObject({ ok: false, code: "out_of_scope" });

    // the relay changes address: the card again, before anything runs
    const cur = await api(hubState(), "GET", `notes?id=${note.id}`);
    const moved = await startRelay();
    try {
      await record(hubState(), "update", { id: note.id, fields: applet(services(moved.url, http.origin), "").fields, if_updated_at: cur.updatedAt });
      await open(page);
      await expect(page.getByText("It now asks for something other than what you allowed.")).toBeVisible();
      await expect(page.locator("iframe.applet-frame")).toHaveCount(0);
      expect(moved.signIns.length).toBe(0);
    } finally { await moved.close(); }
    // and changed code asks again too
    const cur2 = await api(hubState(), "GET", `notes?id=${note.id}`);
    await record(hubState(), "update", { id: note.id, fields: applet(services(relay.url, http.origin), "").fields, body: `${code(theirs.id, http.origin)}<!-- changed -->`, if_updated_at: cur2.updatedAt });
    await open(page);
    await expect(page.getByText("code changed since you allowed it")).toBeVisible();
    await expect(page.locator("iframe.applet-frame")).toHaveCount(0);
  } finally { await api(hubState(), "DELETE", `notes/${note.id}`); }
});

test("a Parachute hub is never a service: the applet opens, and reaches nothing", async ({ page }) => {
  await withKey(page);
  const hub = hubState().origin;
  const body = `<pre id="out"></pre><script>parachute.ready().then(function () { return parachute.services.fetch("hub", "x", {}); }).then(function () { out.textContent = "reached"; }, function (e) { out.textContent = e.code; });</script>`;
  const note = await record(hubState(), "create", applet([{ id: "hub", kind: "http", url: `${hub}/vault/`, auth: "nip98" }], body));
  try {
    await open(page);
    const card = page.getByRole("region", { name: /asking for access/ });
    await expect(card).not.toContainText("signed as you");
    await page.getByRole("button", { name: "Allow" }).click();
    await expect(frame(page).locator("#out")).toHaveText("unknown_namespace");
  } finally { await api(hubState(), "DELETE", `notes/${note.id}`); }
});
