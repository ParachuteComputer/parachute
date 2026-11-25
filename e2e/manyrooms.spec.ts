// A person in a great many rooms (on our test relay, alice reached 220 after a day of runs): Rooms reads the list and
// searches it in calls that each fit the frame's request budget (contract.ts maxRequestBytes), instead of one call
// naming every room, which the shell refuses ("Couldn't read your rooms: too_large"). Against the fake relay, so CI
// runs it: the rooms are put straight into its store.
import { expect, test } from "./test";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { VAULT } from "./hub";
import { installApplet, ui } from "./helpers";
import { startRelay } from "./services/servers";

test.use({ storageState: "e2e/.signed-in.json" });

test("in 260 rooms the list reads, and a search reaches every room", async ({ page }) => {
  test.setTimeout(120_000);
  const relay = await startRelay();
  const sk = generateSecretKey(), me = getPublicKey(sk);
  const host = generateSecretKey(), at = Math.floor(Date.now() / 1000) - 60;
  const rooms = Array.from({ length: 260 }, (_, i) => ({ id: crypto.randomUUID(), name: `Bed ${i + 1}` }));
  // as a NIP-29 relay keeps them: who is in each room (39002) and what it is called (39000), signed by the relay
  for (const r of rooms) {
    relay.events.push(finalizeEvent({ kind: 39002, created_at: at, content: "", tags: [["d", r.id], ["p", me]] }, host));
    relay.events.push(finalizeEvent({ kind: 39000, created_at: at, content: "", tags: [["d", r.id], ["name", r.name]] }, host));
  }
  // one line in the last room, to find it by search
  relay.events.push(finalizeEvent({ kind: 9, created_at: at + 1, content: "the far bed needs mulch", tags: [["h", rooms[259].id]] }, generateSecretKey()));
  await page.addInitScript((k) => { if (window === window.top) (window as unknown as { __parachuteE2EKey: string }).__parachuteE2EKey = k; }, Buffer.from(sk).toString("hex"));
  const made = await installApplet("rooms", { relay: relay.url, uni: getPublicKey(generateSecretKey()) });
  try {
    await page.goto(`/v/${VAULT}?with=vault`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Rooms/ }).click();
    await page.getByRole("button", { name: "Allow" }).click();
    const app = page.frameLocator("iframe.applet-frame");
    const list = app.getByRole("region", { name: "Your rooms" });

    await expect(list.getByRole("button", { name: /^Bed 260\b/ })).toBeVisible({ timeout: 30_000 });
    await expect(list.getByRole("button")).toHaveCount(260);
    await expect(app.getByText(/Couldn't read your rooms/)).toHaveCount(0);
    await app.getByRole("searchbox", { name: "Search your rooms" }).fill("mulch");
    await app.getByRole("searchbox", { name: "Search your rooms" }).press("Enter");
    await expect(app.getByRole("region", { name: "Found" })).toContainText("the far bed needs mulch", { timeout: 15_000 });
  } finally {
    await made.remove();
    await relay.close();
  }
});
