// A relay's line the walk can cut (e2e/android/unsent.ts): a TCP pass-through on loopback, from `listen` to the relay at
// `to`, the way the phone reaches it (scripts/android-drive.sh DRIVE_PORTS maps the phone's port here). `down()` closes
// every connection and refuses new ones; `cutOnPost()` lets the line be until the phone sends a message (a nostr EVENT of
// kind 9, read from its WebSocket frames), then drops that frame and goes down: the connection closes as the message
// goes out, as a phone off the tailnet or just waking loses it. `up()` lets connections through again.
import { createServer, connect, type Socket } from "node:net";

export function cutter(listen: number, to: number) {
  let state: "up" | "down" | "armed" = "up";
  const open = new Set<Socket>();
  const posts: string[] = [];
  const kill = () => { for (const s of open) s.destroy(); open.clear(); };
  const server = createServer((phone) => {
    if (state === "down") { phone.destroy(); return; }
    const relay = connect(to, "127.0.0.1");
    open.add(phone); open.add(relay);
    const gone = () => { open.delete(phone); open.delete(relay); phone.destroy(); relay.destroy(); };
    phone.on("error", gone); relay.on("error", gone); phone.on("close", gone); relay.on("close", gone);
    relay.on("data", (d) => { if (state !== "down") phone.write(d); });
    // the phone's side: HTTP until a WebSocket upgrade, then frames (masked, as a client sends them)
    let buf = Buffer.alloc(0), ws = false;
    phone.on("data", (d) => {
      if (state === "down") return;
      if (!ws) {
        const head = d.toString("latin1");
        if (/^GET /.test(head) && /upgrade:\s*websocket/i.test(head)) { ws = true; const end = d.indexOf("\r\n\r\n"); relay.write(d.subarray(0, end + 4)); buf = d.subarray(end + 4); }
        else { relay.write(d); return; }
      } else buf = Buffer.concat([buf, d]);
      // whole frames only: each one read for a post, then passed on (or dropped, with the line)
      for (;;) {
        if (buf.length < 2) return;
        let len = buf[1] & 0x7f, at = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); at = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); at = 10; }
        const masked = (buf[1] & 0x80) !== 0;
        const total = at + (masked ? 4 : 0) + len;
        if (buf.length < total) return;
        const frame = buf.subarray(0, total);
        buf = buf.subarray(total);
        const key = masked ? frame.subarray(at, at + 4) : null;
        const body = Buffer.from(frame.subarray(at + (masked ? 4 : 0)));
        if (key) for (let i = 0; i < body.length; i++) body[i] ^= key[i % 4];
        const text = (frame[0] & 0x0f) === 1 ? body.toString("utf8") : "";
        if (text.startsWith('["EVENT"')) {
          try {
            const ev = JSON.parse(text)[1] as { id: string; kind: number };
            if (ev.kind === 9) {
              posts.push(ev.id);
              if (state === "armed") { state = "down"; kill(); return; }
            }
          } catch { /* not one */ }
        }
        relay.write(frame);
      }
    });
  });
  return {
    start: () => new Promise<void>((r) => server.listen(listen, "127.0.0.1", () => r())),
    up: () => { state = "up"; },
    down: () => { state = "down"; kill(); },
    cutOnPost: () => { state = "armed"; },
    /** the id of every message (kind 9) the phone sent, cut or not */
    posts,
    close: () => { kill(); server.close(); },
  };
}
