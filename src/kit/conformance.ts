// The kit is the standard library: each thing applets all need (a date, a list, a search, a toast, the type scale…)
// has one kit part, and an applet that goes around it fails this check (conformance.test.ts runs it over every applet
// this repo ships; docs/INVENTORY.md is where each rule came from). Each rule names what it catches and the
// kit part to use instead. The check reads the code without its comments.

export type Rule = { id: string; what: string; use: string; test: RegExp };

const NAMED_COLOR = "white|black|red|green|blue|gray|grey|yellow|orange|purple|pink|brown|silver|navy|teal|maroon|olive|lime|aqua|fuchsia|gold|beige|ivory|tan|crimson|indigo|violet";
const SIZED = String.raw`[^;\x60"'}]`;
/** The properties a colour is given in: CSS, and a style object's names for them. */
const COLOR_PROPS = "color|background(?:-color)?|border(?:-[a-z]+)*|outline(?:-color)?|box-shadow|text-shadow|fill|stroke|caret-color|accent-color|text-decoration(?:-color)?|column-rule"
  + "|backgroundColor|borderColor|border(?:Top|Right|Bottom|Left)(?:Color)?|outlineColor|boxShadow|textShadow|caretColor|accentColor|textDecorationColor";

export const RULES: readonly Rule[] = [
  // dates and times: said one way, in the person's language
  { id: "dates", what: "its own date or time formatting", use: "when (when.time, when.day, when.date, when.short, when.full, when.ago, when.stamp, when.path)",
    test: new RegExp([
      String.raw`\bIntl\s*\.\s*(?:DateTimeFormat|RelativeTimeFormat)\b`,
      String.raw`\.toLocale(?:Date|Time)String\s*\(`, String.raw`\.toDateString\s*\(`,
      String.raw`\bnew Date\([^()]*(?:\([^()]*\)[^()]*)*\)\s*\.toLocaleString\s*\(`, String.raw`\.toLocaleString\s*\([^)]*\b(?:weekday|hour|minute|month|year)\b`,
      String.raw`\.get(?:FullYear|Month|Date|Day|Hours|Minutes|Seconds)\s*\(\s*\)`, String.raw`\.toISOString\s*\(\s*\)\s*\.\s*(?:slice|substring|substr)\s*\(`,
    ].join("|")) },
  // the look: the theme's tokens and the type scale, never a value of its own
  { id: "colors", what: "a colour of its own", use: "the theme's colours: var(--bg), var(--surface), var(--text), var(--muted), var(--line), var(--accent), var(--danger)",
    test: new RegExp([
      // a hex or a named colour in the value of a property that takes one (border: 1px solid #ccc), in CSS or a style
      // object; an SVG's fill or stroke; or a colour's function
      String.raw`\b(?:${COLOR_PROPS})\s*:[^;{}\n]*?(?:#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b(?![-\w])|["'\s:](?:${NAMED_COLOR})\b(?![-\w]))`,
      String.raw`\b(?:fill|stroke)\s*=\s*["'{]\s*["']?(?:#|(?:${NAMED_COLOR})\b)`,
      String.raw`\b(?:rgba?|hsla?|oklch|oklab|hwb|lab|lch)\s*\(`,
    ].join("|"), "i") },
  { id: "type", what: "a text size of its own", use: "the type scale: var(--fs-title), var(--fs-head), var(--fs-lead), var(--fs-body), var(--fs-small), var(--fs-label)",
    test: new RegExp([
      String.raw`\bfont-size\s*:(?!\s*(?:var\(--fs-|inherit\b))\s*[^\s;\x60"'}]`,
      String.raw`\bfont\s*:(?!\s*(?:inherit\b|string\b|["']inherit["']))(?!${SIZED}*var\(--fs-)\s*[^\s;\x60"'}]`,
      String.raw`\bfont(?:-size)?\s*:${SIZED}*calc\(\s*var\(--fs-`,
      String.raw`\bfontSize\s*:(?!\s*(?:string\b|["']var\(--fs-[a-z]+\)["']))`,
    ].join("|")) },
  { id: "fonts", what: "a font of its own", use: "var(--serif), var(--sans), var(--mono)",
    test: /\bfont-family\s*:(?!\s*(?:var\(--(?:serif|sans|mono)\)|inherit\b))|\bfontFamily\s*:(?!\s*(?:string\b|["']var\(--(?:serif|sans|mono)\)["']))/ },
  // the screen and its states
  { id: "page", what: "its own <main> or page title", use: "Page (its title, kicker, aside and pull to refresh)", test: /<(?:main|h1)[\s>]/ },
  { id: "lists", what: "a list of its own", use: "List (rows, a long list drawn only where it shows, More)", test: /<(?:ul|ol)[\s>]/ },
  { id: "loading", what: "its own reading line", use: "Loading", test: /(?<!<Loading[^<>]*>[^<]*)\b(?:Reading|Loading)\b[^"'`<>{}\n]{0,40}(?:…|\.\.\.)/ },
  { id: "problems", what: "its own error line", use: "Problem (a screen's failure, with Try again) or toast(text, { error: true }) after an action",
    test: /\brole\s*=\s*\{?\s*["']alert["']|className\s*=\s*\{?[^}>]*["'`](?:[\w-]+\s+)*(?:err|error)\b/ },
  { id: "status", what: "its own status line", use: "toast (after an action), Loading (while reading)", test: /\brole\s*=\s*\{?\s*["']status["']|\baria-live\b/ },
  // forms, search, buttons
  { id: "forms", what: "an input of its own", use: "Field (a line), Write (a box to write in, and its action), Search", test: /<(?:input|textarea|select)[\s>/]/ },
  { id: "search", what: "its own search box", use: "Search", test: /type\s*=\s*["']search["']/ },
  { id: "buttons", what: "a button of its own", use: "Button (primary, plain, quiet; small), a List row's onPress", test: /<button[\s>]|border-radius\s*:\s*999px/ },
  // voice
  { id: "voice", what: "the recorder called itself", use: "Record (the app's own recorder sheet)", test: /\bvoice\s*\.\s*record\s*\(|\bgetUserMedia\b|\bMediaRecorder\b/ },
  { id: "transcripts", what: "the hub's transcript marker handled itself", use: "voiceNote and useTranscripts", test: /_Transcript pending\._/ },
  // links and opening notes (were src/kit/links.test.ts)
  { id: "links", what: "a link of its own", use: "Link, Linked, Note, link.open", test: /<a[\s>]|\bhref\s*=\s*[{"']/ },
  { id: "opening", what: "the shell's note-link calls, or the frame moved", use: "Link, Linked, Note, link.follow, link.open (app.open stays for an href from app.pins or app.recent)",
    test: /\bapp\s*\.\s*(?:openLink|follow|links|address)\s*\(|\bwindow\.open\b|\blocation\s*\.\s*(?:href|assign|replace)\b/ },
  // saved state
  { id: "storage", what: "the browser's storage", use: "useSaved (a draft, where it was), storage (what it last showed)", test: /\b(?:localStorage|sessionStorage|indexedDB)\b/ },
];

/** Where a `/` starts a regular expression rather than a division: after one of these, or one of the words. */
const BEFORE_REGEX = new Set(["", "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "~", "^"]);
const WORDS_BEFORE_REGEX = new Set(["return", "typeof", "case", "in", "of", "new", "delete", "void", "throw", "yield", "await"]);
/** The code with its comments blanked (a comment may name what a rule catches), lines kept where they were. Strings,
 *  template text (CSS is in it) and regular expressions stay as they are: a `//` or `/*` inside one isn't a comment. */
export function withoutComments(src: string): string {
  let out = "", i = 0, prev = "", word = "";
  const n = src.length;
  const keep = (j: number) => { out += src.slice(i, j); i = j; };
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "/") { const end = src.indexOf("\n", i); i = end < 0 ? n : end; continue; }
    if (c === "/" && d === "*") { const end = src.indexOf("*/", i + 2), stop = end < 0 ? n : end + 2; out += src.slice(i, stop).replace(/[^\n]/g, ""); i = stop; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
      keep(Math.min(n, j + 1)); prev = c; word = ""; continue;
    }
    if (c === "`") {
      let j = i + 1, depth = 0;
      while (j < n && !(depth === 0 && src[j] === "`")) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === "$" && src[j + 1] === "{") { depth++; j += 2; continue; }
        if (depth > 0 && src[j] === "{") depth++;
        else if (depth > 0 && src[j] === "}") depth--;
        j++;
      }
      keep(Math.min(n, j + 1)); prev = "`"; word = ""; continue;
    }
    if (c === "/" && (BEFORE_REGEX.has(prev) || WORDS_BEFORE_REGEX.has(word))) {
      let j = i + 1, inClass = false;
      while (j < n && src[j] !== "\n" && (inClass || src[j] !== "/")) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === "[") inClass = true; else if (src[j] === "]") inClass = false;
        j++;
      }
      if (src[j] === "/") { j++; while (j < n && /[a-z]/i.test(src[j])) j++; keep(j); prev = "/"; word = ""; continue; }
    }
    if (/\s/.test(c)) { out += c; i++; continue; }
    if (/[\w$]/.test(c)) { let j = i; while (j < n && /[\w$]/.test(src[j])) j++; word = src.slice(i, j); prev = "w"; keep(j); continue; }
    out += c; prev = c; word = ""; i++;
  }
  return out;
}

export type Finding = { rule: string; line: number; text: string; what: string; use: string };
/** Where this code goes around the kit: each rule that fires, at the first line it does. */
export function check(src: string): Finding[] {
  const code = withoutComments(src);
  const lines = code.split("\n");
  const out: Finding[] = [];
  for (const r of RULES) {
    const i = lines.findIndex((l) => r.test.test(l));
    if (i >= 0) out.push({ rule: r.id, line: i + 1, text: lines[i].trim().slice(0, 160), what: r.what, use: r.use });
  }
  return out;
}
