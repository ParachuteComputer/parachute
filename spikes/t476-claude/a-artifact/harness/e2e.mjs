// Drive Spike A as a viewer would, against the throwaway vault, and check the vault itself after each write.
// usage: node e2e.mjs <harness url> <screenshot dir>
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW ?? "playwright");
const { rpc } = await import("../../tools/mcp.mjs");
const [url, shots] = process.argv.slice(2); mkdirSync(shots, { recursive: true });
const tool = async (name, args) => JSON.parse((await rpc("tools/call", { name, arguments: args })).content[0].text);
const byPath = async (p) => tool("query-records", { id: p });
const ok = (c, m) => { if (!c) { console.log("FAIL", m); process.exitCode = 1; } else console.log("ok  ", m); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 720 }, colorScheme: "light" });
await page.goto(url);
await page.waitForSelector("#consent", { state: "visible" });
ok(await page.isVisible("text=Allow this artifact to use Parachute?"), "first call asks the viewer");
await page.screenshot({ path: `${shots}/a1-consent.png` });
await page.click("#allow");
const f = page.frameLocator("#frame");
await f.locator("#open li .title").first().waitFor();
const openTitles = await f.locator("#open li .title").allTextContents();
ok(openTitles.length === 3 && openTitles[0] === "Send Jonah the shop mockups", `three open tasks, earliest due first: ${openTitles.join(" | ")}`);
ok((await f.locator("#done li .title").allTextContents()).includes("Book the hall for the swap"), "the done task is under Done");
await page.screenshot({ path: `${shots}/a2-list.png` });

// tick one done
await f.locator("#open li", { hasText: "Order seed packets" }).locator(".tick").click();
await f.locator("#done li", { hasText: "Order seed packets" }).waitFor();
ok((await byPath("Tasks/Order seed packets")).fields.status === "done", "tick wrote status=done to the vault");

// edit a note
const sub = f.locator("#open li", { hasText: "Draft the brand rules" }).locator(".sub");
await sub.click(); await sub.press("End"); await sub.type(" Ask Tala for the sheet.");
await sub.press("Enter");
await page.waitForTimeout(800);
ok((await byPath("Tasks/Draft the brand rules")).body === "Voice, colours, character sheets. Ask Tala for the sheet.", "note edit wrote the body");
await page.screenshot({ path: `${shots}/a3-after-edits.png` });

// a refresh while the person is typing a note doesn't throw the typing away
const typing = f.locator("#open li", { hasText: "Send Jonah the shop mockups" }).locator(".sub");
await typing.click(); await typing.press("End"); await typing.type(" Mention the kiln.");
await f.locator(".meta button").evaluate((b) => b.click());   // refresh, without taking the focus
await page.waitForTimeout(800);
await page.keyboard.type(" Soon.");                            // keeps typing where the caret was
await page.keyboard.press("Enter"); await page.waitForTimeout(800);
ok((await byPath("Tasks/Send Jonah the shop mockups")).body.endsWith("Mention the kiln. Soon."), "a refresh mid-edit keeps the note and the caret; the whole edit is written when done");

// the shell's call route holds the manifest itself: an undeclared tool, or a page's own no-cors post, gets nothing
const raw = (ct, tool) => page.evaluate(async ([ct, tool]) => { const r = await fetch("/api/call", { method: "POST", headers: { "content-type": ct }, body: JSON.stringify({ server: "Parachute", tool, input: { id: "Tasks/Order seed packets" } }) }); return [r.status, await r.text()]; }, [ct, tool]);
ok((await raw("text/plain", "query-records"))[0] === 415, "the call route refuses a non-JSON post (what a sandboxed page could send)");
ok((await raw("application/json", "delete-record"))[1].includes("not_in_manifest"), "the call route refuses a tool the manifest doesn't declare");
ok((await byPath("Tasks/Order seed packets")).error_type === undefined, "and the record is still there");

// a change made elsewhere (another AI, the app) after the page read: the page's write is refused, not lost
const before = await byPath("Tasks/Send Jonah the shop mockups");
await tool("update-record", { id: before.id, fields: { due: "2026-11-26" }, if_updated_at: before.updatedAt });
await f.locator("#open li", { hasText: "Send Jonah the shop mockups" }).locator(".tick").click();
await f.locator("#note").filter({ hasText: "changed somewhere else" }).waitFor({ timeout: 5000 });
const after = await byPath("Tasks/Send Jonah the shop mockups");
ok(after.fields.status === "open" && after.fields.due === "2026-11-26", "stale write refused; the other change kept");
ok(await f.locator("#open li", { hasText: "Send Jonah the shop mockups" }).locator("input.due").inputValue() === "2026-11-26", "the page reloaded the other change");
await page.waitForTimeout(500);
ok((await f.locator("#note").textContent()).includes("changed somewhere else"), "the conflict message stays after the reload");
await page.screenshot({ path: `${shots}/a4-conflict.png` });
console.log("calls:", await page.textContent("#stats"));
await browser.close();
