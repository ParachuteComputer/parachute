// Vault as a notes app, on the phone (T-476; Aaron, 11-27: "Good simple defaults like an apple notes"): a person with
// their key signs in to their own Parachute, opens Vault, and it is their notes: newest first, each with its first
// words. One tap on New note and they are typing; the words are kept without a Save and name the note. A tap on a note
// reads it, a tap in its words writes in them. Types and tables are one step away. Every screen on the way is a
// screenshot from the phone itself; the walk fails where the person would be stopped.
//   scripts/android-drive.sh <debug.apk> notes <folder>
import type { FrameLocator, Page } from "@playwright/test";
import { api, hubState, VAULT } from "../hub";
import { phone, wait } from "./phone";

const ph = await phone(process.argv[2]);
const { hub, nsec } = ph.world;
const fail = async (why: string): Promise<never> => { await ph.shot("stopped"); console.error(`FAILED: ${why}`); process.exit(1); };
const visible = (l: ReturnType<Page["locator"]>) => l.first().isVisible().catch(() => false);
/** Wait until `test` holds (a second at a time), else fail with `why`. */
async function until(why: string, test: () => Promise<boolean>, s = 60) {
  for (let i = 0; i < s; i++) { if (await test().catch(() => false)) return; await wait(1000); }
  await fail(why);
}
const p = () => ph.page();
const applet = (): FrameLocator => p().frameLocator("iframe.applet-frame:visible");
const onHub = () => p().url().startsWith(hub);

console.log("app at", p().url());
for (const c of ph.browser.contexts()) { c.setDefaultTimeout(30_000); for (const pg of c.pages()) pg.setDefaultTimeout(30_000); }
setTimeout(() => { console.error("FAILED: the walk took over 12 minutes"); process.exit(1); }, 12 * 60_000).unref();

// made-up notes in the person's home vault, oldest first (so the trellis is the newest)
const h = hubState();
for (const [path, content] of [
  ["Garden/Seed swap", "# Seed swap\n\nMira brings the beans. I bring the squash."],
  ["Garden/Compost log", "Turned the pile on Sunday. It steams."],
  ["Garden/Tomato trellis ideas", "# Tomato trellis ideas\n\nCattle panel arch over the path, or strings from a ridge pole."],
]) await api(h, "POST", "notes", { path, content });

// 1. the key, pasted (a phone has a screen lock: the key signs behind it)
console.log(await ph.adb("shell locksettings set-pin 1357"));
await until("the first screen didn't come", () => visible(p().getByRole("button", { name: "Make a new key" })), 180);
await p().getByText("Advanced: paste a secret key").click();
await p().getByPlaceholder("nsec1…").fill(nsec);
await p().getByRole("button", { name: "Keep this key" }).click();
await until("the key wasn't kept", () => visible(p().getByRole("button", { name: "Sign in with your key" })), 60);

// 2. signed in to their own Parachute with it
await p().getByLabel("Your Parachute's address").fill(hub);
await p().getByRole("radio", { name: "Mine" }).check();
await p().getByRole("button", { name: "Sign in with your key" }).click();
for (let i = 0; i < 90; i++) {
  await wait(1000);
  if (onHub()) { const ok = p().getByRole("button", { name: "Approve" }); if (await visible(ok)) await ok.click(); continue; }
  const cont = p().getByRole("button", { name: "Continue" });
  if (await visible(cont)) { await cont.click(); continue; }
  if (await visible(p().locator("nav[aria-label=Bar]")) && !p().url().includes("/oauth/")) break;
}
await until("not signed in", () => visible(p().locator("nav[aria-label=Bar]")), 60);
console.log("signed in; at", p().url());

// 3. Vault: the vault's notes, newest first
await p().frameLocator("iframe.app-frame").getByRole("list", { name: "Applets" }).getByRole("link", { name: /Vault/ }).click();
const pick = applet().getByRole("region", { name: "Vaults" }).getByRole("button", { name: new RegExp(`^${VAULT}\\b`) });
await until("Vault didn't open", async () => (await visible(applet().getByRole("heading", { level: 1 }) as never)), 60);
if (await visible(pick as never)) await pick.click();
const notes = applet().getByRole("region", { name: "Notes" });
await until("the vault's notes didn't show", () => visible(notes.getByRole("button", { name: /Tomato trellis ideas/ }) as never), 60);
const first = await notes.getByRole("button").first().innerText();
if (!/Tomato trellis ideas/.test(first) || !/Cattle panel arch/.test(first)) await fail(`the newest note and its first words aren't first: ${JSON.stringify(first)}`);
await wait(800);
await ph.shot("notes");

// 4. New note: one tap, the keyboard is up, typing is kept without a Save
await applet().getByRole("button", { name: "New note" }).click();
const box = applet().getByRole("textbox", { name: "The note's words" });
await until("the new note's box didn't take the caret", async () => await box.evaluate((el) => el === document.activeElement), 15);
await box.pressSequentially("Bee course notes\n\nSmoke first, then lift the lid.", { delay: 20 });
await until("the words weren't kept", () => visible(applet().getByText("Saved", { exact: true }) as never), 20);
await ph.shot("new-note-kept");
const made = (await api(h, "GET", "notes?path_prefix=Notes%2F&include_content=true")) as { content?: string }[];
if (made.length !== 1 || made[0].content !== "Bee course notes\n\nSmoke first, then lift the lid.") await fail(`the vault holds ${JSON.stringify(made.map((n) => n.content))}`);
await applet().getByRole("button", { name: "Done" }).click();
await until("the note isn't read as written", () => visible(applet().getByRole("article", { name: "Bee course notes" }) as never), 20);
await wait(600);
await ph.shot("note-read");

// 5. back: it leads the list, named by its first line
await applet().getByRole("button", { name: `← ${VAULT}` }).click();
await until("the new note doesn't lead the list", async () => /Bee course notes/.test(await notes.getByRole("button").first().innerText()), 20);
await ph.shot("notes-after");

// 6. a note opens to its words; a tap in them writes
await notes.getByRole("button", { name: /Compost log/ }).click();
const note = applet().getByRole("article", { name: "Compost log" });
await until("the note didn't open", () => visible(note as never), 20);
await note.getByText("Turned the pile on Sunday").click();
const words = note.getByRole("textbox", { name: "The note's words" });
await until("a tap in the words didn't start writing", async () => await words.evaluate((el) => el === document.activeElement), 15);
await words.press("Control+End");
await words.pressSequentially(" Added leaves.", { delay: 20 });
await until("the change wasn't kept", async () => ((await api(h, "GET", "notes?path_prefix=Garden%2FCompost&include_content=true")) as { content?: string }[])[0]?.content === "Turned the pile on Sunday. It steams. Added leaves.", 20);
await ph.shot("writing-in-a-note");
await note.getByRole("button", { name: "Done" }).click();
await applet().getByRole("button", { name: `← ${VAULT}` }).click();

// 7. one step away: the types and tables
await applet().getByRole("button", { name: "Types and tables" }).click();
await until("Types and tables didn't open", () => visible(applet().getByRole("heading", { level: 1, name: "Types and tables" }) as never), 20);
await wait(600);
await ph.shot("types-and-tables");
console.log("WALK OK");
process.exit(0);
