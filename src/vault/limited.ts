// Replies from someone else's hub are read up to a limit (docs/design/EMBED.md, "Code that hangs"): a hub built to send a
// huge answer could otherwise hold the app up while it is read and parsed. A bigger reply is refused as that hub's
// error, before anything parses it. The person's own hubs keep today's limits.

/** The most a reply from someone else's hub may hold. */
export const MAX_REPLY_BYTES = 4 * 1024 * 1024;
/** The most an applet's or a component's code may hold, from someone else's vault. */
export const MAX_CODE_CHARS = 200_000;

export class TooLargeError extends Error {
  constructor() { super("The hub's answer was too large to read."); this.name = "TooLargeError"; }
}

/** A fetch that reads each reply's body up to `max` bytes, and refuses a bigger one. */
export function limitedFetch(base: typeof fetch = (...a) => fetch(...a), max = MAX_REPLY_BYTES): typeof fetch {
  return async (input, init) => {
    const res = await base(input, init);
    const said = Number(res.headers.get("content-length"));
    if (Number.isFinite(said) && said > max) { void res.body?.cancel().catch(() => {}); throw new TooLargeError(); }
    if (!res.body) return res;
    const reader = res.body.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) { void reader.cancel().catch(() => {}); throw new TooLargeError(); }
      parts.push(value);
    }
    const body = new Uint8Array(size);
    let at = 0;
    for (const p of parts) { body.set(p, at); at += p.byteLength; }
    const out = new Response([204, 205, 304].includes(res.status) ? null : body, { status: res.status, statusText: res.statusText, headers: res.headers });
    // what callers read about how the reply came (records.ts asks whether it was redirected)
    Object.defineProperty(out, "redirected", { value: res.redirected });
    Object.defineProperty(out, "url", { value: res.url });
    return out;
  };
}
