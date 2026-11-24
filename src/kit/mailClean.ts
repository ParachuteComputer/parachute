// A mail's HTML, made safe to draw: what the kit's MailBody (parts-mail.tsx) puts in its shadow root. Three steps, each
// with its own tests (mailClean.test.ts; scripts/mutate-mail.ts breaks each rule once and checks a test goes red):
//   1. purify   DOMPurify (vendored: vendor/VENDORED.md), HTML only (no SVG or MathML: their parsing is where mXSS
//               lives), and none of what DOMPurify allows by default that a mail mustn't have: its own <style> (taken
//               apart below), forms and their fields, media, <template>, <dialog>, image maps; no srcset, target or
//               ping. Scripts, handlers, frames, objects, javascript: and the like DOMPurify never lets through.
//   2. finish   a link is kept only to http, https or mailto (the shell's open-link opens those); a picture comes only
//               from the message itself (cid:), a data: picture, or the web once the person shows pictures, and a
//               tracking pixel never; every CSS url() is asked the same; the mail's CSS can't reach outside its root
//               (no :host, no @import or @font-face, no escapes to hide them); a quoted reply folds.
//   3. check    a last walk over what is left, with its own allowlist: an element outside it goes (DOMPurify keeps a few
//               a mail has no use for: <canvas>, <spacer>), and anything a rule above should have caught (a belt for
//               the braces), counted in `refused` (a test fails if a fixture ever needs it).
// Pure and synchronous: the pictures it may draw are given (`Pictures`); MailBody fetches them and cleans again.
import purify from "./vendor/purify.es.mjs";

export type Pictures = {
  /** Web pictures may load (the person showed them for this sender). */
  show: boolean;
  /** A web picture's address: what to draw for it (a blob: URL), or null while it isn't here. */
  web?: (url: string) => string | null;
  /** A part of the message by its Content-ID (`cid:` without the prefix, no angle brackets): a blob: URL, or null. */
  cid?: (id: string) => string | null;
};
export type Clean = {
  /** The message's body, in one `div.pa-mail-doc` that carries its <body>'s own colours. */
  root: DocumentFragment;
  /** Its own CSS, made safe (its `body`/`html` rules apply to the root). */
  css: string;
  /** The web pictures it shows when pictures are shown (never a tracking pixel), each once. */
  web: string[];
  /** The message's own parts it draws (cid:), each once. */
  cids: string[];
  /** Web pictures it has that aren't drawn now (hidden, or not here yet). */
  hidden: number;
  /** Tracking pixels taken out. */
  trackers: number;
  /** It sets colours of its own: draw it on paper, as its sender saw it, not in the app's dark look. */
  colored: boolean;
  /** What the last walk took out: an element outside its own list (a <canvas>, a <spacer>), or anything a rule before
   *  it missed (never, on the fixtures). */
  refused: number;
};

/** What DOMPurify allows by default and a mail mustn't have. */
export const FORBID_TAGS = ["style", "form", "input", "button", "select", "option", "optgroup", "textarea", "datalist", "output", "video", "audio", "source", "track", "template", "dialog", "map", "area"];
export const FORBID_ATTR = ["srcset", "popover", "popovertarget", "popovertargetaction", "commandfor"];
/** What the last walk never lets stay (DOMPurify drops the others itself; this checks it did). */
const NEVER_ATTR = ["srcset", "target", "ping", "formaction", "action", "poster", "popover", "popovertarget", "popovertargetaction", "commandfor", "command"];

