// vCard text: lines, values and the small rules People already uses (applets/people.tsx). Copied from there, not
// imported, so the bridge runs alone on Node with no build step; where a rule is the applet's, the comment says so and
// a card means the same thing in both. vCard 2.1, 3.0 and 4.0 are read; 3.0 is written (card.ts says why).

/** One property of a card: `item1.TEL;TYPE=cell:+1 303…` → group `item1`, name `TEL`, params `{TYPE: ["cell"]}`. */
export type Prop = { group: string; name: string; params: Record<string, string[]>; value: string; line: string };

/** The applet's `unescapeVCard`: `\n` is a newline, `\,` `\;` `\\` are themselves. */
export function unescapeValue(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && i + 1 < s.length) {
      const next = s[i + 1];
      out += next === "n" || next === "N" ? "\n" : next;
      i++;
    } else out += s[i];
  }
  return out;
}

/** The applet's `escapeVCard`. */
export function escapeValue(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
}

/** Split on `sep` where it isn't escaped (the applet's `splitVCardEscaped`); the parts keep their escapes. */
export function splitEscaped(s: string, sep: string): string[] {
  const parts: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && i + 1 < s.length) { cur += s[i] + s[i + 1]; i++; }
    else if (s[i] === sep) { parts.push(cur); cur = ""; }
    else cur += s[i];
  }
  parts.push(cur);
  return parts;
}

/** A line folded at 75 octets, never inside a character (the applet's `foldVCardLine`). */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "", curBytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (curBytes + n > 75 && cur) { out.push(cur); cur = ` ${ch}`; curBytes = 1 + n; }
    else { cur += ch; curBytes += n; }
  }
  if (cur) out.push(cur);
  return out.join("\r\n");
}

function decodeQuotedPrintable(input: string, charset = "utf-8"): string {
  const cleaned = input.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === "=" && i + 2 < cleaned.length && /^[0-9A-Fa-f]{2}$/.test(cleaned.slice(i + 1, i + 3))) {
      bytes.push(parseInt(cleaned.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      const code = cleaned.codePointAt(i) ?? 0;
      if (code < 128) bytes.push(code);
      else { for (const b of new TextEncoder().encode(String.fromCodePoint(code))) bytes.push(b); if (code > 0xffff) i++; }
    }
  }
  let decoder: TextDecoder;
  try { decoder = new TextDecoder(charset || "utf-8"); } catch { decoder = new TextDecoder("utf-8"); }
  return decoder.decode(new Uint8Array(bytes));
}

function parseParams(raw: string[]): Record<string, string[]> {
  const params: Record<string, string[]> = {};
  for (const part of raw) {
    const eq = part.indexOf("=");
    if (eq < 0) {
      // vCard 2.1's bare parameter: ;CELL;VOICE or ;BASE64
      const tok = part.trim().toUpperCase();
      if (!tok) continue;
      if (tok === "BASE64" || tok === "QUOTED-PRINTABLE") (params.ENCODING ??= []).push(tok);
      else (params.TYPE ??= []).push(tok);
      continue;
    }
    const key = part.slice(0, eq).trim().toUpperCase();
    if (!key) continue;
    // TYPE=cell,voice and TYPE="cell,voice" are the same as TYPE=cell;TYPE=voice
    for (const v of part.slice(eq + 1).trim().replace(/^"(.*)"$/, "$1").split(",")) (params[key] ??= []).push(v.trim());
  }
  return params;
}

function splitOutsideQuotes(s: string, sep: string): string[] {
  const parts: string[] = [];
  let cur = "", q = false;
  for (const ch of s) {
    if (ch === '"') { q = !q; cur += ch; }
    else if (ch === sep && !q) { parts.push(cur); cur = ""; }
    else cur += ch;
  }
  parts.push(cur);
  return parts;
}

/** The cards in a text, each as its properties (unfolded; BEGIN and END left out). The applet's `parseVCard`, before
 *  it maps the properties: CRLF or LF, folded lines, a BOM, 2.1's quoted-printable soft breaks. */
