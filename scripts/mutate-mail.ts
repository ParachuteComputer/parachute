// Mutation proof for the mail sanitizer (src/kit/mailClean.ts): each rule is broken once, alone, and the sanitizer's
// tests (src/kit/mailClean.test.ts, over e2e/fixtures/mail) must go red; a rule whose breaking no test notices is
// either not needed (take it out) or not tested (add the fixture that needs it). The file is put back after each.
//   npx vite-node scripts/mutate-mail.ts            every mutation; exits 1 if one survives
//   npx vite-node scripts/mutate-mail.ts tracker    only those whose name has "tracker"
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FILE = join(process.cwd(), "src/kit/mailClean.ts");
const TEST = "src/kit/mailClean.test.ts";
/** What each rule is, and the text that breaks it (the first text, found exactly once, becomes the second). */
const MUTATIONS: { name: string; from: string; to: string }[] = [
  // 1. purify
  { name: "HTML only (no SVG, no MathML)", from: "USE_PROFILES: { html: true }", to: "USE_PROFILES: { html: true, svg: true, mathMl: true }" },
  { name: "its own <style> forbidden", from: '["style", "form",', to: '["form",' },
  { name: "forms and their fields forbidden", from: '"form", "input", "button", "select", "option", "optgroup", "textarea", "datalist", "output", ', to: "" },
  { name: "media forbidden", from: '"video", "audio", "source", "track", ', to: "" },
  { name: "<template> forbidden", from: '"template", "dialog"', to: '"dialog"' },
  { name: "<dialog> forbidden", from: '"template", "dialog", "map"', to: '"template", "map"' },
  { name: "image maps forbidden", from: ', "map", "area"]', to: "]" },
  { name: "srcset forbidden", from: 'FORBID_ATTR = ["srcset", ', to: "FORBID_ATTR = [" },
  // 2. finish: links
  { name: "a link only to http, https or mailto", from: "if (!/^(?:https?:\\/\\/[^/?#\\s]|mailto:)/i.test(v) ||", to: "if (" },
  { name: "nothing hidden in a link", from: "|| /[\\u0000-\\u0020\\u007f-\\u009f\\u00ad\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u206f\\ufeff]/.test(v)", to: "" },
  { name: "an href only on a link", from: "    } else el.removeAttribute(\"href\");", to: "    }" },
  { name: "links carry no referrer", from: 'el.setAttribute("rel", "noreferrer");', to: "" },
  // 2. finish: pictures
  { name: "web pictures only when shown", from: "const got = pictures.show ? pictures.web?.(src.trim()) ?? null : null;", to: "const got = pictures.web?.(src.trim()) ?? null;" },
  { name: "tracking pixels never load", from: 'if (kindOf(src)?.kind === "web" && tracker(el))', to: "if (false)" },
  { name: "a pixel by its size", from: "const tiny = (v: number | null) => v !== null && v <= 3;", to: "const tiny = (_v: number | null) => false;" },
  { name: "a pixel by its being hidden", from: '|| /^\\s*none\\s*$/.test(decl("display") ?? "")', to: "" },
  { name: "data: pictures only PNG, JPEG, GIF, WebP", from: "const DATA_PICTURE = /^data:image\\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\\s]+$/i;", to: "const DATA_PICTURE = /^data:/i;" },
  { name: "cid: pictures from the message's parts", from: "return pictures.cid?.(k.id) ?? null;", to: "return null;" },
  { name: "a picture not drawn is left out", from: "else { el.remove(); continue; }", to: "else continue;" },
  { name: "src only on a picture", from: '    } else el.removeAttribute("src");', to: "    }" },
  { name: "a background attribute is a picture", from: 'if (el.hasAttribute("background")) {', to: "if (false) {" },
  // 2. finish: CSS
  { name: "escapes marked", from: '.replace(/\\\\(?:[0-9a-f]{1,6}\\s?|[\\s\\S])/gi, ESCAPED)', to: "" },
  { name: "a rule with an escape goes", from: "prelude.includes(ESCAPED) || ", to: "" },
  { name: "a string ends at a line break, as the browser reads it", from: 'if (s[j] === "\\n" || s[j] === "\\r" || s[j] === "\\f") return j;', to: "" },
  { name: "an unquoted url( ends at its ), as the browser reads it", from: 'if (c === "u" || c === "U") {', to: "if (false) {" },
  { name: "CSS's whitespace in url(), not JavaScript's", from: `|([^()"' \\t\\n\\r\\f]*))(?=`, to: `|([^()"'\\s]*))(?=` },
  { name: "a url() the cleaning didn't write goes with its declaration", from: " && !FOREIGN_URL.test(d)", to: "" },
  { name: "the whole sheet is looked at last", from: 'return /:host|::?slotted|::?part\\b/i.test(seen) || FOREIGN_URL.test(seen) || PINNED_ANYWHERE.test(seen) || tooDeep(seen) || /(?:^|[{};])[ \\t\\n\\r\\f]*@[\\w-]/.test(seen) ? "" : out;', to: "return out;" },
  { name: "nothing nested past 32", from: " || tooDeep(seen) ||", to: " ||" },
  { name: "a kept condition's brackets are counted", from: 'seen += `@${prelude.replace(/[^()[\\]]/g, "")}{${inner.seen}}`;', to: "seen += `@{${inner.seen}}`;" },
  { name: "no at-rule nested in a rule", from: " || /(?:^|[{};])[ \\t\\n\\r\\f]*@[\\w-]/.test(seen) ?", to: " ?" },
  { name: "a selector with a stray } goes", from: ' || blank(prelude).includes("}")', to: "" },
  { name: "a style attribute nested past 32 goes", from: 'return tooDeep(blank(style)) ? "" : style;', to: "return style;" },
  { name: "unwrapped a child at a time", from: "      while (el.firstChild) words.appendChild(el.firstChild);\n      el.replaceWith(words);", to: "      el.replaceWith(...Array.from(el.childNodes));" },
  { name: "a closer closes only its own opener", from: "const at = open.lastIndexOf(pairs[c]); if (at >= 0) open.length = at;", to: "open.pop();" },
  { name: "<!-- and --> read as nothing", from: '.replace(/<!--|-->/g, " ")', to: "" },
  { name: "url()'s unquoted address has no (", from: `|([^()"' \\t\\n\\r\\f]*))(?=`, to: `|([^)"' \\t\\n\\r\\f]*))(?=` },
  { name: "the last look's copy blanks strings", from: `out += s[i] === '"' || s[i] === "'" ? '""' : s.slice(i, end);`, to: "out += s.slice(i, end);" },
  { name: "a statement's end is found outside strings", from: "    const end = tokenEnd(s, j);\n    if (end >= 0) { j = end - 1; continue; }\n    if (s[j] === \"{\" || s[j] === \";\") return j;", to: "    if (s[j] === \"{\" || s[j] === \";\") return j;" },
  { name: "a kept at-rule's condition is plain", from: "      if (!plainCondition(prelude)) continue;\n", to: "" },
  { name: "url()'s whitespace taken whole (no backtracking)", from: "url\\((?=([ \\t\\n\\r\\f]*))\\1(?:", to: "url\\(([ \\t\\n\\r\\f]*)(?:" },
  { name: "a comment becomes a space, not nothing", from: '.replace(/\\/\\*[\\s\\S]*?(?:\\*\\/|$)/g, " ")', to: '.replace(/\\/\\*[\\s\\S]*?(?:\\*\\/|$)/g, "")' },
  { name: "a position only static, relative or absolute", from: '!["static", "relative", "absolute"].includes(', to: '["fixed", "sticky"].includes(' },
  { name: "@media nests at most 8 deep", from: "&& depth < NEST_MAX)", to: ")" },
  { name: "at most 200,000 characters of CSS", from: "  if (css.length > CSS_MAX) return \"\";\n", to: "\n" },
  { name: "a quoted url( with space before its quote", from: `if (j >= 0 && s[j] !== '"' && s[j] !== "'")`, to: "if (j >= 0)" },
  { name: "popovers forbidden", from: '"srcset", "popover", "popovertarget", "popovertargetaction", "commandfor"]', to: '"srcset"]' },
  { name: "a declaration whose string never closes goes", from: " && closed(d)).join", to: ").join" },
  { name: "url() asked", from: 'const withUrls = css.replace(URL_TOKEN,', to: "const withUrls = css; void css.replace(URL_TOKEN," },
  { name: "other loads and scripts in CSS go", from: "expression\\s*\\(|behavior\\s*:|-moz-binding|javascript:|vbscript:|(?:image-set", to: "(?:image-set" },
  { name: "image-set() and the like go", from: "|(?:image-set|image|src|cross-fade|element)\\s*\\(/i;", to: "/i;" },
  { name: "nothing pinned to the screen", from: "&& !pinned(d)", to: "" },
  { name: "@import and other blockless statements go", from: 'if (s[at] === ";") { i = at + 1; continue; }', to: 'if (s[at] === ";") { out += s.slice(i, at + 1); seen += s.slice(i, at + 1); i = at + 1; continue; }' },
  { name: "@font-face and other at-rules go", from: "      else if (FRAMES_AT.test(prelude)) {", to: "      else {" },
  { name: ":host and ::slotted rules go", from: " || /:host|::?slotted|::?part\\b/i.test(prelude)", to: "" },
  { name: "body and html mean the root", from: '.replace(/(?<![\\w.#:-])(?:html|body)(?![\\w-])|:root\\b/gi, ".pa-mail-doc")', to: "" },
  { name: "a mail with colours of its own is drawn on paper", from: "if (COLOURS.test(style)) colored = true;", to: "" },
  { name: "bgcolor and font colour are colours", from: 'if (el.hasAttribute("bgcolor") || (el.tagName === "FONT" && el.hasAttribute("color"))) colored = true;', to: "" },
  { name: "a quoted reply folds", from: "  foldQuotes(frag);\n", to: "\n" },
  // 3. the last walk
  { name: "last walk: only allowed elements", from: "if (!ALLOWED.has(el.localName)) {", to: "if (false) {" },
  { name: "last walk: dangerous elements go whole", from: ' || NEVER_TAGS.has(el.localName)) { el.remove(); refused++; continue; }', to: ") { el.remove(); refused++; continue; }" },
  { name: "last walk: only HTML's namespace", from: 'if (el.namespaceURI !== "http://www.w3.org/1999/xhtml" || NEVER_TAGS', to: 'if (NEVER_TAGS' },
  { name: "last walk: no handler", from: "const bad = /^on/i.test(a.name) || NEVER_ATTR", to: "const bad = NEVER_ATTR" },
  { name: "last walk: no forbidden attribute", from: "|| NEVER_ATTR.includes(a.name)\n", to: "\n" },
  { name: "last walk: href only a web link's", from: '|| (a.name === "href" && (el.localName !== "a" || !webHref(v)))', to: "" },
  { name: "last walk: src only a drawn picture's", from: "|| (a.name === \"src\" && (el.localName !== \"img\" ||", to: "|| (false && (el.localName !== \"img\" ||" },
  { name: "last walk: background only a drawn picture", from: '|| (a.name === "background" && !/^(?:blob:|data:image\\/)/i.test(v))', to: "" },
  { name: "last walk: style loads nothing", from: '|| (a.name === "style" && (', to: '|| (false && (' },
  { name: "last walk: no script or data value elsewhere", from: '|| (!["href", "src", "background", "style"].includes(a.name) && /^(?:javascript|vbscript|data):/i.test(', to: '|| (false && /^(?:javascript|vbscript|data):/i.test(' },
  { name: "the last walk runs", from: "  const refused = lastWalk(root);", to: "  const refused = 0;" },
];

