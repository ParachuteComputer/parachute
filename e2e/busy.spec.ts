// An applet that asks a lot at once (a rooms list with twenty rooms, a room full of cards and pictures) gets every
// answer: the kit keeps its calls in line under the shell's limit (8 waiting, 60 in ten seconds) and waits out a busy
// refusal, so the applet never sees one (src/applet/kits/frameKit.ts). The limits stay in the shell as its safety net.
import { expect, test, type Page } from "@playwright/test";
import { api, hubState, record, VAULT } from "./hub";
import { ui } from "./helpers";

test.use({ storageState: "e2e/.signed-in.json" });
const frame = (page: Page) => page.frameLocator("iframe.applet-frame:visible");

// 20 vault reads (over the network, so they wait), 30 storage reads and 20 theme reads, all at once: past both the 8
// waiting and the 60 in ten seconds. Among them one call that can't be sent (a function can't be copied to the shell):
// it fails at once and alone. Then 20 writes of one key, past the window: they land in the order asked.
const CODE = `import { useEffect, useState } from "react";
import { storage, theme, vault } from "parachute";
export default function Busy() {
  const [said, setSaid] = useState("Asking…");
  useEffect(() => {
    const calls = [...Array.from({ length: 20 }, () => vault.queryRecords({ pathPrefix: "Busy/", limit: 5 })), ...Array.from({ length: 30 }, (_, i) => storage.get("k" + i)), ...Array.from({ length: 20 }, () => theme.get())];
    const unsendable = storage.get((() => 1) as any);
    const writes = Array.from({ length: 20 }, (_, i) => storage.set("last", i));
    Promise.allSettled([...calls, ...writes]).then(async (r) => {
      const refused = r.filter((x) => x.status === "rejected").map((x) => String((x as PromiseRejectedResult).reason?.code ?? (x as PromiseRejectedResult).reason?.message));
      const bad = (await Promise.allSettled([unsendable]))[0].status;
      const last = await storage.get("last");
      setSaid("Answered " + (r.length - refused.length) + " of " + r.length + (refused.length ? "; refused: " + [...new Set(refused)].join(", ") : "") + "; the unsendable one " + bad + "; last write " + last);
    });
  }, []);
  return <main><h1>Busy</h1><p id="said">{said}</p></main>;
}
`;
const ARGS = { path: "Applets/Busy", extension: "tsx", tags: ["applet"], body: CODE,
  fields: { applet: { contract: 2, id: "busy", name: "Busy", glyph: "◇", note: "a test applet", access: [{ vault: "here", allow: [{ path: "Busy/", verbs: ["read"] }] }] }, app: ["storage"] } };

test("ninety calls at once are all answered, in order: the kit keeps them in line and waits out the shell's refusals", async ({ page }) => {
  test.setTimeout(60_000);
  const note = await record(hubState(), "create", ARGS);
  try {
    await page.goto(`/v/${VAULT}`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Busy/ }).click();
    await page.getByRole("button", { name: "Allow" }).click();
    // the last thirty wait for the ten-second window to move on
    await expect(frame(page).locator("#said")).toHaveText("Answered 90 of 90; the unsendable one rejected; last write 19", { timeout: 40_000 });
  } finally {
    await api(hubState(), "DELETE", `notes/${note.id}`);
  }
});
