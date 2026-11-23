// Languages (applets/languages.tsx) against a real hub, on a phone 390 wide: the starter words go in and get their
// cards; Today says what is due (twenty new a language, one card of a word a day); a review writes the schedule to the
// card and a line to its body; a word's verse is a link (the Languages pack's `from`), and so is a card's word; a
// picture picked on the shell's picker and a sound from the app's recorder are attached to a word and come back
// through vault.file (the sound by the audio gate); a word typed in IAST is saved in Devanagari, with its cards.
// WALKTHROUGH_DIR=<dir> keeps a screenshot of each step (WALKTHROUGH.md).
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { appletRecord } from "../applets/record.ts";
import { api, hubState, mintToken, record, VAULT } from "./hub";

test.use({ storageState: "e2e/.signed-in.json", viewport: { width: 390, height: 844 }, launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } });
test.setTimeout(480_000);
const shot = (page: Page, name: string) => (process.env.WALKTHROUGH_DIR ? page.screenshot({ path: `${process.env.WALKTHROUGH_DIR}/${name}.png` }) : Promise.resolve());
const starter = JSON.parse(readFileSync(new URL("./fixtures/languages/starter.json", import.meta.url), "utf8")) as { verses: { path: string; types: string[]; fields: Record<string, unknown>; body: string }[]; words: unknown[] };
const pack = JSON.parse(readFileSync(new URL("../src/kit/packs/languages.json", import.meta.url), "utf8")) as { types: Record<string, { fields: Record<string, unknown> }> };
type Note = { id: string; path: string; content?: string; metadata?: Record<string, unknown>; links?: { relationship: string; sourceNote: { path: string }; targetNote: { path: string } }[] };
const list = async (prefix: string): Promise<Note[]> => {
  const out: Note[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await api(hubState(), "GET", `notes?path_prefix=${encodeURIComponent(prefix)}&include_metadata=true&include_content=true&limit=100&offset=${offset}`) as Note[];
    out.push(...page);
    if (page.length < 100) return out;
  }
};
const get = (path: string) => api(hubState(), "GET", `notes?id=${encodeURIComponent(path)}&include_links=true`) as Promise<Note>;
const day = (d = 0) => { const t = new Date(Date.now() + d * 86_400_000); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; };