const only = process.argv[2];
const original = readFileSync(FILE, "utf8");
const survived: string[] = [];
let ran = 0;
try {
  for (const m of MUTATIONS) {
    if (only && !m.name.includes(only)) continue;
    const n = original.split(m.from).length - 1;
    if (n !== 1) { console.error(`✗ ${m.name}: its text is in mailClean.ts ${n} times (needs exactly 1)`); survived.push(m.name); continue; }
    writeFileSync(FILE, original.replace(m.from, m.to));
    const r = spawnSync("npx", ["vitest", "run", TEST], { encoding: "utf8" });
    ran++;
    const red = r.status !== 0;
    const failed = (r.stdout + r.stderr).split("\n").filter((l) => /^\s+×/.test(l)).map((l) => l.trim().replace(/\s+\d+ms$/, ""));
    console.log(`${red ? "red  " : "GREEN"} ${m.name}${red ? `: ${failed[0] ?? "(the suite failed)"}${failed.length > 1 ? ` (+${failed.length - 1})` : ""}` : ""}`);
    if (!red) survived.push(m.name);
  }
} finally {
  writeFileSync(FILE, original);
}
console.log(`\n${ran} mutations, ${ran - survived.length} caught${survived.length ? `; survived: ${survived.join("; ")}` : ""}`);
process.exit(survived.length ? 1 : 0);
