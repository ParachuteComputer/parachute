// The Play bundle's version code (scripts/play-version-code.sh, docs/STORES.md): the commit count, so two builds of a
// commit agree, a newer commit is higher, and it stays far under Play's ceiling (a unix timestamp, the first try, doesn't).
// A shallow clone and a commit off origin/next are refused: their counts could run ahead of next's.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve(__dirname, "../scripts/play-version-code.sh");
const PLAY_MAX = 2_100_000_000;
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.test", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });
const run = (repo: string, env: Record<string, string> = {}) => execFileSync(join(repo, "scripts/play-version-code.sh"), { cwd: repo, encoding: "utf8", stdio: "pipe", env: { ...process.env, ...env } }).trim();
const commit = (repo: string, msg: string) => git(repo, "commit", "-q", "--allow-empty", "-m", msg);

const made: string[] = [];
const tmp = (name: string) => { const d = mkdtempSync(join(tmpdir(), `play-code-${name}-`)); made.push(d); return d; };
// an origin holding `commits` commits of next (the first has the script), and a clone of it: the script counts the
// commits of the repo it lives in, and looks for origin/next
function repoWith(commits: number) {
  const origin = tmp("origin"), parent = tmp("clone");
  git(origin, "init", "-q", "-b", "next");
  mkdirSync(join(origin, "scripts"));
  copyFileSync(SCRIPT, join(origin, "scripts/play-version-code.sh"));
  git(origin, "add", "scripts");
  commit(origin, "script");
  for (let i = 1; i < commits; i++) commit(origin, `c${i}`);
  git(parent, "clone", "-q", `file://${origin}`, "c");
  return { origin, clone: join(parent, "c"), parent };
}
const cleanup = () => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); };

describe("Play version code", () => {
  it("rises with each commit and is the same for the same commit", () => {
    try {
      const { origin, clone } = repoWith(3);
      expect(run(clone)).toBe("3");
      expect(run(clone)).toBe("3");
      commit(origin, "next");
      git(clone, "pull", "-q");
      expect(run(clone)).toBe("4");
    } finally { cleanup(); }
  });

  it("refuses a shallow clone, whose count would be too low", () => {
    try {
      const { origin, parent } = repoWith(3);
      git(parent, "clone", "-q", "--depth", "1", `file://${origin}`, "shallow");
      expect(() => run(join(parent, "shallow"))).toThrow(/shallow/);
    } finally { cleanup(); }
  });

  it("refuses a commit that isn't on origin/next, unless the bundle is never uploaded", () => {
    try {
      const { clone } = repoWith(3);
      git(clone, "switch", "-q", "-c", "feature");
      commit(clone, "only on the branch");
      expect(() => run(clone)).toThrow(/origin\/next/);
      expect(run(clone, { PARACHUTE_PLAY_UNCHECKED_BRANCH: "1" })).toBe("4");
      git(clone, "switch", "-q", "--detach", "HEAD~1"); // behind next's tip is still on next
      expect(run(clone)).toBe("3");
    } finally { cleanup(); }
  });

  // this repo's own history, when it has it whole (CI's checkout is shallow, and the count can't be read there)
  const here = resolve(__dirname, "..");
  const shallow = git(here, "rev-parse", "--is-shallow-repository").trim() === "true";
  it.skipIf(shallow)("leaves decades of headroom under Play's ceiling", () => {
    const n = Number(git(here, "rev-list", "--count", "HEAD").trim());
    expect(n).toBeGreaterThan(0);
    // a count reaches 10 million only at 1,000 commits a day for 27 years: even then, 99.5% of the ceiling is left.
    // (A unix timestamp is already 85% of it.)
    expect(n).toBeLessThan(PLAY_MAX / 200);
  });
});
