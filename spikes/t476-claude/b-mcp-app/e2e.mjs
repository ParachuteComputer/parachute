// Spike B, driven as a person would in the MCP Apps reference host (ext-apps basic-host), against the throwaway vault.
// The view's every read and write is the host's tools/call; the vault is checked directly after each write.
// usage: node e2e.mjs <basic-host url> <shots dir> [strict]   (strict: the view gets the spec's default CSP, no eval)
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const { chromium } = createRequire(import.meta.url)(process.env.PW ?? "playwright");
const { rpc } = await import("../tools/mcp.mjs");
const [url, shots, strict] = process.argv.slice(2); mkdirSync(shots, { recursive: true });
const rec = async (id) => JSON.parse((await rpc("tools/call", { name: "query-records", arguments: { id } })).content[0].text);
const ok = (c, m) => { if (!c) { console.log("FAIL", m); process.exitCode = 1; } else console.log("ok  ", m); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1180, height: 980 } });
const calls = [];
page.on("console", (m) => { const t = m.text(); const k = /Parsed message.*method: (tools\/call|resources\/read)/.exec(t); if (k) calls.push(k[1]); });
if (strict) {
  // the MCP Apps spec's default CSP for a view that declares no domains (apps.mdx): inline scripts, no eval
  const CSP = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' data:; connect-src 'none';";
  await page.route(/\/sandbox\.html/, async (route) => { const r = await route.fetch(); await route.fulfill({ response: r, headers: { ...r.headers(), "content-security-policy": CSP } }); });
  // a probe the view's own page runs first (test only): can it eval? (Playwright's evaluate is exempt from CSP, so ask the page)
  const PROBE = `<script>try{(0,eval)("1");window.__evalProbe="allowed"}catch(e){window.__evalProbe="refused"}</script>`;
  await page.route(/\/mcp$/, async (route) => {
    const r = await route.fetch(); const t = await r.text();
    if (!t.includes('"ui://parachute/applet-host"') || !t.includes("mcp-app")) return route.fulfill({ response: r, body: t });
    const j = JSON.parse(t); for (const c of j.result?.contents ?? []) if (c.text) c.text = c.text.replace("<head>", `<head>${PROBE}`);
    await route.fulfill({ response: r, body: JSON.stringify(j) });
  });
}
const view = () => page.frames().find((f) => f.url() === "about:blank");
const viewText = async () => (await view()?.evaluate(() => document.body.innerText).catch(() => "")) ?? "";
const until = async (fn, what, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await page.waitForTimeout(150); } console.log("timed out:", what); return false; };

async function callTool(args) {
  await page.goto(url);
  await page.waitForSelector("text=Call Tool");
  await page.waitForFunction(() => [...document.querySelectorAll("select")].some((s) => s.selectedOptions[0]?.textContent === "open-applet"));
  await page.fill("textarea", JSON.stringify(args));
  await page.click("text=Call Tool");
}

// 1. an entry point opens with {}: the vault's applets
await callTool({});
ok(await until(async () => /Library[\s\S]*People/.test(await viewText()), "launcher"), "open-applet {} shows the vault's applets: Library, People");
await page.screenshot({ path: `${shots}/b1-launcher.png` });
// the view's own realm: under the strict policy eval is refused, so the applet ran without it
if (strict) ok((await view().evaluate(() => window.__evalProbe).catch(() => null)) === "refused", "strict CSP in force in the view (its own script can't eval)");

// 2. People, the app's own applet record, run from the vault
await view().click("text=People");
ok(await until(async () => /4\s*people/i.test(await viewText()) && (await viewText()).includes("Maya Ortiz"), "people list"), "People lists the vault's four people");
await page.screenshot({ path: `${shots}/b2-people.png` });

// 3. a write from the view: Favorite on Maya → update-record through the host
await view().click("text=Maya Ortiz");
await until(async () => (await viewText()).includes("Edit details"), "detail");
ok((await viewText()).includes("Order seed packets"), "her detail shows the linked task (links cross the bridge)");
const before = await rec("People/Maya Ortiz");
await view().click("text=☆ Favorite");
ok(await until(async () => (await rec("People/Maya Ortiz")).fields.favorite === true, "favorite write"), "Favorite wrote fields.favorite = true to the vault");
const after = await rec("People/Maya Ortiz");
ok(after.updatedAt > before.updatedAt && after.fields.email === "maya@example.org", "the write merged: her other fields kept");
await page.screenshot({ path: `${shots}/b3-person.png` });

// 4. opened by name, as Claude would when asked "open my library"
await callTool({ applet: "library" });
ok(await until(async () => /Seed Keepers/.test(await viewText()) && /Slow Tools/.test(await viewText()), "library"), "open-applet {applet: library} opens Library on the vault's books");
await page.screenshot({ path: `${shots}/b4-library.png` });

console.log("view calls through the host:", calls.length, JSON.stringify(calls.reduce((a, c) => ((a[c] = (a[c] ?? 0) + 1), a), {})));
// put Maya back for the next run
await rpc("tools/call", { name: "update-record", arguments: { id: "People/Maya Ortiz", fields: { favorite: null }, force: true } });
await browser.close();
