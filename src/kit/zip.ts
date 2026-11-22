// A small zip reader (T-476, Import from Notion): the files in a .zip, for an export a person picked. Stored and
// deflated entries (the two every exporter writes); deflate through the platform's own DecompressionStream, so no
// library comes with it. A zip at the top of the zip (Notion puts its export in "Export-…-Part-1.zip") is opened too,
// its files taking the place of the inner zip; a zip deeper in is an attachment, and stays one. Limits keep a hostile
// file from filling memory, counted across the zip and every zip in it: at most MAX_FILES files and MAX_TOTAL bytes
// once unpacked, each entry stopped as soon as it passes the size it claims, and one name only once. Entries the caller
// doesn't `want` are listed by name with no bytes, never unpacked (an export's images, when only its pages are read).

export type ZipFiles = Map<string, Uint8Array>;
export const MAX_FILES = 5000;
export const MAX_TOTAL = 200 * 1024 * 1024;

export class ZipError extends Error { constructor(m: string) { super(m); this.name = "ZipError"; } }

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/** Inflate, stopping as soon as it passes the size the zip says it is: a small entry can't grow to fill memory. */
async function inflate(data: Uint8Array, size: number): Promise<Uint8Array> {
  const reader = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(data); c.close(); } }).pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const out = new Uint8Array(size);
  let at = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (at + value.length > size) { await reader.cancel().catch(() => {}); throw new ZipError("The zip is broken: a file is bigger than it says."); }
    out.set(value, at); at += value.length;
  }
  if (at !== size) throw new ZipError("The zip is broken: a file isn't the size it says.");
  return out;
}

/** The end of central directory record: where the list of entries starts, and how many. */
function directory(b: Uint8Array): { at: number; count: number } {
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) {
    if (u32(b, i) === 0x06054b50) return { at: u32(b, i + 16), count: u16(b, i + 10) };
  }
  throw new ZipError("That file isn't a zip.");
}

export type ZipOptions = { want?: (path: string) => boolean; /** bytes once unpacked (MAX_TOTAL) */ max?: number };
type Budget = { bytes: number; files: number };

/** Every file in the zip by its path (folders left out), and the files of a zip at its top, at its place. */
export async function readZip(bytes: ArrayBuffer | Uint8Array, opts: ZipOptions = {}): Promise<ZipFiles> {
  const out: ZipFiles = new Map();
  await readInto(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), out, { bytes: 0, files: 0 }, opts, 0);
  return out;
}

async function readInto(b: Uint8Array, out: ZipFiles, budget: Budget, opts: ZipOptions, depth: number): Promise<void> {
  const { at, count } = directory(b);
  const strict = new TextDecoder("utf-8", { fatal: true }), latin = new TextDecoder("latin1");
  // names are UTF-8 when the zip says so (flag 11), and in practice nearly always; else the old code page, read as latin1
  const nameOf = (raw: Uint8Array) => { try { return strict.decode(raw); } catch { return latin.decode(raw); } };
  let p = at;
  for (let n = 0; n < count; n++) {
    if (u32(b, p) !== 0x02014b50) throw new ZipError("The zip's list of files is broken.");
    const flags = u16(b, p + 8), method = u16(b, p + 10), size = u32(b, p + 20), full = u32(b, p + 24);
    const nameLen = u16(b, p + 28), extraLen = u16(b, p + 30), commentLen = u16(b, p + 32), local = u32(b, p + 42);
    const name = nameOf(b.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    if (++budget.files > MAX_FILES) throw new ZipError(`The zip has over ${MAX_FILES} files.`);
    const path = name.replace(/\\/g, "/").replace(/^\/+/, "");
    // a zip at the top of the outer zip is the export's own wrapping: opened. Anything else not wanted: its name only
    const inner = depth === 0 && /\.zip$/i.test(path) && !path.includes("/");
    if (!inner && opts.want && !opts.want(path)) { if (out.has(path)) throw new ZipError(`The zip has ${path} twice.`); out.set(path, new Uint8Array(0)); continue; }
    if (flags & 1) throw new ZipError("The zip is password-protected.");
    if (size === 0xffffffff || full === 0xffffffff) throw new ZipError("The zip is too big to read here.");
    if (u32(b, local) !== 0x04034b50) throw new ZipError("The zip is broken.");
    const start = local + 30 + u16(b, local + 26) + u16(b, local + 28);
    const data = b.subarray(start, start + size);
    if (data.length !== size) throw new ZipError("The zip is cut short.");
    // one budget for the whole file: a zip inside can't start again from nothing
    budget.bytes += full;
    if (budget.bytes > (opts.max ?? MAX_TOTAL)) throw new ZipError(`The zip is over ${Math.round((opts.max ?? MAX_TOTAL) / 1024 / 1024)} MB unpacked.`);
    const file = method === 0 ? data : method === 8 ? await inflate(data, full) : null;
    if (!file) throw new ZipError(`The zip uses a kind of compression this can't read (${method}).`);
    if (file.length !== full) throw new ZipError("The zip is broken: a file isn't the size it says.");
    if (inner) { budget.bytes -= full; await readInto(file, out, budget, opts, 1); continue; }
    if (out.has(path)) throw new ZipError(`The zip has ${path} twice.`);
    out.set(path, file);
  }
}
