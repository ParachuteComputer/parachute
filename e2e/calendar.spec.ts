// Calendar (applets/calendar.tsx) over a calendar door: the next two weeks by day, an event's detail, and the everyday
// changes (move one, add one, cancel one, one day of a weekly series), each signed by the shell as the person (NIP-98) and checked on the door.
// In CI against a fake door with the door's own checks (e2e/services/servers.ts startCalendar). Against the real door
// (~/Code/uni-calendar, `uni-cal serve` on a throwaway vault) with CAL_DOOR (its address) and CAL_KEY (a file with the
// hex key it maps to its owner): the browser reaches it through a pass-through that adds CORS on 127.0.0.1:19953, which
// the door must list in its public_urls (the app itself sends from its native side).
import { readFileSync } from "node:fs";
import { randomBytes, createHash } from "node:crypto";
import { expect, test } from "./test";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { hubState, record, VAULT } from "./hub";
import { ui } from "./helpers";
import { corsProxy } from "./services/client";
import { startCalendar } from "./services/servers";
import { appletRecord } from "../applets/record.ts";

test.use({ storageState: "e2e/.signed-in.json" });
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

/** The door, as a script signed with the owner's key reaches it. */
function doorAs(base: string, secretHex: string) {
  const sk = Uint8Array.from(Buffer.from(secretHex, "hex"));
  return async (path: string, body?: unknown) => {
    const url = `${base}/cal/v1/${path}`, raw = body === undefined ? undefined : JSON.stringify(body);
    const tags = [["u", url], ["method", raw ? "POST" : "GET"], ["nonce", randomBytes(8).toString("hex")], ...(raw ? [["payload", createHash("sha256").update(raw).digest("hex")]] : [])];
    const ev = finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), content: "", tags }, sk);
    const r = await fetch(url, { method: raw ? "POST" : "GET", headers: { authorization: `Nostr ${Buffer.from(JSON.stringify(ev)).toString("base64")}`, "content-type": "application/json" }, body: raw });
    const out = await r.json();
    if (r.status >= 300) throw new Error(`${path}: ${r.status} ${JSON.stringify(out)}`);
    return out;
  };
}
/** Tomorrow at h:00 on this machine (the browser's clock and zone are the machine's). */
const tomorrowAt = (h: number) => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(h, 0, 0, 0); return d; };

