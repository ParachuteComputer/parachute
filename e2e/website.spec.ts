// An applet's code, unchanged, as a website people link their Parachute to (packages/applet-kit): the starter built by
// the kit's site, served, linked to a real hub through its own sign-in and approval (OAuth with PKCE, the named
// vault's scope), and then it reads and writes that vault. A reload keeps the link; Unlink lets it go.
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { api, hubState, VAULT } from "./hub";

// signed in on the hub's own page (its owner), as a person who opens the website is on their Parachute
test.use({ storageState: "e2e/.hub-session.json" });
const PORT = Number(process.env.E2E_PORT ?? 4173) + 300;

test("the starter as a website: link your Parachute, then it reads and writes that vault", async ({ page }) => {
  test.setTimeout(120_000);
  const env = { ...process.env, APPLET: "applets/starter", OUT: mkdtempSync(join(tmpdir(), "applet-site-")) };
  execFileSync("npx", ["vite", "build", "--config", "packages/applet-kit/site/vite.config.ts", "--logLevel", "error"], { env, stdio: "inherit" });
  const site = spawn("npx", ["vite", "preview", "--config", "packages/applet-kit/site/vite.config.ts", "--port", String(PORT), "--strictPort"], { env, stdio: "ignore" });
  let added: { id: string } | null = null;
  try {
    const at = `http://localhost:${PORT}/`;
    await expect.poll(() => fetch(at).then((r) => r.status, () => 0), { timeout: 20_000 }).toBe(200);
    await page.goto(at);
    await page.getByRole("textbox", { name: "Your Parachute's address" }).fill(hubState().origin);
    await page.getByRole("textbox", { name: "Vault" }).fill(VAULT);
    await page.getByRole("button", { name: "Link your Parachute" }).click();
    // the hub asks for the named vault's read and write, nothing wider
    await expect(page.getByRole("heading", { name: "Approve Starter?" })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: new RegExp(`vault:${VAULT}:write`) })).toBeChecked();
    expect(new URL(page.url()).searchParams.get("scope")).toBe(`vault:${VAULT}:read vault:${VAULT}:write`);
    await page.getByRole("button", { name: "Approve" }).click();
    // back on the website, linked, the starter on that vault
    await expect(page.getByText(`Linked to ${VAULT}`)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Starter", level: 1 })).toBeVisible();
    // in the app's own faces, as in the app (nothing fetched: they are in the page)
    expect(await page.evaluate(async () => { await document.fonts.ready; return ["Literata", "Fraunces", "Instrument Sans"].map((f) => document.fonts.check(`16px "${f}"`) && [...document.fonts].some((x) => x.family.replace(/"/g, "") === f && x.status === "loaded")); })).toEqual([true, true, true]);
    await page.getByRole("textbox", { name: "New note" }).fill("Written from the website");
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.locator("header").getByRole("heading", { name: "Written from the website" })).toBeVisible();
    const got = await api(hubState(), "GET", `notes?id=${encodeURIComponent("Notes/Written from the website")}`);
    added = Array.isArray(got) ? got[0] : got;
    expect(added).toBeTruthy();
    // a reload keeps the link (and the note open: useSaved, in this browser)
    await page.reload();
    await expect(page.getByText(`Linked to ${VAULT}`)).toBeVisible();
    await expect(page.locator("header").getByRole("heading", { name: "Written from the website" })).toBeVisible();
    // the applet has the whole screen under the line: its page line is on it
    const line = await page.getByRole("navigation", { name: "Pages" }).boundingBox();
    expect(line && line.y + line.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    // Unlink: this browser holds nothing of the vault, no token and nothing the applet saved
    await page.getByRole("button", { name: "Unlink" }).click();
    await expect(page.getByRole("button", { name: "Link your Parachute" })).toBeVisible();
    expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => /^parachute_token|^parachute\.applet\.|^parachute\.link\./.test(k)))).toEqual([]);
  } finally {
    site.kill();
    rmSync(env.OUT, { recursive: true, force: true });
    if (added) await api(hubState(), "DELETE", `notes/${added.id}`).catch(() => {});
  }
});
