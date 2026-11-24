// The Play bundle's version code (scripts/play-version-code.sh, docs/STORES.md): the commit count, so two builds of a
// commit agree, a newer commit is higher, and it stays far under Play's ceiling (a unix timestamp, the first try, doesn't).
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve(__dirname, "../scripts/play-version-code.sh");
const PLAY_MAX = 2_100_000_000;
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.test", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });
const code = (repo: string) => Number(execFileSync(join(repo, "scripts/play-version-code.sh"), { cwd: repo, encoding: "utf8" }).trim());

// a repo of its own holding a copy of the script (it counts the commits of the repo it lives in)
function repoWith(commits: number) {
  const dir = mkdtempSync(join(tmpdir(), "play-code-"));
  git(dir, "init", "-q", "-b", "next");
  mkdirSync(join(dir, "scripts"));
  copyFileSync(SCRIPT, join(dir, "scripts/play-version-code.sh"));
  git(dir, "add", "scripts")
  git(dir, "commit", "-q", "-m", "script")
  for (let i = 1; i < commits; i++) git(dir, "commit", "-q", "--allow-empty", "-m", `c${i}`);
  return dir;
}

describe("Play version code", () => {
  it("rises with each commit and is the same for the same commit", () => {
    const dir = repoWith(3);
    try {
      expect(code(dir)).toBe(3);
      expect(code(dir)).toBe(3);
      git(dir, "commit", "-q", "--allow-empty", "-m", "next");
      expect(code(dir)).toBe(4);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("refuses a shallow clone, whose count would be too low", () => {
    const dir = repoWith(3), clone = mkdtempSync(join(tmpdir(), "play-code-clone-"));
    try {
      git(clone, "clone", "-q", "--depth", "1", `file://${dir}`, "c");
      expect(() => execFileSync(join(clone, "c/scripts/play-version-code.sh"), { cwd: clone, stdio: "pipe" })).toThrow(/shallow/);
    } finally { rmSync(dir, { recursive: true, force: true }); rmSync(clone, { recursive: true, force: true }); }
  });

  it("leaves decades of headroom under Play's ceiling", () => {
    // this repo's own history (CI checks it out whole; a shallow checkout is refused above, so skip there)
    const here = resolve(__dirname, "..");
    if (git(here, "rev-parse", "--is-shallow-repository").trim() === "true") return;
    const n = code(here);
    expect(n).toBeGreaterThan(0);
    // a count reaches 10 million only at 1,000 commits a day for 27 years: even then, 99.5% of the ceiling is left.
    // (A unix timestamp is already 85% of it.)
    expect(n).toBeLessThan(PLAY_MAX / 200);
  });
});