test("calendar: tomorrow's event shown, moved, a new one added and cancelled, each on the door", async ({ page }) => {
  test.setTimeout(120_000);
  const real = process.env.CAL_DOOR;
  const key = real ? readFileSync(process.env.CAL_KEY!, "utf8").trim() : hex(generateSecretKey());
  const fake = real ? null : await startCalendar(getPublicKey(Uint8Array.from(Buffer.from(key, "hex"))));
  const proxy = real ? await corsProxy(real, 19953) : null;
  const base = real ? real : fake!.origin, browserBase = proxy ? proxy.url : fake!.origin;
  const door = doorAs(base, key);
  const stamp = randomBytes(3).toString("hex");
  await page.addInitScript((k) => { if (window === window.top) (window as unknown as { __parachuteE2EKey: string }).__parachuteE2EKey = k; }, key);
  const made = await door("op", { op: "create", opId: `seed-${stamp}`, fields: { title: `Seed swap ${stamp}`, start: tomorrowAt(10).toISOString(), end: tomorrowAt(11).toISOString(), location: "The library" } });
  const note = await record(hubState(), "create", appletRecord("calendar", { calendar: `${browserBase}/cal/v1/` }));
  try {
    await page.goto(`/v/${VAULT}?with=vault`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Calendar/ }).click();
    const card = page.getByRole("region", { name: /asking for access/ });
    await expect(card).toContainText(`send requests to ${new URL(browserBase).host} on this device signed as you`);
    await page.getByRole("button", { name: "Allow" }).click();
    const app = page.frameLocator("iframe.applet-frame");

    // tomorrow's event, under Tomorrow, with its time and place
    const tomorrow = app.getByRole("region", { name: /^Tomorrow/ });
    const row = app.getByRole("button", { name: new RegExp(`Seed swap ${stamp}`) });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(tomorrow).toContainText(`Seed swap ${stamp}`);
    await expect(row).toContainText("The library");

    // its detail, then Move to 14:00-15:00: the door has it there, one rev on
    await row.click();
    await expect(app.getByRole("heading", { name: `Seed swap ${stamp}` })).toBeVisible();
    await app.getByRole("button", { name: "Move…" }).click();
    await app.getByLabel("Starts", { exact: true }).fill("14:00");
    await app.getByRole("button", { name: "Move", exact: true }).click();
    await expect(app.getByRole("button", { name: new RegExp(`Seed swap ${stamp}`) })).toBeVisible();
    // the new start, and the same hour's length (the door keeps it)
    await expect.poll(async () => { const e = await door(`event/${made.id}`); return [Date.parse(e.start), Date.parse(e.end), e.rev]; }).toEqual([tomorrowAt(14).getTime(), tomorrowAt(15).getTime(), made.rev + 1]);

    // add one tomorrow at 9:00-9:30, then cancel it: it leaves the list, and the door has it cancelled
    await app.getByRole("button", { name: "Add an event" }).click();
    await app.getByLabel("What", { exact: true }).fill(`Tea with Robin ${stamp}`);
    const d = tomorrowAt(9);
    await app.getByLabel("Day", { exact: true }).fill(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    await app.getByLabel("From", { exact: true }).fill("09:00");
    await app.getByLabel("To", { exact: true }).fill("09:30");
    await app.getByRole("button", { name: "Add", exact: true }).click();
    const tea = app.getByRole("button", { name: new RegExp(`Tea with Robin ${stamp}`) });
    await expect(tea).toBeVisible();
    const window = await door(`events?from=${encodeURIComponent(tomorrowAt(0).toISOString())}&to=${encodeURIComponent(tomorrowAt(23).toISOString())}`);
    const added = (window.instances as { id: string; title: string; start: string; end: string }[]).find((i) => i.title === `Tea with Robin ${stamp}`)!;
    expect([Date.parse(added.start), Date.parse(added.end)]).toEqual([tomorrowAt(9).getTime(), tomorrowAt(9).getTime() + 30 * 60_000]);
    await tea.click();
    await app.getByRole("button", { name: "Cancel…" }).click();
    await app.getByRole("button", { name: "Cancel the event" }).click();
    await expect(app.getByRole("button", { name: new RegExp(`Tea with Robin ${stamp}`) })).toHaveCount(0);
    await expect.poll(async () => (await door(`event/${added.id}`)).status).toBe("cancelled");
  } finally {
    await fetch(`${hubState().origin}/vault/${VAULT}/api/notes/${note.id}`, { method: "DELETE", headers: { authorization: `Bearer ${hubState().token}` } }).catch(() => {});
    await proxy?.close();
    await fake?.close();
  }
});