export function readCards(text: string): Prop[][] {
  const unfolded = text.replace(/^\uFEFF/, "").replace(/\r\n|\r/g, "\n").replace(/\n[ \t]/g, "");
  const raw = unfolded.split("\n");
  const cards: Prop[][] = [];
  let props: Prop[] | null = null;
  for (let i = 0; i < raw.length; i++) {
    let line = raw[i];
    if (/QUOTED-PRINTABLE/i.test(line.slice(0, Math.max(0, line.indexOf(":"))))) {
      while (line.trimEnd().endsWith("=") && i + 1 < raw.length) line = line.trimEnd().slice(0, -1) + raw[++i];
    }
    line = line.trimEnd();
    if (!line) continue;
    const upper = line.toUpperCase();
    if (upper === "BEGIN:VCARD") { props = []; continue; }
    if (upper === "END:VCARD") { if (props) cards.push(props); props = null; continue; }
    if (!props) continue;
    let colon = -1, q = false;
    for (let j = 0; j < line.length; j++) {
      if (line[j] === '"') q = !q;
      else if (line[j] === ":" && !q) { colon = j; break; }
    }
    if (colon < 1) continue;
    const segs = splitOutsideQuotes(line.slice(0, colon), ";");
    const token = segs[0].trim();
    const dot = token.indexOf(".");
    const params = parseParams(segs.slice(1));
    let value = line.slice(colon + 1);
    if ((params.ENCODING ?? []).some((e) => e.toUpperCase() === "QUOTED-PRINTABLE")) value = decodeQuotedPrintable(value, (params.CHARSET ?? [])[0]);
    const name = (dot > 0 ? token.slice(dot + 1) : token).trim().toUpperCase();
    if (name) props.push({ group: dot > 0 ? token.slice(0, dot).trim() : "", name, params, value, line });
  }
  return cards;
}

/** The applet's `parseVCardBirthday`: `YYYY-MM-DD`, or `--MM-DD` with no year (also Apple's X-APPLE-OMIT-YEAR). */
export function parseBirthday(raw: string, params: Record<string, string[]>): string {
  const v = raw.trim();
  if (!v) return "";
  const omitYear = (params["X-APPLE-OMIT-YEAR"] ?? [])[0];
  const noYear = /^--(\d{2})-?(\d{2})$/.exec(v);
  if (noYear) return validBirthday(`--${noYear[1]}-${noYear[2]}`) ? `--${noYear[1]}-${noYear[2]}` : "";
  const full = /^(\d{4})-?(\d{2})-?(\d{2})(?:T.*)?$/i.exec(v);
  if (!full) return "";
  const out = omitYear && full[1] === omitYear ? `--${full[2]}-${full[3]}` : `${full[1]}-${full[2]}-${full[3]}`;
  return validBirthday(out) ? out : "";
}

const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
/** A birthday People shows (the applet's `parseYmd`): a real day, with or without its year. */
export function validBirthday(s: string): boolean {
  const full = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const noYear = full ? null : /^--(\d{2})-(\d{2})$/.exec(s);
  const m = full ?? noYear;
  if (!m) return false;
  const y = full ? Number(full[1]) : null;
  const mo = Number(m[full ? 2 : 1]), d = Number(m[full ? 3 : 2]);
  if (mo < 1 || mo > 12 || d < 1 || d > MONTH_DAYS[mo - 1]) return false;
  if (y !== null && mo === 2 && d === 29 && !((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0)) return false;
  return true;
}

/** The applet's `phoneLabelFromTypes`: an Apple/Android `itemN.X-ABLabel` wins, then the first known TYPE. */
export function phoneLabelFromTypes(types: string[], groupLabel?: string): string {
  if (groupLabel) {
    const cleaned = groupLabel.replace(/^_\$!<(.+?)>!\$_$/, "$1").trim().toLowerCase();
    if (cleaned) return cleaned;
  }
  const flat = types.flatMap((t) => t.split(",")).map((t) => t.trim().toLowerCase()).filter(Boolean);
  for (const preferred of ["cell", "mobile", "iphone", "work", "home", "main", "fax"]) {
    if (flat.includes(preferred)) return preferred === "cell" || preferred === "iphone" ? "mobile" : preferred;
  }
  return "";
}

/** The applet's `parsePhoneEntry`: `"mobile: +1 303…"` → label and number. */
export function parsePhoneEntry(entry: string): { label: string; number: string } {
  const m = /^([A-Za-z][A-Za-z0-9 _-]{0,20}):\s*(.+)$/.exec(entry.trim());
  if (m) return { label: m[1].trim().toLowerCase(), number: m[2].trim() };
  return { label: "", number: entry.trim() };
}

/** The applet's `normalizePhoneKey`: digits only, a leading US 1 dropped; "" for fewer than 7 digits. */
export function phoneKey(raw: string): string {
  const digits = parsePhoneEntry(raw).number.replace(/\D/g, "");
  if (digits.length < 7) return "";
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

/** The applet's `dedupeStrings`. */
export function dedupe(items: string[], key: (s: string) => string = (s) => s.toLowerCase()): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const clean = raw.trim();
    if (!clean) continue;
    const k = key(clean);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(clean);
  }
  return out;
}

/** The applet's `cleanPersonName`: what a note name may hold. */
export function cleanName(raw: string): string {
  return raw.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

/** The applet's `webLink`: an http(s) address on one line. */
export function webLink(u: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /^https?:\/\/[^\s\u0000-\u001f\u007f]+$/i.test(u);
}
