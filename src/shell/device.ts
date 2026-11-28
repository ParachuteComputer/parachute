// What the shell does on this device for an applet's links, saved files and storage (docs/design/KEYRING.md "Voice,
// files, links, storage"). In the app on a device, Rust does the first two (src-tauri/src/files.rs: `open_link`,
// `save_file`); in a browser (the web build) the browser does. The calls are checked before they get here
// (applet/modules/app.ts, storage.ts), and Rust checks a link and a name again.
import { inShell } from "../vault/oauth";
import type { StorageDeps } from "../applet/modules/storage";
import { deviceSaved } from "./saved";
import { deviceFiles } from "./keptFiles";
import { ContractError, ERROR_CODES } from "../applet/contract";
import { PICTURE_MAX, pictureType } from "../applet/files";

async function invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

const b64 = (b: Uint8Array): string => { let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };

/** An http, https or mailto address in the system's browser (the app), or a new tab (a browser). */
export async function openLinkOut(url: string): Promise<void> {
  if (inShell()) { await invoke("open_link", { url }); return; }
  window.open(url, "_blank", "noopener,noreferrer");
}

/** A web picture for an applet allowed `pictures` (applet/modules/app.ts checked the address): in the app, Rust fetches it
 *  (src-tauri/src/pictures.rs: public addresses only, every name resolved there, no cookies or referrer, 10 MB); in a
 *  browser, the browser does, without credentials or referrer, if the picture's server allows it (CORS), and never
 *  after a redirect (the browser would follow one before it could be checked). Either way
 *  it is a picture only if its first bytes say PNG, JPEG, GIF or WebP. */
export async function pictureOut(url: string): Promise<{ type: string; bytes: ArrayBuffer }> {
  let bytes: ArrayBuffer;
  if (inShell()) bytes = await invoke<ArrayBuffer>("web_picture", { url });
  else {
    const r = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer", mode: "cors", redirect: "error", cache: "force-cache" });
    if (!r.ok) throw new ContractError(ERROR_CODES.failed, `the picture's server said ${r.status}`);
    if (Number(r.headers.get("content-length") ?? 0) > PICTURE_MAX) throw new ContractError(ERROR_CODES.failed, "the picture is over 10 MB");
    const reader = r.body?.getReader();
    const parts: Uint8Array[] = [];
    let n = 0;
    for (;;) {
      const got = reader ? await reader.read() : { done: true as const, value: undefined };
      if (got.done) break;
      n += got.value.byteLength;
      if (n > PICTURE_MAX) { void reader?.cancel(); throw new ContractError(ERROR_CODES.failed, "the picture is over 10 MB"); }
      parts.push(got.value);
    }
    const all = new Uint8Array(n);
    let at = 0;
    for (const p of parts) { all.set(p, at); at += p.byteLength; }
    bytes = all.buffer;
  }
  const type = pictureType(new Uint8Array(bytes, 0, Math.min(16, bytes.byteLength)));
  if (!type) throw new ContractError(ERROR_CODES.failed, "it isn't a PNG, JPEG, GIF or WebP picture");
  return { type, bytes };
}

/** A file into the person's Downloads: the name it was saved as (the app picks a free one: "notes (2).pdf"). In a
 *  browser, the browser's own download, under the name given. */
export async function saveFileOut(name: string, bytes: ArrayBuffer, type: string): Promise<string> {
  if (inShell()) return invoke<string>("save_file", { name, bytes: b64(new Uint8Array(bytes)), mime: type });
  // always as plain bytes (its name carries its kind): a blob of an applet's choosing, typed as a page or a picture
  // with script in it, would open in this page's own origin wherever a browser shows it instead of saving it
  void type;
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.rel = "noopener"; a.hidden = true;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return name;
}

/** Where an applet's storage is kept: the saved store (shell/saved.ts), one per applet (its grant's subject). */
export function storageFor(subject: string, store = deviceSaved(), kept = deviceFiles()): StorageDeps {
  return {
    files: { put: (key, bytes) => kept.put(subject, key, bytes), get: (key) => kept.get(subject, key), drop: (key) => kept.drop(subject, key), keys: () => kept.keys(subject) },
    // a store that can't be read is a refusal, never an empty store (T-476: Rooms' outbox would take it as empty)
    read: () => store.read(subject),
    async write(all) {
      // what is gone from it is removed, the rest set: one write to the same store the kit's saved state uses
      const entries: Record<string, unknown> = Object.fromEntries([...Object.entries(all), ...Object.keys(store.now(subject)).filter((k) => !Object.hasOwn(all, k)).map((k) => [k, null] as const)]);
      if (Object.keys(entries).length && (await store.put(subject, entries)) === "full") throw new ContractError(ERROR_CODES.tooLarge, "its storage on this device is full (256 KB)");
    },
  };
}