/** A link a tap may open: http, https or mailto, nothing hidden or spaced in it, as the shell's open-link checks. */
export function webHref(raw: string | null): string | null {
  const v = (raw ?? "").trim();
  if (!/^(?:https?:\/\/[^/?#\s]|mailto:)/i.test(v) || /[\u0000-\u0020\u007f-\u009f\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/.test(v) || v.length > 2000) return null;
  try {
    const u = new URL(v);
    // an address with a user part reads as another site's ("https://www.apple.com@evil.example/")
    if (u.username || u.password) return null;
    if (u.protocol === "mailto:" && u.search) {
      // the pairs kept as they were written (RFC 6068 reads %20 as a space and + as a +; URLSearchParams wouldn't)
      const keep = u.search.slice(1).split("&").filter((pair) => ["subject", "body", "cc", "bcc"].includes(pair.split("=")[0].toLowerCase()));
      return `mailto:${u.pathname}${keep.length ? `?${keep.join("&")}` : ""}`;
    }
    return v;
  } catch { return null; }
}

const DATA_PICTURE = /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i;
/** What a picture's address is: the message's own part, a data: picture, a web picture, or nothing it may draw. */
function kindOf(src: string): { kind: "cid"; id: string } | { kind: "data" } | { kind: "web" } | null {
  if (/^cid:/i.test(src)) { const id = src.slice(4).trim().replace(/^<|>$/g, ""); return id ? { kind: "cid", id } : null; }
  if (DATA_PICTURE.test(src)) return { kind: "data" };
  if (/^https?:\/\//i.test(src) && webHref(src)) return { kind: "web" };
  return null;
}

/** Where an escape was: an escape can spell `url(` or `:host` so no rule sees it. The mark breaks the word it is in (no
 *  `url(` or `expression(` is made of one), and a rule whose selector has one goes (real mail hardly uses them). */
const ESCAPED = "\uffff";
/** CSS with its comments out, and each escape marked. */
function plainCss(css: string): string {
  // a comment becomes a space, never nothing: taken out, `://**/* c */host` would join into a new comment and `:host`
  return css.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, " ").replace(/\\(?:[0-9a-f]{1,6}\s?|[\s\S])/gi, ESCAPED);
}
// CSS's own whitespace, not JavaScript's \s (which takes U+00A0, inside an address to CSS)
const URL_TOKEN = /url\([ \t\n\r\f]*(?:"([^"\n\r\f]*)"|'([^'\n\r\f]*)'|([^)"' \t\n\r\f]*))[ \t\n\r\f]*\)/gi;
/** A url() the cleaning didn't write: a blob: or data: picture in quotes is the only kind it writes. */
const FOREIGN_URL = /url\((?!"(?:blob:|data:image\/))/i;
/** Ways CSS loads or runs something that aren't url(): taken out with their declaration. */
const CSS_BAD = /expression\s*\(|behavior\s*:|-moz-binding|javascript:|vbscript:|(?:image-set|image|src|cross-fade|element)\s*\(/i;
/** A position but static, relative or absolute (fixed, sticky, a var() that may be either): out of the flow onto the
 *  screen, a mail's "cover" over its own words or a bar over the app's. */
const PINNED = /^position\s*:(?!\s*(?:static|relative|absolute)\s*(?:!\s*important)?\s*$)/i;
const PINNED_ANYWHERE = /(?<![\w-])position[ \t\n\r\f]*:(?![ \t\n\r\f]*(?:static|relative|absolute)\b)/i;
/** How deep @media and the like may nest, and how much CSS a mail may have: past either, its CSS is left out (a deep
 *  nest would take the cleaning's stack, and the browser's). */
const NEST_MAX = 8;
export const CSS_MAX = 200_000;
const COLOURS = /(?:^|[;{\s])(?:background(?:-color)?|color)\s*:\s*(?!\s*(?:transparent|inherit|initial|unset|none|currentcolor)\s*(?:!important)?\s*(?:;|$))/i;

/** One declaration list (a style attribute, a rule's block): each url() asked of `pic` (none if it may not draw), and
 *  each declaration that would load or run something another way dropped. */
function cleanDeclarations(css: string, pic: (src: string) => string | null): string {
  const withUrls = css.replace(URL_TOKEN, (_m, a, b, c) => { const got = pic(String(a ?? b ?? c ?? "").trim()); return got ? `url("${got.replace(/["\\\n]/g, "")}")` : "none"; });
  return splitOutside(withUrls, ";").map((d) => d.trim()).filter((d) => d && !CSS_BAD.test(d) && !PINNED.test(d) && !FOREIGN_URL.test(d) && closed(d)).join("; ");
}
/** Where a string or an unquoted url() that starts at `i` ends, as the browser's CSS tokenizer reads them: a string
 *  ends at its quote or at a line break (which it doesn't take); an unquoted url( at its `)`, whatever quotes are in it.
 *  -1 when neither starts there. (Escapes are already marked, so no backslash is left to read.) */
function tokenEnd(s: string, i: number): number {
  const c = s[i];
  if (c === '"' || c === "'") {
    for (let j = i + 1; j < s.length; j++) { if (s[j] === c) return j + 1; if (s[j] === "\n" || s[j] === "\r" || s[j] === "\f") return j; }
    return s.length;
  }
  if (c === "u" || c === "U") {
    // url( and its whitespace, then not a quote (no backtracking into the whitespace: `url( "x)")` is a quoted one)
    const open = /^url\([ \t\n\r\f]*/i.exec(s.slice(i, i + 64));
    if (open && s[i + open[0].length] !== '"' && s[i + open[0].length] !== "'") { const close = s.indexOf(")", i); return close < 0 ? s.length : close + 1; }
  }
  return -1;
}
/** Every string in it closes on its line (one that doesn't would run on over the rules after it). */
function closed(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const end = tokenEnd(s, i);
    if (end < 0) continue;
    // a string closed by its quote ends just after it; one cut by a line break or the end doesn't
    if ((s[i] === '"' || s[i] === "'") && (end - i < 2 || s[end - 1] !== s[i])) return false;
    i = end - 1;
  }
  return true;
}
/** Split on `sep` outside strings, url()s and brackets. */
function splitOutside(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0, at = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const end = tokenEnd(s, i);
    if (end >= 0) { i = end - 1; continue; }
    if (c === "(" || c === "[") depth++;
    else if ((c === ")" || c === "]") && depth > 0) depth--;
    else if (c === sep && depth === 0) { out.push(s.slice(at, i)); at = i + 1; }
  }
  out.push(s.slice(at));
  return out;
}
/** The end of the block that opens at `open` (a `{`), or the text's end. */
function blockEnd(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    const end = tokenEnd(s, i);
    if (end >= 0) { i = end - 1; continue; }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  return s.length;
}
const KEEP_AT = /^@(?:media|supports|layer|container|document|-moz-document)\b/i;
const FRAMES_AT = /^@(?:-webkit-|-moz-|-o-)?keyframes\b/i;
/** A mail's style sheet: its rules kept with their declarations cleaned; @media and the like kept with what is in them;
 *  @import, @font-face, @charset, @namespace, @page and any other at-rule dropped; a rule that names the shadow root's
 *  host (`:host`, `::slotted`, `::part`) dropped, so nothing reaches the app; `html`, `body` and `:root` mean the root. */
export function cleanSheet(css: string, pic: (src: string) => string | null): string {
  if (css.length > CSS_MAX) return "";
  const out = cleanRules(css, pic, 0);
  // a last look at the whole: if a rule for the host, a url() it didn't write or a position out of the flow is in it
  // anywhere (a parse of ours that differs from the browser's), none of it is kept
  // read with its strings and its at-rules' conditions blanked: `@supports (position: sticky)` or content: "url(…)"
  // say nothing that applies (a string runs to its line's end at most, as the browser reads it; a condition stops at
  // a brace or semicolon, so one can't swallow a rule)
  const seen = out.replace(/(?<!url\()(?:"[^"\n\r\f]*"|'[^'\n\r\f]*')/g, '""').replace(/@[a-z-]+[^{};]*\{/gi, "@{");
  return /:host|::?slotted|::?part\b/i.test(seen) || FOREIGN_URL.test(seen) || PINNED_ANYWHERE.test(seen) ? "" : out;
}
function cleanRules(css: string, pic: (src: string) => string | null, depth: number): string {
  const s = plainCss(css);
  let out = "", i = 0, semi = -2, open = -2;
  while (i < s.length) {
    // the next semicolon and brace, each looked for again only once it is behind (looking each time would read the
    // sheet once a rule)
    if (semi !== -1 && semi < i) semi = s.indexOf(";", i);
    if (open !== -1 && open < i) open = s.indexOf("{", i);
    // a statement without a block ends at its semicolon, and goes: an @import, an @charset, or anything else before
    // the next rule that isn't one
    if (semi >= 0 && (open < 0 || semi < open)) { i = semi + 1; continue; }
    if (open < 0) break;
    const prelude = s.slice(i, open).trim(), end = blockEnd(s, open), body = s.slice(open + 1, end);
    i = end + 1;
    if (prelude.startsWith("@")) {
      if (KEEP_AT.test(prelude) && depth < NEST_MAX) out += `${prelude}{${cleanRules(body, pic, depth + 1)}}`;
      else if (FRAMES_AT.test(prelude)) out += `${prelude}{${frames(body, pic)}}`;
      continue;
    }
    if (!prelude || prelude.includes(ESCAPED) || /:host|::?slotted|::?part\b/i.test(prelude)) continue;
    const selector = prelude.replace(/(?<![\w.#:-])(?:html|body)(?![\w-])|:root\b/gi, ".pa-mail-doc");
    out += `${selector}{${cleanDeclarations(body, pic)}}`;
  }
  return out;
}
function frames(body: string, pic: (src: string) => string | null): string {
  let out = "", i = 0;
  while (i < body.length) {
    const open = body.indexOf("{", i);
    if (open < 0) break;
    const end = blockEnd(body, open);
    out += `${body.slice(i, open).trim()}{${cleanDeclarations(body.slice(open + 1, end), pic)}}`;
    i = end + 1;
  }
  return out;
}

const px = (v: string | null | undefined) => { const m = /^\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*$/i.exec(v ?? ""); return m ? Number(m[1]) : null; };
/** A picture there only to tell its sender the mail was opened: drawn 3 px or less, or not drawn at all. */
function tracker(img: Element): boolean {
  const style = (img.getAttribute("style") ?? "").toLowerCase();
  const decl = (name: string) => { const m = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;!]+)`).exec(style); return m ? m[1] : null; };
  const tiny = (v: number | null) => v !== null && v <= 3;
  return tiny(px(img.getAttribute("width"))) || tiny(px(img.getAttribute("height"))) || tiny(px(decl("width"))) || tiny(px(decl("height")))
    || /^\s*none\s*$/.test(decl("display") ?? "") || /^\s*hidden\s*$/.test(decl("visibility") ?? "") || /^\s*0(?:\.0*)?\s*$/.test(decl("opacity") ?? "");
}

/** What the last walk takes out whole, with what is in it. */
const NEVER_TAGS = new Set("script style template iframe frame frameset object embed applet form input button textarea select option optgroup datalist output svg math noscript noembed noframes link meta base video audio source track dialog map area portal".split(" "));
/** The tags the last walk allows (DOMPurify's HTML set, less FORBID_TAGS; details and summary are ours, for quotes). */
const ALLOWED = new Set("a abbr acronym address article aside b bdi bdo big blink blockquote br caption center cite code col colgroup data dd del details dfn dir div dl dt em figcaption figure font footer h1 h2 h3 h4 h5 h6 header hgroup hr i img ins kbd label legend li main mark marquee menu meter nav nobr ol p picture pre progress q rp rt ruby s samp section small span strike strong sub summary sup table tbody td tfoot th thead time tr tt u ul var wbr fieldset".split(" "));

/** The message's HTML, made safe (above). */
export function cleanMail(html: string, pictures: Pictures): Clean {
  const web = new Set<string>(), cids = new Set<string>();
  let hidden = 0, trackers = 0, colored = false;
  /** What a picture's address draws: its blob or data address, or null. Counts what it asked. */
  const pic = (src: string): string | null => {
    const k = kindOf(src.trim());
    if (!k) return null;
    if (k.kind === "data") return src.trim();
    if (k.kind === "cid") { cids.add(k.id); return pictures.cid?.(k.id) ?? null; }
    web.add(src.trim());
    const got = pictures.show ? pictures.web?.(src.trim()) ?? null : null;
    if (!got) hidden++;
    return got;
  };

  // its own style sheets and its <body>'s colours, read from an inert parse (nothing in it loads or runs)
  const doc = new DOMParser().parseFromString(html, "text/html");
  const sheets = Array.from(doc.querySelectorAll("style")).filter((s) => s.namespaceURI === "http://www.w3.org/1999/xhtml").map((s) => s.textContent ?? "");
  const css = cleanSheet(sheets.join("\n"), pic);
  if (COLOURS.test(css)) colored = true;
  const body = doc.body;

  // 1. purify
  const frag = purify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS, FORBID_ATTR, RETURN_DOM_FRAGMENT: true });

  // 2. finish
  for (const el of Array.from(frag.querySelectorAll("*"))) {
    if (el.tagName === "A") {
      const href = webHref(el.getAttribute("href"));
      if (href) { el.setAttribute("href", href); el.setAttribute("rel", "noreferrer"); } else el.removeAttribute("href");
    } else el.removeAttribute("href");
    if (el.tagName === "IMG") {
      const src = (el.getAttribute("src") ?? "").trim();
      el.removeAttribute("src");
      if (kindOf(src)?.kind === "web" && tracker(el)) { el.remove(); trackers++; continue; }
      const got = src ? pic(src) : null;
      // a picture that can't be drawn now is left out (its sender's CSS could show an empty one); cleaned again once
      // it is here
      if (got) el.setAttribute("src", got); else { el.remove(); continue; }
    } else el.removeAttribute("src");
    if (el.hasAttribute("background")) { const got = pic(el.getAttribute("background") ?? ""); if (got) el.setAttribute("background", got); else el.removeAttribute("background"); }
    if (el.hasAttribute("style")) {
      const style = cleanDeclarations(plainCss(el.getAttribute("style") ?? ""), pic);
      if (style) el.setAttribute("style", style); else el.removeAttribute("style");
      if (COLOURS.test(style)) colored = true;
    }
    if (el.hasAttribute("bgcolor") || (el.tagName === "FONT" && el.hasAttribute("color"))) colored = true;
  }
  foldQuotes(frag);

  // the root: a div with the <body>'s own colours (its bgcolor, text and style), as the sender drew them
  const root = document.createElement("div");
  root.className = "pa-mail-doc";
  const own: string[] = [];
  const bg = body?.getAttribute("bgcolor"), ink = body?.getAttribute("text");
  if (bg && /^#?[0-9a-z]{3,20}$/i.test(bg)) own.push(`background-color: ${bg}`);
  if (ink && /^#?[0-9a-z]{3,20}$/i.test(ink)) own.push(`color: ${ink}`);
  const bodyStyle = cleanDeclarations(plainCss(body?.getAttribute("style") ?? ""), pic);
  if (bodyStyle) own.push(bodyStyle);
  if (own.length) { root.setAttribute("style", own.join("; ")); if (COLOURS.test(root.getAttribute("style")!)) colored = true; }
  root.append(frag);

  // 3. check
  const refused = lastWalk(root);
  const out = document.createDocumentFragment();
  out.append(root);
  return { root: out, css, web: [...web], cids: [...cids], hidden, trackers, colored, refused };
}

/** The last walk: takes out any element or attribute steps 1 and 2 should have, and says how many. */
export function lastWalk(root: Element): number {
  let refused = 0;
  for (const el of Array.from(root.querySelectorAll("*"))) {
    if (!root.contains(el)) continue; // went with an element above it
    if (el.namespaceURI !== "http://www.w3.org/1999/xhtml" || NEVER_TAGS.has(el.localName)) { el.remove(); refused++; continue; }
    // one a mail has no use for (a <canvas>, a <spacer>) goes, and its words stay where they were
    if (!ALLOWED.has(el.localName)) { el.replaceWith(...Array.from(el.childNodes)); refused++; continue; }
    for (const a of Array.from(el.attributes)) {
      const v = a.value.trim();
      const bad = /^on/i.test(a.name) || NEVER_ATTR.includes(a.name)
        || (a.name === "href" && (el.localName !== "a" || !webHref(v)))
        || (a.name === "src" && (el.localName !== "img" || !/^(?:blob:|data:image\/(?:png|jpeg|gif|webp);)/i.test(v)))
        || (a.name === "background" && !/^(?:blob:|data:image\/)/i.test(v))
        || (a.name === "style" && (/url\(\s*(?!["']?(?:blob:|data:image\/))/i.test(v) || CSS_BAD.test(v)))
        || (!["href", "src", "background", "style"].includes(a.name) && /^(?:javascript|vbscript|data):/i.test(v.replace(/[\s\u0000-\u001f]/g, "")));
      if (bad) { el.removeAttribute(a.name); refused++; }
    }
  }
  return refused;
}

/** A quoted reply folds behind "Quoted text": Apple Mail's and Gmail's quote blocks (with Gmail's "On … wrote:" line
 *  before one), when the message has words of its own besides. A forwarded message isn't a quote: it shows. */
function foldQuotes(frag: DocumentFragment) {
  const QUOTE = 'blockquote[type="cite" i], blockquote.gmail_quote';
  const quotes = Array.from(frag.querySelectorAll(QUOTE)).filter((q) => !q.parentElement?.closest(QUOTE));
  if (!quotes.length) return;
  // the words outside every quote, read once: a message that is all quote is left whole
  const rest = frag.cloneNode(true) as DocumentFragment;
  for (const q of Array.from(rest.querySelectorAll(QUOTE))) q.remove();
  if (!(rest.textContent ?? "").trim()) return;
  for (const q of quotes) {
    const details = document.createElement("details");
    details.className = "pa-quote";
    const summary = document.createElement("summary");
    summary.textContent = "Quoted text";
    details.append(summary);
    const attr = q.previousElementSibling;
    q.replaceWith(details);
    if (attr && attr.classList.contains("gmail_attr") && /wrote:\s*$/.test(attr.textContent ?? "")) details.append(attr);
    details.append(q);
  }
}

/** Plain text split into what the sender wrote and the reply it quotes at its end ("On … wrote:" and the `>` lines). */
export function splitQuote(text: string): { said: string; quoted: string } {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let end = lines.length;
  while (end > 0 && !lines[end - 1].trim()) end--;
  let start = end;
  while (start > 0 && (/^\s*>/.test(lines[start - 1]) || (!lines[start - 1].trim() && start < end && /^\s*>/.test(lines[start])))) start--;
  if (start === end) return { said: text, quoted: "" };
  // the line that says who wrote it (which may wrap onto a second line) goes with the quote
  let from = start;
  for (let k = 1; k <= 2 && start - k >= 0; k++) if (/wrote:\s*$|schrieb:\s*$|a écrit\s*:\s*$|escribió:\s*$/i.test(lines[start - k])) { from = start - k; break; }
  const said = lines.slice(0, from).join("\n").trimEnd();
  if (!said.trim()) return { said: text, quoted: "" };
  return { said, quoted: lines.slice(from, end).join("\n") };
}
