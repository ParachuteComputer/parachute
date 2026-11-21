// Home for a person with rooms and a journal (applets/today.tsx), the bundle record's home, against our real Buzz relay.
// Local only, as rooms.spec.ts (e2e/services/README.md): BUZZ_RELAY and BUZZ_KEYS. "Uni" here is bob's key: what he
// asks shows under Wants you, his newest line under From Uni; a line written on Home lands in today's journal; a tap on
// a room opens Rooms at that room (app.open with the launch a notification's tap carries).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { getPublicKey } from "nostr-tools/pure";
import * as nip44 from "nostr-tools/nip44";
import { api, hubState, VAULT } from "./hub";
import { installApplet } from "./helpers";
import { person } from "./services/client";

const RELAY = process.env.BUZZ_RELAY;
const KEYS = process.env.BUZZ_KEYS ?? "";
test.skip(!RELAY || !KEYS, "needs our Buzz relay (BUZZ_RELAY, BUZZ_KEYS): e2e/services/README.md");
test.use({ storageState: "e2e/.signed-in.json" });

const secret = (n: string) => readFileSync(join(KEYS, `${n}.hex`), "utf8").trim();
const frame = (page: Page) => page.frameLocator("iframe.applet-frame");
type Row = { id: string; path: string };
const rows = async (q: string) => { const r = await api(hubState(), "GET", q); return (Array.isArray(r) ? r : r.notes ?? []) as Row[]; };