test("calendar: one day of a weekly series cancelled, and a change made elsewhere meanwhile is said and shown", async ({ page }) => {
  test.setTimeout(120_000);
  const real = process.env.CAL_DOOR;
  const key = real ? readFileSync(process.env.CAL_KEY!, "utf8").trim() : hex(generateSecretKey());
  const fake = real ? null : await startCalendar(getPublicKey(Uint8Array.from(Buffer.from(key, "hex"))));
  const proxy = real ? await corsProxy(real, 19953) : null;
  const base = real ? real : fake!.origin, browserBase = proxy ? proxy.url : fake!.origin;
  const door = doorAs(base, key);
  const stamp = randomBytes(3).toString("hex");
  await page.addInitScript((k) => { if (window === window.top) (window as unknown as { __parachuteE2EKey: string }).__parachuteE2EKey = k; }, key);
  // a weekly walk from tomorrow (twice in the two weeks shown), and a one-off the door will change behind the app
  const walk = await door("op", { op: "create", opId: `walk-${stamp}`, fields: { title: `Walk ${stamp}`, start: tomorrowAt(8).toISOString(), end: tomorrowAt(9).toISOString(), rrule: "FREQ=WEEKLY" } });
  const call = await door("op", { op: "create", opId: `call-${stamp}`, fields: { title: `Call ${stamp}`, start: tomorrowAt(16).toISOString(), end: tomorrowAt(17).toISOString() } });
  const note = await record(hubState(), "create", appletRecord("calendar", { calendar: `${browserBase}/cal/v1/` }));
  try {
    await page.goto(`/v/${VAULT}?with=vault`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Calendar/ }).click();
    await page.getByRole("button", { name: "Allow" }).click();
    const app = page.frameLocator("iframe.applet-frame");
    const walks = app.getByRole("button", { name: new RegExp(`Walk ${stamp}`) });
    await expect(walks).toHaveCount(2, { timeout: 30_000 });
    // cancel tomorrow's walk only: next week's stays, here and on the door
    await walks.first().click();
    await expect(app.getByText("Changes here are to this day only")).toBeVisible();
    await app.getByRole("button", { name: "Cancel…" }).click();
    await app.getByRole("button", { name: "Cancel this day" }).click();
    await expect(walks).toHaveCount(1);
    const next = await door(`events?from=${encodeURIComponent(tomorrowAt(0).toISOString())}&to=${encodeURIComponent(new Date(tomorrowAt(0).getTime() + 14 * 86_400_000).toISOString())}`);
    expect((next.instances as { id: string; status: string }[]).filter((i) => i.id === walk.id && i.status !== "cancelled")).toHaveLength(1);

    // the call is renamed elsewhere (the Uni app, a sync) after the app read it; Move then says so and shows it as it is
    await app.getByRole("button", { name: new RegExp(`Call ${stamp}`) }).click();
    await door("op", { op: "update", opId: `rename-${stamp}`, id: call.id, base_rev: call.rev, fields: { title: `Call with Sam ${stamp}` } });
    await app.getByRole("button", { name: "Move…" }).click();
    await app.getByLabel("Starts", { exact: true }).fill("18:00");
    await app.getByRole("button", { name: "Move", exact: true }).click();
    await expect(app.getByText("It changed elsewhere since; here it is now.")).toBeVisible();
    await expect(app.getByRole("button", { name: new RegExp(`Call with Sam ${stamp}`) })).toBeVisible();
    expect(Date.parse((await door(`event/${call.id}`)).start)).toBe(tomorrowAt(16).getTime());
  } finally {
    await fetch(`${hubState().origin}/vault/${VAULT}/api/notes/${note.id}`, { method: "DELETE", headers: { authorization: `Bearer ${hubState().token}` } }).catch(() => {});
    await proxy?.close();
    await fake?.close();
  }
});

test("calendar: a door that refuses the key says so", async ({ page }) => {
  const key = hex(generateSecretKey());
  const fake = await startCalendar(getPublicKey(generateSecretKey()));  // maps someone else's key
  await page.addInitScript((k) => { if (window === window.top) (window as unknown as { __parachuteE2EKey: string }).__parachuteE2EKey = k; }, key);
  const note = await record(hubState(), "create", appletRecord("calendar", { calendar: `${fake.origin}/cal/v1/` }));
  try {
    await page.goto(`/v/${VAULT}?with=vault`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Calendar/ }).click();
    await page.getByRole("button", { name: "Allow" }).click();
    const app = page.frameLocator("iframe.applet-frame");
    await expect(app.getByText("Couldn't reach your calendar.")).toBeVisible({ timeout: 30_000 });
    await expect(app.getByText(/pubkey not allowed/)).toBeVisible();
  } finally {
    await fetch(`${hubState().origin}/vault/${VAULT}/api/notes/${note.id}`, { method: "DELETE", headers: { authorization: `Bearer ${hubState().token}` } }).catch(() => {});
    await fake.close();
  }
});
