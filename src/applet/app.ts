// What an applet may ask of the app beyond its own vault: `metadata.app` on its note, beside the manifest (the manifest
// itself is the Uni app's contract 2 and takes no new key). A home applet uses these: the newest notes across the
// vaults this device holds (titles only), what is on the bar, and a move to a note or an applet on a tap. Each word is
// a line on the card and part of the grant's key, so adding one asks again. The shell's own capabilities for the Uni
// app's rooms (docs/design/KEYRING.md "Voice, files, links, storage"): links, save, attach (a file the person picks)
// and storage (a little, on this device). Pure.
//
//   app: [recent, pins, open, links, save, attach, storage, vaults, sharing]
// `vaults` and `sharing` are the Vault applet's (applets/vault.tsx; modules/vaults.ts): every vault this device holds.
export const APP_WORDS = ["recent", "pins", "open", "links", "save", "attach", "storage", "vaults", "sharing"] as const;
export type AppWord = (typeof APP_WORDS)[number];

/** `metadata.app`: absent is none; anything but a short list of known words, each once, is refused (the applet then
 *  asks nothing of the app, as with a bad `opens`). */
export function parseApp(raw: unknown): { ok: true; app: AppWord[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, app: [] };
  if (!Array.isArray(raw) || raw.length > APP_WORDS.length || raw.some((w) => typeof w !== "string" || !(APP_WORDS as readonly string[]).includes(w)) || new Set(raw).size !== raw.length)
    return { ok: false, error: `app must be a list of ${APP_WORDS.join(", ")}, each once` };
  return { ok: true, app: APP_WORDS.filter((w) => raw.includes(w)) };
}

/** The card's lines for what it asks of the app. Reading across every vault, and links out, are stressed. */
export function appLines(app: readonly AppWord[]): { text: string; stress: boolean }[] {
  const out: { text: string; stress: boolean }[] = [];
  if (app.includes("recent")) out.push({ text: "See the titles of the newest notes in every vault on this device", stress: true });
  if (app.includes("pins")) out.push({ text: "See what is on your bar", stress: false });
  if (app.includes("open")) out.push({ text: "Take you to a note or an applet when you tap, see which note links lead to a note, and know its vault's web address", stress: false });
  if (app.includes("links")) out.push({ text: "Open web addresses in your browser: what it reads could leave in an address it opens", stress: true });
  if (app.includes("save")) out.push({ text: "Save files to your device's Downloads", stress: false });
  if (app.includes("attach")) out.push({ text: "Ask you to pick a file or picture to give it", stress: false });
  if (app.includes("vaults")) out.push({ text: "See every record in every vault on this device (its words, fields, types, tags, links and history), and change records where you let Parachute change them", stress: true });
  if (app.includes("sharing")) out.push({ text: "See what reaches each vault (this app, its applets), and, each after you say yes on the app's own sheet: publish a record (anyone with its link can read it), take an applet's access back, or make a vault read only", stress: true });
  if (app.includes("storage")) out.push({ text: "Keep up to 256 KB on this device for itself (drafts, what it last showed)", stress: false });
  return out;
}
