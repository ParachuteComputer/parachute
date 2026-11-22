// A small zip reader (T-476, Import from Notion): the files in a .zip, for an export a person picked. Stored and
// deflated entries (the two every exporter writes); deflate through the platform's own DecompressionStream, so no
// library comes with it. A zip inside the zip (Notion puts its export in "Export-…-Part-1.zip") is opened too, its
// files taking the place of the inner zip. Limits keep a hostile file from filling memory: at most MAX_FILES files and
// MAX_TOTAL bytes once unpacked, and nesting one level deep.

export type ZipFiles = Map<string, Uint8Array>;
export const MAX_FILES = 5000;
export const MAX_TOTAL = 200 * 1024 * 1024;

export class ZipError extends Error { constructor(m: string) { super(m); this.name = "ZipError"; } }

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(data); c.close(); } }).pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The end of central directory record: where the list of entries starts, and how many. */
function directory(b: Uint8Array): { at: number; count: number } {
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) {
    if (u32(b, i) === 0x06054b50) return { at: u32(b, i + 16), count: u16(b, i + 10) };
  }
  throw new ZipError("That file isn't a zip.");
}

/** Every file in the zip by its path (folders left out), and the files of any zip inside it, at its place. */
export async function readZip(bytes: ArrayBuffer | Uint8Array, depth = 0): Promise<ZipFiles> {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const out: ZipFiles = new Map();
  let total = 0;
  const { at, count } = directory(b);
  const strict = new TextDecoder("utf-8", { fatal: true }), latin = new TextDecoder("latin1");
  // names are UTF-8 when the zip says so (flag 11), and in practice nearly always; else the old code page, read as latin1
  const nameOf = (raw: Uint8Array) => { try { return strict.decode(raw); } catch { return latin.decode(raw); } };
  let p = at;
  for (let n = 0; n < count; n++) {
    if (u32(b, p) !== 0x02014b50) throw new ZipError("The zip's list of files is broken.");
    const flags = u16(b, p + 8), method = u16(b, p + 10), size = u32(b, p + 20), full = u32(b, p + 24);
    const nameLen = u16(b, p + 28), extraLen = u16(b, p + 30), commentLen = u16(b, p + 32), local = u32(b, p + 42);
    const raw = b.subarray(p + 46, p + 46 + nameLen);
    const name = nameOf(raw);
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    if (flags & 1) throw new ZipError("The zip is password-protected.");
    if (size === 0xffffffff || full === 0xffffffff) throw new ZipError("The zip is too big to read here.");
    if (u32(b, local) !== 0x04034b50) throw new ZipError("The zip is broken.");
    const start = local + 30 + u16(b, local + 26) + u16(b, local + 28);
    const data = b.subarray(start, start + size);
    if (data.length !== size) throw new ZipError("The zip is cut short.");
    total += full;
    if (total > MAX_TOTAL) throw new ZipError("The zip is over 200 MB unpacked.");
    const file = method === 0 ? data : method === 8 ? await inflate(data) : null;
    if (!file) throw new ZipError(`The zip uses a kind of compression this can't read (${method}).`);
    if (file.length !== full) throw new ZipError("The zip is broken: a file isn't the size it says.");
    const path = name.replace(/\\/g, "/").replace(/^\/+/, "");
    if (/\.zip$/i.test(path) && depth === 0) {
      for (const [k, v] of await readZip(file, 1)) out.set(k, v);
    } else out.set(path, file);
    if (out.size > MAX_FILES) throw new ZipError(`The zip has over ${MAX_FILES} files.`);
  }
  // a zip inside counts toward the same limit once unpacked
  if (depth === 0 && [...out.values()].reduce((n, f) => n + f.length, 0) > MAX_TOTAL) throw new ZipError("The zip is over 200 MB unpacked.");
  return out;
}
