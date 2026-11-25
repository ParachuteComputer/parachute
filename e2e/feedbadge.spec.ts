// An applet's own number on the bar (a feed signal, as Mail's unread): found on the emulator walk (T-476 dogfood),
// where Mail said "Inbox · 5" and the bar showed no count.
import { expect, test, type Page } from "./test";
import { api, hubState, record } from "./hub";
import { barOf } from "./helpers";

test.use({ storageState: "e2e/.signed-in.json" });

const bar = (page: Page) => page.getByRole("navigation", { name: "Bar" });
const CODE = `import { useEffect } from "react";
import { signal } from "parachute";
export default function Inbox() { useEffect(() => { void signal("unread", 4); }, []); return <main><h1>Inbox</h1></main>; }
`;

test("an applet's own count (a feed signal) shows on the bar once it has said it", async ({ page }) => {
  test.setTimeout(90_000);
  const stamp = Date.now().toString(36);
  const path = `Applets/Inbox ${stamp}`;
  const made = (await record(hubState(), "create", { path, extension: "tsx", tags: ["applet"], body: CODE, fields: {
    applet: { contract: 2, id: "inbox", name: "Inbox", glyph: "✉", note: "a test applet", access: [] },
    services: [{ id: "mail", kind: "http", url: "http://127.0.0.1:9/mail/" }],
    signals: [{ id: "unread", name: "unread mail", from: { service: "mail", feed: "unread" } }],
  } })) as { id: string };
  // the applet alone on the bar, in the settings note the suite may already hold (put back after)
  const restore = await barOf(path);
  try {
    await page.goto("about:blank");
    await page.goto("/");
    await bar(page).getByRole("link", { name: /Inbox/ }).click();
    await page.getByRole("button", { name: "Allow" }).click();
    await expect(page.frameLocator("iframe.applet-frame").getByRole("heading", { name: "Inbox" })).toBeVisible();
    await bar(page).getByRole("link", { name: "Applets" }).click();
    await expect(bar(page).getByRole("link", { name: /Inbox/ }).locator(".home-bar-badge")).toHaveText("4");
  } finally {
    await restore();
    await api(hubState(), "DELETE", `notes/${made.id}`).catch(() => {});
  }
});
