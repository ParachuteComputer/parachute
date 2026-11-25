// The phone a walk drives (scripts/android-drive.sh): the app's WebView through its devtools, screenshots from the
// phone itself (the WebView's own can't see the system's screens: Android's file picker), and adb on the phone's side.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";

const work = process.env.DRIVE_WORK ?? "";
const out = process.env.DRIVE_OUT ?? "android-drive";
export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type Phone = { browser: Browser; page: () => Page; shot: (name: string) => Promise<string>; adb: (args: string) => Promise<string>; world: { hub: string; nsec: string } };

export async function phone(worldFile: string): Promise<Phone> {
  if (!work) throw new Error("run through scripts/android-drive.sh");
  mkdirSync(out, { recursive: true });
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.CDP}`);
  const page = () => { const ps = browser.contexts().flatMap((c) => c.pages()); return ps.find((p) => !p.url().startsWith("about:")) ?? ps[0]; };
  let n = 0;
  return {
    browser, page,
    world: JSON.parse(readFileSync(worldFile, "utf8")) as { hub: string; nsec: string },
    async shot(name) {
      rmSync(join(work, "shot.png"), { force: true });
      writeFileSync(join(work, "shot"), "");
      for (let i = 0; i < 80 && !existsSync(join(work, "shot.png")); i++) await wait(250);
      const file = join(out, `${String(++n).padStart(2, "0")}-${name}.png`);
      writeFileSync(file, readFileSync(join(work, "shot.png")));
      console.log("shot", file);
      return file;
    },
    async adb(args) {
      rmSync(join(work, "cmd.out"), { force: true });
      writeFileSync(join(work, "cmd"), `$ADB ${args}\n`);
      for (let i = 0; i < 240 && !existsSync(join(work, "cmd.out")); i++) await wait(250);
      return existsSync(join(work, "cmd.out")) ? readFileSync(join(work, "cmd.out"), "utf8") : "";
    },
  };
}
