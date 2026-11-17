// What the shell does on this device for an applet's links, saved files and storage (docs/design/KEYRING.md "Voice,
// files, links, storage"). In the app on a device, Rust does the first two (src-tauri/src/files.rs: `open_link`,
// `save_file`); in a browser (the web build) the browser does. The calls are checked before they get here
// (applet/modules/app.ts, storage.ts), and Rust checks a link and a name again.
import { inShell } from "../vault/oauth";
import type { StorageDeps } from "../applet/modules/storage";

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

/** A file into the person's Downloads: the name it was saved as (the app picks a free one: "notes (2).pdf"). In a
 *  browser, the browser's own download, under the name given. */
export async function saveFileOut(name: string, bytes: ArrayBuffer, type: string): Promise<string> {
  if (inShell()) return invoke<string>("save_file", { name, bytes: b64(new Uint8Array(bytes)), mime: type });
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.rel = "noopener"; a.hidden = true;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return name;
}

/** Where an applet's storage is kept: one localStorage entry per applet (its grant's subject). */
export const STORAGE_PREFIX = "parachute.applet-storage.v1:";

export function storageFor(subject: string): StorageDeps {
  const key = STORAGE_PREFIX + encodeURIComponent(subject);
  return {
    read() {
      try {
        const v = JSON.parse(localStorage.getItem(key) ?? "{}") as unknown;
        return v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>)) : {};
      } catch { return {}; }
    },
    write(all) {
      if (Object.keys(all).length) localStorage.setItem(key, JSON.stringify(all));
      else localStorage.removeItem(key);
    },
  };
}