test("Languages: starter words, today's cards, a review written to the card, a picture and a sound, a word added in IAST", async ({ page }) => {
  const h = hubState();
  const made: string[] = [];
  // the Languages pack's types, as Add a pack makes them (admin: this core's write can't define a type yet)
  for (const [name, def] of Object.entries(pack.types)) await api({ ...h, token: mintToken(`vault:${VAULT}:admin`) }, "PUT", `types/${name}`, { kind: "type", fields: def.fields });
  // Library's verses, as its import would write them
  for (const v of starter.verses) made.push((await api(h, "POST", "notes", { path: v.path, content: v.body, types: v.types, metadata: v.fields })).id);
  const applet = await record(h, "create", appletRecord("languages"));
  made.push(applet.id);
  try {
    await page.goto(`/v/${VAULT}/a/${applet.id}`);
    const asks = page.getByRole("region", { name: /asking for access/ });
    await expect(asks).toContainText("Words/");
    await expect(asks).toContainText("Texts/");
    await page.getByRole("button", { name: "Allow" }).click();
    const f = page.frameLocator("iframe.applet-frame");
    await expect(f.getByRole("heading", { name: "Languages" })).toBeVisible();
    await expect(f.getByText(/No words yet/)).toBeVisible();

    // the starter words, and the cards Languages makes for them
    await f.getByRole("button", { name: "Add the starter words" }).click();
    await expect(f.getByRole("heading", { name: "40 cards to review today" })).toBeVisible({ timeout: 180_000 });
    const words = await list("Words/"), cards = await list("Cards/");
    expect(words.map((w) => w.path).sort()).toEqual((starter.words as { path: string }[]).map((w) => w.path).sort());
    expect(cards).toHaveLength(words.length * 3);
    // the verse is a link from the word, and the word from each card (the pack's reference fields)
    const citta = await get("Words/Sanskrit/चित्त");
    expect(citta.metadata).toMatchObject({ language: "sanskrit", translit: "citta", from: "Texts/Yoga Sutras/YS 1.2" });
    expect(citta.metadata).not.toHaveProperty("memory");
    expect(citta.links?.filter((l) => l.relationship === "from").map((l) => l.targetNote.path)).toEqual(["Texts/Yoga Sutras/YS 1.2"]);
    expect(citta.links?.filter((l) => l.relationship === "word").map((l) => l.sourceNote.path).sort()).toEqual(["Cards/Sanskrit/चित्त picture-to-word", "Cards/Sanskrit/चित्त script", "Cards/Sanskrit/चित्त word-to-meaning"]);
    await expect(f.getByRole("region", { name: "By language" })).toContainText("Sanskrit");
    await shot(page, "01-today");

    // a review: the first word of YS 1.1, picture → word, the meaning off its front
    await f.getByRole("button", { name: "Review", exact: true }).click();
    await expect(f.getByText("40 left · Picture → word")).toBeVisible();
    await expect(f.getByText("A notebook opened beside a lamp at dawn")).toBeVisible();
    await expect(f.getByText("now, here begins")).toHaveCount(0);
    await shot(page, "02-review-front");
    await f.getByRole("button", { name: "Show answer" }).click();
    await expect(f.locator("p.lang-deva[lang='sa-Deva']")).toHaveText("अथ");
    await expect(f.getByText("atha", { exact: true })).toBeVisible();
    await expect(f.getByText("now, here begins")).toBeVisible();
    // where he met it: the verse, a link that opens it
    await expect(f.getByRole("link", { name: "YS 1.1" })).toBeVisible({ timeout: 15_000 });
    await shot(page, "03-review-answer");
    await f.getByRole("button", { name: /^Good, next in 1d/ }).click();
    await expect(f.getByText("39 left")).toBeVisible();
    const atha = await get("Cards/Sanskrit/अथ picture-to-word");
    expect(atha.metadata).toMatchObject({ state: "review", interval: 1, ease: 2.5, reps: 1, lapses: 0, due: day(1) });
    expect(atha.content?.trim().split("\n")).toHaveLength(1);
    expect(atha.content).toMatch(new RegExp(`^- ${day()} \\d{2}-\\d{2} · Good · new → 1d · ease 2\\.50 · due ${day(1)}`));
    // Again: back a few cards on, learning
    await f.getByRole("button", { name: "Show answer" }).click();
    await f.getByRole("button", { name: /^Again, next in now/ }).click();
    await expect.poll(async () => (await get("Cards/Sanskrit/योग picture-to-word")).metadata?.state, { timeout: 15_000 }).toBe("learning");
    await expect(f.getByText("39 left")).toBeVisible();
    await f.getByRole("button", { name: "← Today" }).click();
    await expect(f.getByRole("heading", { name: "39 cards to review today" })).toBeVisible();

    // a word: its picture from the shell's picker, its sound from the app's recorder, both back through vault.file
    await f.getByRole("button", { name: /^Words · / }).click();
    await f.getByRole("searchbox", { name: "Search words" }).fill("citta");
    await f.getByRole("button", { name: /चित्त/ }).click();
    await expect(f.getByText("Picture idea: A mountain lake reflecting the pines")).toBeVisible();
    await f.getByRole("button", { name: "Add a picture" }).click();
    await page.getByRole("dialog", { name: /Languages asks for/ }).locator("input[type=file]").setInputFiles({ name: "lake.png", mimeType: "image/png", buffer: readFileSync(new URL("./fixtures/languages/lake.png", import.meta.url)) });
    const pic = f.locator("img.lang-pic");
    await expect.poll(() => pic.evaluate((i) => (i as HTMLImageElement).naturalWidth), { timeout: 30_000 }).toBe(480);
    await f.getByRole("button", { name: "Record how it sounds" }).click();
    const sheet = page.getByRole("dialog", { name: "Recording for Languages" });
    await expect(sheet.getByRole("timer")).toContainText("0:01", { timeout: 8000 });
    await sheet.getByRole("button", { name: "Send" }).click();
    await expect(sheet).toBeHidden();
    await expect.poll(async () => (await get("Words/Sanskrit/चित्त")).metadata?.sound, { timeout: 20_000 }).toMatch(/^\/api\/storage\/.+\.webm$/);
    const word = await get("Words/Sanskrit/चित्त");
    expect(word.metadata?.picture).toMatch(/^\/api\/storage\//);
    expect(word.content).toMatch(/^!\[A mountain lake reflecting the pines\]\(\/api\/storage\/[^)]+\)\n/);
    // the sound card, made once it had a sound
    await expect.poll(async () => (await list("Cards/Sanskrit/चित्त")).map((c) => c.path).sort(), { timeout: 20_000 }).toContain("Cards/Sanskrit/चित्त sound");
    // played from its own bytes, read back through vault.file (a reload: nothing kept from the upload)
    await page.reload();
    await page.getByRole("button", { name: "Open Languages" }).click().catch(() => {});
    await expect(f.getByRole("heading", { name: "चित्त" })).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => f.locator("img.lang-pic").evaluate((i) => (i as HTMLImageElement).naturalWidth), { timeout: 30_000 }).toBe(480);
    const audio = f.locator("audio.lang-audio");
    await expect(audio).toHaveAttribute("src", /^blob:/, { timeout: 30_000 });
    await expect.poll(() => audio.evaluate((a) => (a as HTMLAudioElement).readyState), { timeout: 15_000 }).toBeGreaterThan(0);
    await shot(page, "04-word");
    // its picture → word card: the picture on the front; the sound with the answer
    await f.getByRole("button", { name: "Review", exact: true }).click();
    await expect(f.getByText(/Picture → word/)).toBeVisible();
    await expect.poll(() => f.locator("img.lang-pic").evaluate((i) => (i as HTMLImageElement).naturalWidth), { timeout: 30_000 }).toBe(480);
    await shot(page, "05-review-picture");
    await f.getByRole("button", { name: "Show answer" }).click();
    await expect(f.locator("audio.lang-audio")).toHaveAttribute("src", /^blob:/, { timeout: 30_000 });
    await f.getByRole("button", { name: /^Good, next in 1d/ }).click();
    await expect(f.getByRole("heading", { name: "Done for now" })).toBeVisible();
    await f.getByRole("button", { name: "Back to Today" }).click();

    // a word typed in IAST: saved in Devanagari, with its cards
    await f.getByRole("button", { name: "Add a word" }).first().click();
    const drawer = f.getByRole("dialog", { name: "Add a word" });
    await drawer.getByRole("textbox", { name: "The word, in IAST or Devanagari" }).fill("śānti");
    await expect(drawer.locator("p.lang-deva")).toHaveText("शान्ति");
    await drawer.getByRole("textbox", { name: "Meaning" }).fill("peace, calm");
    await drawer.getByRole("textbox", { name: "My memory" }).fill("The quiet after the last chant");
    await shot(page, "06-add-word");
    await drawer.getByRole("button", { name: "Save the word" }).click();
    await expect(f.getByRole("heading", { name: "शान्ति" })).toBeVisible({ timeout: 90_000 });
    await expect.poll(async () => (await list("Cards/Sanskrit/शान्ति")).length, { timeout: 30_000 }).toBe(3);
    expect((await get("Words/Sanskrit/शान्ति")).metadata).toMatchObject({ language: "sanskrit", translit: "śānti", gloss: "peace, calm", memory: "The quiet after the last chant" });
    await expect(f.getByText("The quiet after the last chant").first()).toBeVisible();
    await shot(page, "07-new-word");
  } finally {
    for (const r of [...await list("Words/"), ...await list("Cards/")]) made.push(r.id);
    for (const id of made) await api(h, "DELETE", `notes/${id}`).catch(() => {});
  }
});
