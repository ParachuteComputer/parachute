// The update feed (shell/updates.ts, docs/LAUNCH.md §3), read and judged. Pure, with no imports: the canary
// (scripts/canary.ts) reads the same feed with it.

export type Build = { at: number; commit: string };
/** `sha256`: each file's, by platform, for the files that have one (a feed written before them has none). */
export type Feed = Build & { files: Record<string, string>; sha256: Record<string, string> };
/** `sha256`: the file's, when the feed has it; the app checks the download against it (Android). */
export type Offer = Build & { url: string; sha256?: string };

/** The feed's words, or null when they aren't a feed. Files resolve against the feed, on its own origin only. */
export function parseFeed(body: string, feedUrl: string): Feed | null {
  let raw: unknown;
  try { raw = JSON.parse(body); } catch { return null; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { v, at, commit, files, sha256 } = raw as Record<string, unknown>;
  if (v !== 1 || typeof at !== "number" || !Number.isSafeInteger(at) || at <= 0) return null;
  if (typeof commit !== "string" || !/^[0-9a-f]{7,40}$/.test(commit)) return null;
  if (!files || typeof files !== "object" || Array.isArray(files)) return null;
  let base: URL;
  try { base = new URL(feedUrl); } catch { return null; }
  const out: Record<string, string> = {};
  for (const [platform, name] of Object.entries(files as Record<string, unknown>)) {
    if (typeof name !== "string" || !name) continue;
    try {
      const u = new URL(name, base);
      if (u.origin === base.origin && (u.protocol === "https:" || u.protocol === "http:")) out[platform] = u.toString();
    } catch { /* not an address */ }
  }
  const sums: Record<string, string> = {};
  if (sha256 && typeof sha256 === "object" && !Array.isArray(sha256))
    for (const [platform, sum] of Object.entries(sha256 as Record<string, unknown>))
      if (out[platform] && typeof sum === "string" && /^[0-9a-f]{64}$/i.test(sum)) sums[platform] = sum.toLowerCase();
  return { at, commit, files: out, sha256: sums };
}

/** What to offer this build on this platform: the feed's build when it is later than this one and has a file here. A
 *  build not made from git (at 0) is offered nothing: it can't tell newer from older. */
export function offerFor(feed: Feed | null, own: Build, platform: string): Offer | null {
  if (!feed || own.at <= 0 || feed.at <= own.at || feed.commit === own.commit) return null;
  const url = feed.files[platform];
  if (!url) return null;
  const sha256 = feed.sha256[platform];
  return sha256 ? { at: feed.at, commit: feed.commit, url, sha256 } : { at: feed.at, commit: feed.commit, url };
}
