// Library's "Add a book" (T-476, docs/design/UPLOADS.md): the person picks a file in the shell's own picker, the app
// carries it onto a job record in parts (the applet never holds the bytes), and an AI (here the book importer, run
// from the job) turns it into a book. Against the real hub of e2e/hub.ts; made-up books only.
//   1. a small epub: picked, uploaded in one piece, a `job` waiting; the importer takes it, the book is on the shelf
//   2. a generated 210 MB file: uploaded in 8 MiB parts, through a reload (picked again, it goes on from the parts
//      already there) and a dropped network; the parts, joined, hash the same as the file
// Set LIBRARY_SHOTS=<dir> for the walkthrough's phone screenshots.
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { appletRecord } from "../applets/record.ts";
import { api, hubState, VAULT } from "./hub";

test.use({ storageState: "e2e/.signed-in.json" });

const SHOTS = process.env.LIBRARY_SHOTS || "";
const PART = 8 * 1024 * 1024;
const TOOLS = join(import.meta.dirname, "..", "tools", "library-import");
const frame = (page: Page) => page.frameLocator("iframe.applet-frame:visible");

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

type Rec = { id: string; path: string; updatedAt: string; types?: string[]; metadata?: Record<string, unknown> };
type Upload = { name: string; type: string; size: number; parts: { path: string; size: number; sha256: string }[] };

/** The jobs Library left in the vault. */
async function jobs(): Promise<Rec[]> {
  const rows = (await api(hubState(), "GET", "notes?path_prefix=Jobs%2FLibrary%2F&include_metadata=true&limit=50")) as Rec[];
  return rows.filter((r) => r.path.startsWith("Jobs/Library/"));
}