test("Home: what wants you, the latest from Uni, today's journal and a line for it; a tap opens Rooms at the room", async ({ page }) => {
  test.setTimeout(150_000);
  const alice = getPublicKey(Uint8Array.from(Buffer.from(secret("alice"), "hex")));
  const bob = await person(RELAY!, secret("bob"));
  const stamp = Date.now().toString(36);
  const owner = await person(RELAY!, secret("owner"));
  const room = crypto.randomUUID();
  for (const p of [alice, bob.pubkey]) await owner.publish({ kind: 9030, tags: [["p", p]] });
  expect((await owner.publish({ kind: 9007, tags: [["h", room], ["name", `Garden ${stamp}`], ["visibility", "private"], ["channel_type", "stream"]] })).ok).toBe(true);
  for (const p of [alice, bob.pubkey]) expect((await owner.publish({ kind: 9000, tags: [["h", room], ["p", p]] })).ok).toBe(true);
  owner.close();
  const until = Math.floor(Date.now() / 1000) + 3600;
  const ask = await bob.publish({ kind: 9, content: `Which bed?\n\n\`\`\`uni-ask\n${JSON.stringify({ v: 1, kind: "choose", what: `Where should the garlic go ${stamp}?`, why: "This week.", until, options: [{ id: "n", label: "North" }, { id: "s", label: "South" }] })}\n\`\`\``, tags: [["h", room], ["p", alice]] });
  expect(ask.ok).toBe(true);
  await new Promise((r) => setTimeout(r, 1100));
  expect((await bob.publish({ kind: 9, content: `The beans are up ${stamp}.`, tags: [["h", room]] })).ok).toBe(true);
  // a line that names alice (not an ask): it wants her until she reads or writes in the room
  expect((await bob.publish({ kind: 9, content: `Could you water the beans ${stamp}?`, tags: [["h", room], ["p", alice]] })).ok).toBe(true);

  await page.addInitScript((k) => { if (window === window.top) (window as unknown as { __parachuteE2EKey: string }).__parachuteE2EKey = k; }, secret("alice"));
  const rooms = await installApplet("rooms", { relay: RELAY!, uni: bob.pubkey });
  const home = await installApplet("today", { relay: RELAY!, uni: bob.pubkey });
  const made: string[] = [];
  // one settings note and bundle record: a spec before this one may have left them
  for (const t of ["parachute-settings", "parachute-bundle", "parachute-app"]) for (const n of await rows(`notes?tag=${t}`)) await api(hubState(), "DELETE", `notes/${n.id}`);
  try {
    made.push((await api(hubState(), "POST", "notes", { path: "Parachute/Bundles/uni", content: "an app", tags: ["parachute-bundle"], metadata: { bundle: {
      contract: 1, id: "uni", name: "Uni", sources: [{ vault: VAULT, applet: "*" }], start: { vault: VAULT, applet: "Applets/Home" },
      bar: [{ vault: VAULT, applet: "Applets/Home" }, { vault: VAULT, applet: "Applets/Rooms" }] } } })).id);
    made.push((await api(hubState(), "POST", "notes", { path: "Parachute/Settings", content: "settings", tags: ["parachute-settings"], metadata: { parachute: { bundle: "uni" } } })).id);
    await page.goto("about:blank");
    await page.goto("/");
    // the record's home opens, and asks: its relay (read only) and Journal/
    const card = page.getByRole("region", { name: /asking for access/ });
    await expect(card).toContainText("Home");
    await expect(card).toContainText(new URL(RELAY!.replace(/^ws/, "http")).host);
    await page.getByRole("button", { name: "Allow" }).click();
    const app = frame(page);
    await expect(app.getByRole("region", { name: "Wants you" })).toContainText(`Where should the garlic go ${stamp}?`, { timeout: 30_000 });
    await expect(app.getByRole("region", { name: "Wants you" })).toContainText(`Could you water the beans ${stamp}?`);
    await expect(app.getByText(/^\d+ things want you\.$/)).toBeVisible();
    await expect(app.getByRole("region", { name: "From Uni" })).toContainText(`The beans are up ${stamp}.`);
    await expect(app.getByRole("region", { name: "Today's journal" })).toBeVisible();

    // a line for today's journal: written where the Journal applet keeps entries
    await app.getByLabel("A line for your journal").fill(`Planted garlic ${stamp}`);
    await app.getByRole("button", { name: "Save" }).click();
    await expect(app.getByRole("region", { name: "Today's journal" })).toContainText(`Planted garlic ${stamp}`);
    const d = new Date(), pad = (n: number) => String(n).padStart(2, "0");
    const written = (await rows(`notes?path_prefix=${encodeURIComponent(`Journal/${d.getFullYear()}/${pad(d.getMonth() + 1)}-${pad(d.getDate())}/`)}&limit=50`)).filter((n) => n.path.includes(`Planted garlic ${stamp}`));
    expect(written).toHaveLength(1);
    made.push(written[0].id);

    // away and back (the app keeps Home running meanwhile): what happened meanwhile is there. Alice answered in the room
    // (so bob's earlier line no longer wants her) and bob named her again.
    const bar = page.getByRole("navigation", { name: "Bar" });
    await bar.getByRole("link", { name: /Rooms/ }).click();
    await expect(page).toHaveURL(new RegExp(`/a/${rooms.id}`));
    const her = await person(RELAY!, secret("alice"));
    expect((await her.publish({ kind: 9, content: `On it ${stamp}.`, tags: [["h", room]] })).ok).toBe(true);
    her.close();
    await new Promise((r) => setTimeout(r, 1100));
    expect((await bob.publish({ kind: 9, content: `Bring the trowel ${stamp}?`, tags: [["h", room], ["p", alice]] })).ok).toBe(true);
    await bar.getByRole("link", { name: /Home/ }).click();
    await expect(app.getByRole("region", { name: "Wants you" })).toContainText(`Bring the trowel ${stamp}?`, { timeout: 30_000 });
    await expect(app.getByRole("region", { name: "Wants you" })).not.toContainText(`Could you water the beans ${stamp}?`);
    await expect(app.getByRole("region", { name: "Wants you" })).toContainText(`Where should the garlic go ${stamp}?`);
    // read on another device (the read state Rooms keeps, sealed to her own key): that line no longer wants her either
    const sk = Uint8Array.from(Buffer.from(secret("alice"), "hex"));
    const marks = JSON.stringify({ v: 1, client_id: "e2e-other-device", contexts: { [room]: Math.floor(Date.now() / 1000) + 1 } });
    const reader = await person(RELAY!, secret("alice"));
    expect((await reader.publish({ kind: 30078, content: nip44.encrypt(marks, nip44.getConversationKey(sk, alice)), tags: [["d", `read-state:e2e${stamp}`], ["t", "read-state"]] })).ok).toBe(true);
    reader.close();
    await bar.getByRole("link", { name: /Rooms/ }).click();
    await expect(page).toHaveURL(new RegExp(`/a/${rooms.id}`));
    await bar.getByRole("link", { name: /Home/ }).click();
    await expect(app.getByRole("region", { name: "Wants you" })).not.toContainText(`Bring the trowel ${stamp}?`, { timeout: 30_000 });
    await expect(app.getByRole("region", { name: "Wants you" })).toContainText(`Where should the garlic go ${stamp}?`);

    // the bar is the record's pins; a tap on the ask opens Rooms at that room and message
    await expect(bar.getByRole("link", { name: /Rooms/ })).toBeVisible();
    await app.getByRole("region", { name: "Wants you" }).getByRole("button", { name: new RegExp(`garlic go ${stamp}`) }).click();
    await expect(page).toHaveURL(new RegExp(`/a/${rooms.id}\\?room=${room}&event=${ask.ev.id}$`));
  } finally {
    for (const id of made) await api(hubState(), "DELETE", `notes/${id}`).catch(() => {});
    await home.remove(); await rooms.remove(); bob.close();
  }
});
