// The kit is the standard library: each thing applets all need (a date, a list, a search, a toast, the type scale…)
// has one kit part, and an applet that goes around it fails this check (conformance.test.ts runs it over every applet
// this repo ships; docs/WRITE-AN-APPLET.md says the same to anyone writing one). Each rule names what it catches and the
// kit part to use instead. The check reads the code without its comments.

export type Rule = { id: string; what: string; use: string; test: RegExp };

export const RULES: readonly Rule[] = [
  // dates and times: said one way, in the person's language
  { id: "dates", what: "its own date or time formatting", use: "when (when.time, when.day, when.short, when.full, when.ago, when.stamp, when.path)",
    test: /\bIntl\s*\.\s*DateTimeFormat\b|\.toLocale(?:Date|Time)?String\s*\(|\.toDateString\s*\(|\.get(?:FullYear|Month|Date|Hours|Minutes|Seconds)\s*\(\s*\)/ },
  // the look: the theme's tokens and the type scale, never a value of its own
  { id: "colors", what: "a colour of its own", use: "the theme's colours: var(--bg), var(--surface), var(--text), var(--muted), var(--line), var(--accent), var(--danger)",
    test: /(?<![\w&$])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b(?![-\w])|\b(?:rgba?|hsla?|oklch|oklab|hwb|lab|lch)\s*\(/ },
  { id: "type", what: "a text size of its own", use: "the type scale: var(--fs-title), var(--fs-head), var(--fs-lead), var(--fs-body), var(--fs-small), var(--fs-label)",
    test: /\bfont-size\s*:(?!\s*(?:var\(--fs-|inherit\b))\s*[^\s;`"'}]|\bfont\s*:(?!\s*inherit\b)(?![^;`"'}]*var\(--fs-)\s*[^\s;`"'}]|\bfontSize\s*:|\bfont\s*:\s*["'](?!inherit["'])/ },
  { id: "fonts", what: "a font of its own", use: "var(--serif), var(--sans), var(--mono)",
    test: /\bfont-family\s*:(?!\s*(?:var\(--(?:serif|sans|mono)\)|inherit\b))|\bfontFamily\s*:/ },
  // the screen and its states
  { id: "page", what: "its own <main> or page title", use: "Page (its title, kicker, aside and pull to refresh)", test: /<(?:main|h1)[\s>]/ },
  { id: "lists", what: "a list of its own", use: "List (rows, a long list drawn only where it shows, More)", test: /<(?:ul|ol)[\s>]/ },
  { id: "loading", what: "its own reading line", use: "Loading", test: /\b(?:Reading|Loading)\b[^"'`<>{}\n]{0,40}…/ },
  { id: "problems", what: "its own error line", use: "Problem (a screen's failure, with Try again) or toast(text, { error: true }) after an action", test: /\brole\s*=\s*\{?\s*["']alert["']/ },
  { id: "status", what: "its own status line", use: "toast (after an action), Loading (while reading)", test: /\brole\s*=\s*\{?\s*["']status["']|\baria-live\b/ },
  // forms, search, buttons
  { id: "forms", what: "an input of its own", use: "Field (a line), Write (a box to write in, and its action), Search", test: /<(?:input|textarea|select)[\s>/]/ },
  { id: "search", what: "its own search box", use: "Search", test: /type\s*=\s*["']search["']/ },
  { id: "buttons", what: "its own round button", use: "Button (primary, plain, quiet; small), or a List row's badge", test: /border-radius\s*:\s*999px/ },
  // voice
  { id: "voice", what: "the recorder called itself", use: "Record (the app's own recorder sheet)", test: /\bvoice\s*\.\s*record\s*\(|\bgetUserMedia\b|\bMediaRecorder\b/ },
  { id: "transcripts", what: "the hub's transcript marker handled itself", use: "voiceNote and useTranscripts", test: /_Transcript pending\._/ },
  // links and opening notes (were src/kit/links.test.ts)
  { id: "links", what: "a link of its own", use: "Link, Linked, Note, link.open", test: /<a[\s>]|\bhref\s*=/ },
  { id: "opening", what: "the shell's link calls, or the frame moved", use: "Link, Linked, Note, link.follow, link.open",
    test: /\bapp\s*\.\s*(?:open|openLink|follow|links|address)\s*\(|\bwindow\.open\b|\blocation\s*\.\s*(?:href|assign|replace)\b/ },
  // saved state
  { id: "storage", what: "the browser's storage", use: "useSaved (a draft, where it was), storage (what it last showed)", test: /\b(?:localStorage|sessionStorage|indexedDB)\b/ },
];

/** The code without its comments (a comment may name what a rule catches). Strings and template text stay: CSS is in them. */
export const withoutComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, "")).replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

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
