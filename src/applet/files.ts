// What the shell's voice, file, link and storage calls accept (docs/design/KEYRING.md "Voice, files, links, storage").
// Pure: the modules check every call with these, and so do the shell's own answers.
import { ContractError, ERROR_CODES, hasHidden, plain, stripHidden } from "./contract.ts";

/** A file it saves, attaches or is given: 25 MB at most. */
export const FILE_MAX = 25 * 1024 * 1024;
/** Files one pick may hand it. */
export const PICK_MAX = 10;
/** A saved file's name, in characters. */
export const NAME_MAX = 100;
/** What it keeps on this device, as JSON. */
export const STORAGE_MAX = 256 * 1024;
export const STORAGE_KEY_MAX = 100;
/** A recording: 10 minutes unless it asks for less. */
export const RECORD_MAX_S = 600;
/** One link a second, and one saved file: a tap's few seconds of activation can't pay for a burst of either. */
export const LINK_GAP_MS = 1000;
export const SAVE_GAP_MS = 1000;

/** A web or mail address it may open: http, https or mailto, with nothing hidden or unencoded in it. */
export function linkOk(url: unknown): url is string {
  if (typeof url !== "string" || !url || url.length > 2000 || /[\u0000-\u0020\u007f]/.test(url) || hasHidden(url)) return false;
  if (!/^(https?:\/\/|mailto:)/i.test(url)) return false;
  try {
    const u = new URL(url);
    if (u.protocol === "mailto:") return true;
    return (u.protocol === "http:" || u.protocol === "https:") && !!u.hostname;
  } catch { return false; }
}

/** A name reduced to a bare file name: no folder, no separator, no leading dot, nothing a file system refuses, at most
 *  100 characters (the extension kept). Never empty. */
export function bareName(raw: string): string {
  let n = stripHidden(String(raw)).replace(/[\u0000-\u001f\u007f]/g, "");
  n = n.split(/[\\/]/).pop() ?? "";
  n = n.replace(/[<>:"|?*]/g, "_").trim().replace(/^[.\s]+/, "").replace(/[.\s]+$/, "");
  const chars = [...n];
  if (chars.length > NAME_MAX) {
    const dot = n.lastIndexOf(".");
    const ext = dot > 0 && n.length - dot <= 11 ? n.slice(dot) : "";
    n = [...n.slice(0, n.length - ext.length)].slice(0, NAME_MAX - [...ext].length).join("").trimEnd() + ext;
  }
  return n || "file";
}

/** A media type as a file carries it ("audio/webm", parameters dropped), or null. */
export function mediaType(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 200) return null;
  const t = raw.split(";")[0].trim().toLowerCase();
  return /^[a-z0-9][a-z0-9!#$&^_.+-]{0,62}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,62}$/.test(t) ? t : null;
}

/** What a pick may be narrowed to: ".pdf", "image/*", "audio/webm", as a list or one comma-separated string, at most 10. */
export function parseAccept(raw: unknown): string[] | null {
  if (raw === undefined || raw === null) return [];
  const list = typeof raw === "string" ? raw.split(",").map((s) => s.trim()).filter(Boolean) : Array.isArray(raw) ? raw : null;
  if (!list || list.length > 10) return null;
  const out: string[] = [];
  for (const a of list) {
    if (typeof a !== "string" || !(/^\.[a-z0-9]{1,10}$/i.test(a) || /^[a-z]+\/(\*|[a-z0-9.+-]{1,60})$/i.test(a))) return null;
    out.push(a.toLowerCase());
  }
  return [...new Set(out)];
}

/** Its storage's size, as the UTF-8 of its JSON. */
export const storageSize = (all: Record<string, unknown>): number => new TextEncoder().encode(JSON.stringify(all)).length;

/** A value as JSON keeps it (what a later `get` gives back), or undefined for one JSON can't hold. */
export function asJson(x: unknown): unknown {
  try { const s = JSON.stringify(x); return s === undefined ? undefined : JSON.parse(s); } catch { return undefined; }
}

// ── Pictures attached to a record (docs/design/PICTURES.md): one check for `vaults.file` and `vault.file` ──

/** What a note draws: a picture (a sound, a video or a document is opened, not drawn). */
const DRAWN = /^image\//;
/** A file's place in the vault's storage, from a link in a record's words (`/api/storage/<date>/<file>`, or the bare
 *  `<date>/<file>`): decoded once; null for anything else (a query, a fragment, a dot segment, a backslash, a control). */
export function storagePath(src: string): string | null {
  if (src.length > 500) return null;
  let p = src.startsWith("/api/storage/") ? src.slice("/api/storage/".length) : src;
  try { p = decodeURIComponent(p); } catch { return null; }
  if (!p || /[?#\\\u0000-\u001f\u007f]/.test(p) || p.startsWith("/") || p.includes("//")) return null;
  return p.split("/").length >= 2 && p.split("/").every((s) => s !== "" && !/^\.+$/.test(s.trim())) ? p : null;
}

/** Each record's attachments as the hub listed them in the last 10 s, 20 records at most: a note's pictures ask once,
 *  not once each. `read` asks the hub; `charge` is paid only when it does. */
export function attachmentLists(read: (key: string) => Promise<unknown>) {
  const lists = new Map<string, { at: number; rows: Promise<unknown[]> }>();
  /** `fresh`: asked of the hub whatever is kept (a write is judged on it). */
  const of = (key: string, charge: () => void, fresh = false): Promise<unknown[]> => {
    const hit = lists.get(key);
    if (hit && !fresh && Date.now() - hit.at < 10_000) return hit.rows;
    charge();
    const rows = read(key).then((raw) => (Array.isArray(raw) ? raw : plain(raw) && Array.isArray(raw.attachments) ? raw.attachments as unknown[] : []));
    rows.catch(() => { if (lists.get(key)?.rows === rows) lists.delete(key); });
    lists.set(key, { at: Date.now(), rows });
    while (lists.size > 20) lists.delete(lists.keys().next().value as string);
    return rows;
  };
  /** A record given a file: its list is asked again next time. */
  return Object.assign(of, { forget: (key: string) => { lists.delete(key); } });
}

/** The picture at storage path `want` (from storagePath), only when it is in the record's attachment list: listed as a
 *  picture before it is read, served as one by the hub (the type the hub gives from the file's name: the listed one is
 *  whatever the attacher wrote), 25 MB at most. `failed` turns the read's failure into the caller's error. */
export async function attachedPicture(want: string, list: unknown[], read: (path: string) => Promise<Blob>, failed: (e: unknown) => ContractError): Promise<{ type: string; bytes: ArrayBuffer }> {
  const att = list.find((a): a is Record<string, unknown> => plain(a) && a.path === want);
  if (!att) throw new ContractError(ERROR_CODES.outOfScope, "only a file attached to the record");
  if (!DRAWN.test(mediaType(att.mimeType ?? att.mime_type) ?? "")) throw new ContractError(ERROR_CODES.outOfScope, "only a picture is handed over");
  let blob: Blob;
  try { blob = await read(want); } catch (e) { throw failed(e); }
  const type = mediaType(blob.type);
  if (!type || !DRAWN.test(type)) throw new ContractError(ERROR_CODES.outOfScope, "only a picture is handed over");
  if (blob.size > FILE_MAX) throw new ContractError(ERROR_CODES.tooLarge, "too_large: a file over 25 MB isn't handed over");
  return { type, bytes: await blob.arrayBuffer() };
}