/** Open Library (seeded as the person's applet) and allow it. */
async function openLibrary(page: Page, made: string[]) {
  const r = appletRecord("library");
  const applet = await api(hubState(), "POST", "notes", { path: r.path, content: r.body, tags: r.tags, metadata: r.fields, extension: r.extension });
  made.push(applet.id);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/v/${VAULT}/a/${applet.id}`);
  const card = page.getByRole("region", { name: /asking for access/ });
  await expect(card).toContainText("Jobs/Library/");
  await expect(card).toContainText(/pick a file/i);
  await page.getByRole("button", { name: "Allow" }).click();
  await expect(frame(page).getByRole("heading", { name: "Library" })).toBeVisible({ timeout: 30_000 });
}

/** The app opened again (a reload): a person's applet waits for a tap to run again. */
async function reopen(page: Page) {
  await page.reload();
  await page.getByRole("button", { name: "Open Library" }).click();
  await expect(frame(page).getByRole("heading", { name: "Library" })).toBeVisible({ timeout: 30_000 });
}

/** The shell's own picker, opened by the applet: choose `file` in it. */
async function choose(page: Page, file: string) {
  await expect(page.getByRole("dialog", { name: /Library asks for a file/ })).toBeVisible();
  await page.locator("input[data-shell-pick]").setInputFiles(file);
}

async function cleanup(made: string[]) {
  const h = hubState();
  for (const j of await jobs().catch(() => [])) made.push(j.id);
  const books = ((await api(h, "GET", "notes?path_prefix=Books%2FA%20Small%20Garden&limit=200").catch(() => [])) as Rec[]);
  const receipts = ((await api(h, "GET", "notes?path_prefix=Parachute%2FReceipts%2Fbook-a-small-garden&limit=5").catch(() => [])) as Rec[]);
  for (const r of [...books, ...receipts]) made.push(r.id);
  for (const id of [...new Set(made)].reverse()) await api(h, "DELETE", `notes/${id}`).catch(() => {});
}

test("Add a book: an epub picked in Library becomes a job, and the importer makes it a book on the shelf", async ({ page }) => {
  test.setTimeout(180_000);
  const h = hubState();
  const made: string[] = [];
  const dir = mkdtempSync(join(tmpdir(), "library-add-"));
  try {
    const epub = join(dir, "A Small Garden.epub");
    execFileSync("python3", ["-I", join(TOOLS, "make_test_epub.py"), epub]);
    const sha = createHash("sha256").update(readFileSync(epub)).digest("hex");

    await openLibrary(page, made);
    const f = frame(page);
    await shot(page, "uploads-01-empty-shelf");
    await f.getByRole("button", { name: "Add a book" }).click();
    await expect(page.getByRole("dialog", { name: /Library asks for a file/ })).toBeVisible();
    await shot(page, "uploads-02-picker");
    await choose(page, epub);

    // the job: waiting for an AI, the file on it in one piece, its hash the file's
    const adding = f.getByRole("region", { name: "Being added" });
    await expect(adding).toContainText("A Small Garden.epub");
    await expect(adding).toContainText(/Waiting for an AI/, { timeout: 30_000 });
    await shot(page, "uploads-04-waiting");
    const [job] = await jobs();
    expect([...(job.types ?? []), ...((job as { tags?: string[] }).tags ?? [])]).toContain("job");
    expect(job.metadata).toMatchObject({ kind: "import-book", status: "waiting" });
    const up = job.metadata!.upload as Upload;
    expect(up).toMatchObject({ name: "A Small Garden.epub", type: "application/epub+zip" });
    expect(up.parts).toHaveLength(1);
    expect(up.parts[0].sha256).toBe(sha);
    const attached = (await api(h, "GET", `notes/${job.id}/attachments`)) as { path: string }[];
    expect(attached.map((a) => a.path)).toEqual([up.parts[0].path]);

    // an AI takes it: the importer, run on the vault's waiting jobs (core 0.9's record door)
    const rest = await fetch(`${h.origin}/vault/${VAULT}/api/records?limit=1`, { headers: { authorization: `Bearer ${h.token}` } });
    test.skip(rest.status === 404 && process.env.E2E_CORE_NEXT !== "1", "the importer writes through core 0.9's record door");
    const key = join(dir, "key");
    writeFileSync(key, h.token, { mode: 0o600 });
    // as Uni runs it when told a book was added: every waiting job in the vault
    execFileSync("python3", ["-I", join(TOOLS, "import_book.py"), "--jobs", "--vault", VAULT, "--hub", h.origin, "--token-file", key, "--by", "the e2e"], { stdio: "pipe" });
    const done = (await api(h, "GET", `notes/${job.id}?include_metadata=true`)) as Rec;
    expect(done.metadata, `the job says: ${String(done.metadata?.note)}`).toMatchObject({ status: "done", by: "the e2e", result: "Books/A Small Garden" });

    // the book is on the shelf; the job is gone from Being added
    await reopen(page);
    await expect(f.getByRole("button", { name: /A Small Garden/ }).first()).toBeVisible({ timeout: 20_000 });
    await expect(f.getByRole("region", { name: "Being added" })).toHaveCount(0);
    await shot(page, "uploads-05-on-the-shelf");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await cleanup(made);
  }
});

test("Add a book: a 210 MB file goes up in parts through a reload and a dropped network, and comes back whole", async ({ page, context }) => {
  test.setTimeout(420_000);
  const h = hubState();
  const made: string[] = [];
  const dir = mkdtempSync(join(tmpdir(), "library-add-big-"));
  try {
    // made-up bytes: 210 MB, so 26 parts of 8 MiB (the last one short)
    const big = join(dir, "Big Atlas.pdf");
    const whole = createHash("sha256");
    const fd = openSync(big, "w");
    for (let left = 210_000_000; left > 0; left -= PART) { const b = randomBytes(Math.min(PART, left)); whole.update(b); writeSync(fd, b); }
    closeSync(fd);
    const sha = whole.digest("hex");
    const count = Math.ceil(210_000_000 / PART);

    // a phone's upload speed (about 16 MB/s), so the reload and the drop land midway on any machine
    const slow = async () => (await context.newCDPSession(page)).send("Network.emulateNetworkConditions", { offline: false, latency: 20, downloadThroughput: -1, uploadThroughput: 16 * 1024 * 1024 });
    await openLibrary(page, made);
    await slow();
    const f = frame(page);
    await f.getByRole("button", { name: "Add a book" }).click();
    await choose(page, big);
    const adding = f.getByRole("region", { name: "Being added" });
    await expect(adding).toContainText("Big Atlas.pdf");
    await expect(adding.getByRole("progressbar")).toBeVisible();
    await shot(page, "uploads-03-uploading");

    // three parts in, the app goes away (a reload): the job keeps what landed
    await expect.poll(async () => ((await jobs())[0]?.metadata?.upload as Upload | undefined)?.parts.length ?? 0, { timeout: 120_000 }).toBeGreaterThanOrEqual(3);
    await reopen(page);
    const landed = ((await jobs())[0].metadata!.upload as Upload).parts.map((p) => p.path);
    const before = landed.length;
    expect(before).toBeLessThan(count);
    await expect(f.getByRole("region", { name: "Being added" })).toContainText(/Not finished/);

    // picked again, it goes on from there: only the parts it lacks go up
    await slow();
    let sent = 0;
    page.on("request", (r) => { if (r.method() === "POST" && r.url().includes("/api/storage/upload")) sent++; });
    await f.getByRole("button", { name: "Pick it again" }).click();
    await choose(page, big);
    // and the network drops for a moment midway: it waits and goes on
    await expect.poll(async () => ((await jobs())[0].metadata!.upload as Upload).parts.length, { timeout: 120_000 }).toBeGreaterThanOrEqual(before + 2);
    await context.setOffline(true);
    const midway = ((await jobs())[0].metadata!.upload as Upload).parts.length;
    expect(midway).toBeLessThan(count);
    await page.waitForTimeout(4000);
    expect(((await jobs())[0].metadata!.upload as Upload).parts.length).toBeLessThanOrEqual(midway + 1);  // nothing goes while it is offline
    await context.setOffline(false);
    await expect(f.getByRole("region", { name: "Being added" })).toContainText(/Waiting for an AI/, { timeout: 240_000 });

    const job = (await jobs())[0];
    expect(job.metadata).toMatchObject({ kind: "import-book", status: "waiting" });
    const up = job.metadata!.upload as Upload;
    expect(up).toMatchObject({ name: "Big Atlas.pdf", type: "application/pdf", size: 210_000_000 });
    expect(up.parts).toHaveLength(count);
    // the pieces there before the reload are the same stored files, not sent again; only a piece the drop cut off goes twice
    expect(up.parts.slice(0, before).map((p) => p.path)).toEqual(landed);
    expect(sent).toBeLessThanOrEqual(count - before + 1);
    expect(up.parts.reduce((n, p) => n + p.size, 0)).toBe(210_000_000);

    // the parts, read back and joined in order, are the file
    const joined = createHash("sha256");
    for (const p of up.parts) {
      const r = await fetch(`${h.origin}/vault/${VAULT}/api/storage/${p.path}`, { headers: { authorization: `Bearer ${h.token}` } });
      expect(r.status).toBe(200);
      const b = Buffer.from(await r.arrayBuffer());
      expect(createHash("sha256").update(b).digest("hex")).toBe(p.sha256);
      joined.update(b);
    }
    expect(joined.digest("hex")).toBe(sha);

    // a job the importer can't do (a PDF) is left waiting, for an AI that can
    const key = join(dir, "key");
    writeFileSync(key, h.token, { mode: 0o600 });
    let said = "";
    try { execFileSync("python3", ["-I", join(TOOLS, "import_book.py"), "--job", job.id, "--vault", VAULT, "--hub", h.origin, "--token-file", key], { stdio: "pipe" }); } catch (e) { said = String((e as { stderr?: Buffer }).stderr ?? e); }
    expect(said).toMatch(/takes only an epub/);
    expect(((await api(h, "GET", `notes/${job.id}?include_metadata=true`)) as Rec).metadata).toMatchObject({ status: "waiting" });
  } finally {
    await context.setOffline(false);
    rmSync(dir, { recursive: true, force: true });
    await cleanup(made);
  }
});
