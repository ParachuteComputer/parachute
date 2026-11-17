// Matrix (applets/matrix.tsx) against a real homeserver: the broker's `token` services. The person gives the app a token
// for the homeserver in Settings (never the applet); the app adds it to the applet's requests. Alice reads the room bob
// writes in, sends, and bob reads it. Local only (e2e/services/README.md): MATRIX_HS (the homeserver), MATRIX_TOKENS (a
// folder with alice.token and bob.token), BUZZ_KEYS (alice.hex: the key the app signs with).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { api, hubState, record, VAULT } from "./hub";
import { ui } from "./helpers";
import { appletRecord } from "../applets/record.ts";

const HS = process.env.MATRIX_HS;
const TOKENS = process.env.MATRIX_TOKENS ?? "";
const KEYS = process.env.BUZZ_KEYS ?? "";
test.skip(!HS || !TOKENS || !KEYS, "needs a Matrix homeserver (MATRIX_HS, MATRIX_TOKENS, BUZZ_KEYS): e2e/services/README.md");
test.use({ storageState: "e2e/.signed-in.json" });

test("matrix: the token is given to the app, never the applet; alice and bob talk in a room", async ({ page }) => {
  test.setTimeout(120_000);
  const stamp = Date.now().toString(36);
  const token = (n: string) => readFileSync(join(TOKENS, `${n}.token`), "utf8").trim();
  const bob = async (path: string, init: RequestInit = {}) => (await fetch(`${HS}/_matrix/client/${path}`, { ...init, headers: { authorization: `Bearer ${token("bob")}`, "content-type": "application/json" } })).json();
  const rooms = (await bob("v3/joined_rooms")).joined_rooms as string[];
  const garden = (await Promise.all(rooms.map(async (id) => ({ id, name: (await bob(`v3/rooms/${encodeURIComponent(id)}/state/m.room.name`)).name })))).find((r) => r.name === "Garden")!.id;
  await bob(`v3/rooms/${encodeURIComponent(garden)}/send/m.room.message/t${stamp}`, { method: "PUT", body: JSON.stringify({ msgtype: "m.text", body: `The peas are up ${stamp}` }) });
  await page.addInitScript((k) => { if (window === window.top) (window as unknown as { __parachuteE2EKey: string }).__parachuteE2EKey = k; }, readFileSync(join(KEYS, "alice.hex"), "utf8").trim());
  const note = await record(hubState(), "create", appletRecord("matrix", { homeserver: HS! }));
  try {
    const open = async () => { await page.goto(`/v/${VAULT}`); await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Matrix/ }).click(); };
    await open();
    const card = page.getByRole("region", { name: /asking for access/ });
    await expect(card).toContainText(`Use a token you give it for ${new URL(HS!).host} on this device`);
    await page.getByRole("button", { name: "Allow" }).click();
    const app = page.frameLocator("iframe.applet-frame");
    // no token yet: the homeserver refuses, and the applet says where to give one (it can't take one itself)
    await expect(app.getByRole("alert")).toContainText("Give this applet one in Settings");

    // Settings: give the app the token, on the app's own screen
    await page.goto("/settings");
    await page.getByRole("button", { name: "Give it a token" }).click();
    await page.getByLabel(`Token for ${new URL(HS!).host} on this device`).fill(token("alice"));
    await page.getByRole("button", { name: "Keep it" }).click();
    await expect(page.getByText(`A token for ${new URL(HS!).host} on this device is kept here.`)).toBeVisible();

    await open();
    const list = app.getByRole("list", { name: "Your Matrix rooms" });
    await expect(list.getByRole("button", { name: /Garden/ })).toContainText(`The peas are up ${stamp}`, { timeout: 20_000 });
    await list.getByRole("button", { name: /Garden/ }).click();
    await app.getByLabel("Message Garden").fill(`Lovely, I'll water them ${stamp}`);
    await app.getByRole("button", { name: "Send" }).click();
    await expect(app.getByRole("log").locator("article.mine", { hasText: `I'll water them ${stamp}` })).toBeVisible();
    // bob reads it on the homeserver; and what bob writes next arrives live (sync)
    const msgs = await bob(`v3/rooms/${encodeURIComponent(garden)}/messages?dir=b&limit=10`);
    expect((msgs.chunk as { content: { body?: string }; sender: string }[]).some((e) => e.content.body === `Lovely, I'll water them ${stamp}` && e.sender.startsWith("@alice"))).toBe(true);
    await bob(`v3/rooms/${encodeURIComponent(garden)}/send/m.room.message/u${stamp}`, { method: "PUT", body: JSON.stringify({ msgtype: "m.text", body: `Thanks! ${stamp}` }) });
    await expect(app.getByRole("log").locator("article", { hasText: `Thanks! ${stamp}` })).toBeVisible({ timeout: 30_000 });
    // the applet never saw the token: it is in no message it was sent
    expect(await app.locator("body").innerText()).not.toContain(token("alice"));
  } finally { await api(hubState(), "DELETE", `notes/${note.id}`); }
});
