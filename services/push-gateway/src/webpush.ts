// Web Push message encryption (RFC 8291, with RFC 8188's aes128gcm): every push is sealed to the keys the app's
// UnifiedPush connector made for this registration, so the push server (ntfy, or anyone's) sees only its size and time.
// The connector opens it on the phone; a push that doesn't open there is dropped (PushService.kt).
import { createCipheriv, createDecipheriv, createECDH, hkdfSync, randomBytes } from "node:crypto";

export const b64u = {
  encode: (b: Uint8Array) => Buffer.from(b).toString("base64url"),
  decode: (s: string) => new Uint8Array(Buffer.from(s, "base64url")),
};

const RS = 4096;
const enc = (s: string) => new TextEncoder().encode(s);
const cat = (...parts: Uint8Array[]) => new Uint8Array(Buffer.concat(parts));

export type Keys = { p256dh: string; auth: string };

/** The receiver's keys as a registration carries them: an uncompressed P-256 point and a 16-byte secret, base64url. */
export function keysOk(k: unknown): k is Keys {
  if (!k || typeof k !== "object") return false;
  const { p256dh, auth } = k as Record<string, unknown>;
  if (typeof p256dh !== "string" || typeof auth !== "string" || !/^[A-Za-z0-9_-]+$/.test(p256dh) || !/^[A-Za-z0-9_-]+$/.test(auth)) return false;
  const pub = b64u.decode(p256dh), secret = b64u.decode(auth);
  if (pub.length !== 65 || pub[0] !== 4 || secret.length !== 16) return false;
  try {
    // a point on the curve: an ECDH with it works
    const e = createECDH("prime256v1");
    e.generateKeys();
    e.computeSecret(pub);
    return true;
  } catch {
    return false;
  }
}

function derive(ecdhSecret: Uint8Array, authSecret: Uint8Array, uaPublic: Uint8Array, asPublic: Uint8Array, salt: Uint8Array) {
  const keyInfo = cat(enc("WebPush: info\0"), uaPublic, asPublic);
  const ikm = new Uint8Array(hkdfSync("sha256", ecdhSecret, authSecret, keyInfo, 32));
  const cek = new Uint8Array(hkdfSync("sha256", ikm, salt, enc("Content-Encoding: aes128gcm\0"), 16));
  const nonce = new Uint8Array(hkdfSync("sha256", ikm, salt, enc("Content-Encoding: nonce\0"), 12));
  return { cek, nonce };
}

/** One record, aes128gcm. `fixed` is for the RFC's test vector only (its sender key and salt). */
export function encrypt(plaintext: Uint8Array, keys: Keys, fixed?: { senderPrivate: Uint8Array; salt: Uint8Array }): Uint8Array {
  const uaPublic = b64u.decode(keys.p256dh), authSecret = b64u.decode(keys.auth);
  const sender = createECDH("prime256v1");
  if (fixed) sender.setPrivateKey(fixed.senderPrivate);
  else sender.generateKeys();
  const asPublic = new Uint8Array(sender.getPublicKey());
  const salt = fixed?.salt ?? new Uint8Array(randomBytes(16));
  const { cek, nonce } = derive(new Uint8Array(sender.computeSecret(uaPublic)), authSecret, uaPublic, asPublic, salt);
  const c = createCipheriv("aes-128-gcm", cek, nonce);
  const body = cat(c.update(cat(plaintext, new Uint8Array([2]))), c.final(), c.getAuthTag());
  const header = new Uint8Array(21 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RS);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return cat(header, body);
}

/** The receiver's side, for tests and for anyone checking what a push carries. */
export function decrypt(message: Uint8Array, receiverPrivate: Uint8Array, authSecret: Uint8Array): Uint8Array {
  const salt = message.slice(0, 16), idlen = message[20], asPublic = message.slice(21, 21 + idlen), body = message.slice(21 + idlen);
  const receiver = createECDH("prime256v1");
  receiver.setPrivateKey(receiverPrivate);
  const uaPublic = new Uint8Array(receiver.getPublicKey());
  const { cek, nonce } = derive(new Uint8Array(receiver.computeSecret(asPublic)), authSecret, uaPublic, asPublic, salt);
  const d = createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(body.slice(body.length - 16));
  const padded = cat(d.update(body.slice(0, body.length - 16)), d.final());
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end--;
  if (padded[end] !== 2) throw new Error("not a last record");
  return padded.slice(0, end);
}
