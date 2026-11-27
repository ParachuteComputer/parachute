#!/usr/bin/env python3
"""A book into a Parachute vault, as records (T-476; stdlib only). The spike (appletweb/spike/epub2vault.py), hardened.

    python3 -I import_book.py SOURCE --vault library --token-file F [--hub http://127.0.0.1:1939] [--dry] [--report out.json]
    python3 -I import_book.py --job RECORD --vault library --token-file F [--hub ...] [--by NAME]
    python3 -I import_book.py --jobs --vault library --token-file F         every waiting import-book job

SOURCE is an epub, or a folder already made from one (structure.json, metadata.json, text/NN-*.md, assets/,
summaries/). --job takes a `job` record Library's Add a book left (docs/design/UPLOADS.md in the app repo): it joins
the epub from the pieces attached to it, imports it, and says on the job how it went. See README.md for what it
writes and how a second run changes nothing.
"""
import argparse, base64, calendar, hashlib, json, mimetypes, os, posixpath, re, struct, subprocess, sys, tempfile, time, urllib.error, urllib.parse, urllib.request, uuid, zipfile
from html.parser import HTMLParser
import xml.etree.ElementTree as ET

VOID = {"img", "br", "hr", "meta", "link", "input", "col", "area", "base", "wbr", "source", "image"}
BLOCK = {"p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "ul", "ol", "li", "pre", "hr", "table", "div", "section",
         "figure", "aside", "header", "footer", "body", "nav", "dl", "dt", "dd", "article", "main", "figcaption", "tr"}
SKIP_IDS = {"pg-header", "pg-footer"}  # Project Gutenberg's own header and licence: not the book


# ---------- a small DOM from html.parser (XHTML named entities break ElementTree) ----------
class Node:
    def __init__(self, tag, attrs):
        self.tag, self.attrs, self.kids = tag, dict(attrs), []

class Tree(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node("#root", []); self.stack = [self.root]
    def handle_starttag(self, tag, attrs):
        n = Node(tag.lower().split(":")[-1], attrs); self.stack[-1].kids.append(n)
        if n.tag not in VOID: self.stack.append(n)
    def handle_startendtag(self, tag, attrs):
        self.stack[-1].kids.append(Node(tag.lower().split(":")[-1], attrs))
    def handle_endtag(self, tag):
        t = tag.lower().split(":")[-1]
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == t: del self.stack[i:]; return
    def handle_data(self, d):
        self.stack[-1].kids.append(d)

def parse_html(text):
    t = Tree(); t.feed(text); t.close(); return t.root

def find(n, tag):
    if isinstance(n, str): return None
    if n.tag == tag: return n
    for k in n.kids:
        r = find(k, tag)
        if r is not None: return r
    return None

def ids_in(n):
    if isinstance(n, str): return set()
    s = {n.attrs[a] for a in ("id", "name") if n.attrs.get(a)}
    for k in n.kids: s |= ids_in(k)
    return s

def text_of(n):
    return n if isinstance(n, str) else "".join(text_of(k) for k in n.kids)


# ---------- the epub's own structure ----------
class Epub:
    def __init__(self, path):
        self.z = zipfile.ZipFile(path)
        self.inline_files = {}  # data: pictures met in the text: name -> (bytes, mime)
        c = ET.fromstring(self.z.read("META-INF/container.xml"))
        self.opf = next(e.attrib["full-path"] for e in c.iter() if e.tag.endswith("rootfile"))
        self.base = posixpath.dirname(self.opf)
        o = ET.fromstring(self.z.read(self.opf))
        q = lambda tag: [e for e in o.iter() if e.tag.split("}")[-1] == tag]
        self.meta = {}
        for e in o.iter():
            tag = e.tag.split("}")[-1]
            if "purl.org/dc" in e.tag and (e.text or "").strip():
                self.meta.setdefault(tag, []).append({"text": e.text.strip(), "id": e.attrib.get("id"), "opf_role": e.attrib.get("{http://www.idpf.org/2007/opf}role", "")})
        roles = {e.attrib["refines"].lstrip("#"): (e.text or "").strip() for e in q("meta") if e.attrib.get("property") == "role" and e.attrib.get("refines")}
        for k in ("creator", "contributor"):
            for m in self.meta.get(k, []): m["role"] = roles.get(m["id"] or "", "") or m.get("opf_role", "")
        self.manifest = {e.attrib["id"]: {"href": self.join(e.attrib["href"]), "type": e.attrib.get("media-type", ""),
                                          "props": e.attrib.get("properties", "")} for e in q("item")}
        self.spine = [self.manifest[e.attrib["idref"]]["href"] for e in q("itemref") if e.attrib["idref"] in self.manifest]
        cover = [m for m in self.manifest.values() if "cover-image" in m["props"]]
        if not cover:
            cid = next((e.attrib.get("content") for e in q("meta") if e.attrib.get("name") == "cover"), None)
            cover = [self.manifest[cid]] if cid in self.manifest else []
        self.cover = cover[0]["href"] if cover else None
        self.toc = self.read_toc()

    def join(self, href, rel_to=None):
        d = posixpath.dirname(rel_to) if rel_to else self.base
        return posixpath.normpath(posixpath.join(d, urllib.parse.unquote(href)))

    def read_toc(self):
        """[(depth, title, file, fragment)] from the epub3 nav, else the ncx."""
        nav = next((m["href"] for m in self.manifest.values() if "nav" in m["props"].split()), None)
        out = []
        if nav:
            root = parse_html(self.z.read(nav).decode("utf-8", "replace"))
            def navs(n):
                if isinstance(n, str): return []
                here = [n] if n.tag == "nav" and "toc" in (n.attrs.get("epub:type", "") + n.attrs.get("role", "")) else []
                return here + [x for k in n.kids for x in navs(k)]
            found = navs(root)
            def walk(ol, depth):
                for li in [k for k in ol.kids if not isinstance(k, str) and k.tag == "li"]:
                    a = find(li, "a")
                    if a is not None and a.attrs.get("href"):
                        f, _, frag = a.attrs["href"].partition("#")
                        out.append((depth, " ".join(text_of(a).split()), self.join(f, nav), frag or None))
                    for k in li.kids:
                        if not isinstance(k, str) and k.tag == "ol": walk(k, depth + 1)
            if found:
                ol = find(found[0], "ol")
                if ol is not None: walk(ol, 0)
        if not out:
            ncx = next((m["href"] for m in self.manifest.values() if m["type"] == "application/x-dtbncx+xml"), None)
            if ncx:
                x = ET.fromstring(self.z.read(ncx))
                def walk2(el, depth):
                    for np_ in [c for c in el if c.tag.endswith("navPoint")]:
                        label = " ".join("".join(t for t in np_.find(".//{*}navLabel/{*}text").itertext()).split())
                        f, _, frag = np_.find("{*}content").attrib["src"].partition("#")
                        out.append((depth, label, self.join(f, ncx), frag or None))
                        walk2(np_, depth + 1)
                walk2(x.find("{*}navMap"), 0)
        return out


# ---------- HTML to markdown blocks, keeping every id each block holds ----------
class Converter:
    def __init__(self, epub):
        self.e = epub
        self.noterefs = {}    # footnote target id -> number

    def is_noteref(self, a):
        href = a.attrs.get("href", "")
        if "#" not in href: return False
        t = " ".join(text_of(a).split())
        target = href.partition("#")[2]
        # a note's own link back to where it was cited is never a reference
        if "backlink" in a.attrs.get("epub:type", "") + " " + a.attrs.get("role", ""): return False
        # marked as a note by epub3: one, whatever its target is called
        if "noteref" in a.attrs.get("epub:type", ""): return True
        # a link back to a citation (Gutenberg's #FNanchor_1_1, pandoc's #fnref1, class footnote-back) isn't one
        if re.search(r"anchor|fnref|noteref|backlink", target, re.I) or re.search(r"back", a.attrs.get("class", ""), re.I): return False
        # marked by class; else a bare number counts only when its target is named like a note (a link "129" to
        # #Page_129 is a page reference, as in an index)
        if re.search(r"fnanchor|noteref|footnote", a.attrs.get("class", "")): return True
        return bool(re.fullmatch(r"\[?\*?\d{1,3}\]?|\*+|†|‡", t) and re.search(r"(^|[^a-z])(fn|note|footnote)", target, re.I))

    def inline(self, n, f):
        if isinstance(n, str): return re.sub(r"\s+", " ", n)
        t = n.tag
        if t == "br": return "\\\n"
        if t in ("img", "image"):
            src = n.attrs.get("src") or n.attrs.get("xlink:href") or n.attrs.get("href")
            if not src: return ""
            alt = n.attrs.get("alt", "").strip()
            if src.startswith("data:"):  # a picture inside the page: an attachment too, never text in the body
                head, _, b64 = src.partition(",")
                mime = head[5:].split(";")[0] or "application/octet-stream"
                try: data = base64.b64decode(b64) if ";base64" in head else urllib.parse.unquote_to_bytes(b64)
                except ValueError: return f"*(a picture here couldn't be read: {alt or 'no description'})*"
                p = f"data:{hashlib.sha256(data).hexdigest()[:16]}{mimetypes.guess_extension(mime) or ''}"
                self.e.inline_files[p] = (data, mime)
            else:
                p = self.e.join(src, f)
            return f"![{alt}](epub:{p})"
        inner = "".join(self.inline(k, f) for k in n.kids)
        if t in ("em", "i", "cite", "strong", "b") and inner.strip():
            mark = "**" if t in ("strong", "b") else "*"
            lead, trail = inner[:len(inner) - len(inner.lstrip())], inner[len(inner.rstrip()):]
            return f"{lead}{mark}{inner.strip()}{mark}{trail}"
        if t == "a":
            href = n.attrs.get("href", "")
            if self.is_noteref(n):
                fpart, _, frag = href.partition("#")
                k = self.noterefs.setdefault((self.e.join(fpart, f) if fpart else f, frag), len(self.noterefs) + 1)
                return f"[^{k}]"
            if re.match(r"https?://", href): return f"[{inner.strip()}]({href})"
            if href and inner.strip() and not re.match(r"[a-z]+:", href):
                fpart, _, frag = href.partition("#")
                # resolved once chapters have paths: a wikilink to the chapter holding the target
                return f"[{inner.strip()}](xref:{self.e.join(fpart, f) if fpart else f}#{frag})"
            return inner
        return inner

    def blocks(self, n, f, pending, out):
        """Flatten the body into blocks, each {md, ids, file}; ids on a wrapper go to its first block."""
        if isinstance(n, str): return
        t = n.tag
        own = {n.attrs[a] for a in ("id",) if n.attrs.get(a)}
        if t in ("script", "style", "head") or own & SKIP_IDS: return
        if t in BLOCK and t not in ("p", "li", "ul", "ol", "pre", "hr", "table", "tr", "dt", "dd", "figcaption") and any(
                not isinstance(k, str) and k.tag in BLOCK for k in n.kids):
            # a container of blocks: its loose inline runs become paragraphs
            pending |= own; run = []; quoted = []
            def flush():
                md = "".join(self.inline(k, f) for k in run).strip()
                rids = set().union(*[ids_in(k) for k in run]) if run else set()
                if md: out.append({"md": md, "ids": set(pending) | rids, "file": f, "tag": "p", "cls": ""}); pending.clear()
                else: pending.update(rids)  # an empty anchor between blocks (a page number) belongs to the next block
                run.clear()
            for k in n.kids:
                if isinstance(k, str) or k.tag not in BLOCK: run.append(k); continue
                flush()
                if t == "blockquote":
                    sub = []; self.blocks(k, f, pending, sub)
                    quoted.extend(sub)
                else: self.blocks(k, f, pending, out)
            flush()
            if quoted:  # one quote of several paragraphs
                out.append({"md": "\n>\n".join("\n".join("> " + ln for ln in b["md"].split("\n")) for b in quoted),
                            "ids": set().union(*[b["ids"] for b in quoted]), "file": f, "tag": "blockquote", "cls": ""})
            return
        ids = own | ids_in(n) | set(pending)
        cls = n.attrs.get("class", "")
        if t == "hr": md = "---"
        elif re.fullmatch(r"h[1-6]", t):
            # a heading is drawn bold already: emphasis around it (`<h2><em>Contents</em></h2>`) is only noise
            words = " ".join(w for w in unemph(self.inline(n, f).replace("\\\n", " ")).split() if w != "\\")
            md = "#" * min(6, int(t[1]) + 1) + " " + words if words else ""
        elif t in ("ul", "ol"):
            items = [k for k in n.kids if not isinstance(k, str) and k.tag == "li"]
            md = "\n".join(("1. " if t == "ol" else "- ") + self.inline(li, f).strip() for li in items)
        elif t == "pre": md = "```\n" + text_of(n).strip("\n") + "\n```" if text_of(n).strip() else ""
        elif t == "table":
            rows = [[" ".join(self.inline(c, f).split()) for c in r.kids if not isinstance(c, str) and c.tag in ("td", "th")] for r in self.rows(n)]
            md = "\n".join(" | ".join(r) for r in rows if any(r))
        else: md = self.inline(n, f).strip()
        md = re.sub(r"[ \t]+\n", "\n", re.sub(r"\n[ \t]+", "\n", md)).strip()
        md = re.sub(r"(?:^|\n)\\(?=\n|$)", "", md).strip()  # a line that is only a break
        md = re.sub(r"(\\\n)+$", "", md).rstrip("\\").strip()
        if md: out.append({"md": md, "ids": ids, "file": f, "tag": t, "cls": cls}); pending.clear()
        else: pending |= ids

    def rows(self, n):
        if isinstance(n, str): return []
        if n.tag == "tr": return [n]
        return [r for k in n.kids for r in self.rows(k)]


def slugless(s, n=80):
    s = re.sub(r"[/\\:#?*\"<>|\[\]]", " ", s); s = " ".join(s.split())
    return s[:n].rstrip(" .")

def roman(s):
    m = re.fullmatch(r"(?:CHAPTER|BOOK|PART)\s+([IVXLC]+)\.?", s.strip(), re.I)
    if not m: return None
    v = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100}; r = 0; prev = 0
    for ch in reversed(m.group(1).upper()):
        x = v[ch]; r = r - x if x < prev else r + x; prev = max(prev, x)
    return r


def plain(s):
    """Markdown words as plain words: a link's label or a title. A line break (`\\` + newline, a `<br/>` in the
    book) between two lines of a title becomes a dash; emphasis marks and footnote marks go."""
    s = re.sub(r"\s*\\\n\s*", " – ", s)
    s = re.sub(r"\[\^\d+\]", "", s)
    s = re.sub(r"(?<!\\)\*+", "", s)
    s = s.replace("[", "(").replace("]", ")").replace("|", "/")  # never inside a [[link|label]]
    return " ".join(s.split()).strip(" –")


def unemph(s):
    """Markdown without its emphasis marks; a link or a picture in it stays as it is."""
    return re.sub(r"(?<!\\)\*+", "", s)


def image_size(data):
    """(width, height) from a PNG's, GIF's or JPEG's header; None for anything else."""
    if data[:8] == b"\x89PNG\r\n\x1a\n" and len(data) >= 24: return struct.unpack(">II", data[16:24])
    if data[:6] in (b"GIF87a", b"GIF89a") and len(data) >= 10: return struct.unpack("<HH", data[6:10])
    if data[:2] == b"\xff\xd8":
        i = 2
        while i + 9 < len(data):
            if data[i] != 0xFF: i += 1; continue
            m = data[i + 1]
            if m in (0xD8, 0x01) or 0xD0 <= m <= 0xD7: i += 2; continue
            if 0xC0 <= m <= 0xCF and m not in (0xC4, 0xC8, 0xCC):
                h, w = struct.unpack(">HH", data[i + 5:i + 9]); return (w, h)
            i += 2 + struct.unpack(">H", data[i + 2:i + 4])[0]
    return None


GENERIC_ALT = re.compile(r"(image|img|picture|figure|ornament|decoration|divider|separator|flourish|\*+|-+)?", re.I)
ORNAMENT_SIDE = 64       # a picture no larger than this, with no words of its own, is an ornament
ORNAMENT_REPEATS = 3     # the same picture this often in one book, with no words of its own or small, is an ornament
ORNAMENT_REPEAT_SIDE = 200  # (a repeated map with its own words, or a large one, stays)
SPLIT_WORDS = 6000       # a chapter longer than this is cut at its verses, when it has them
PIECE_WORDS = 2500       # into pieces of about this many words
VERSE = re.compile(r"\*\*(\d{1,3})\.\s+\S|(\d{1,3})\.\s+\S")
FRONT_NAMES = re.compile(r"(half[- ])?title( page)?|copyright( page)?|dedication|epigraph|colophon|about the publisher|"
                         r"(other |also )?books by\b.*|also by\b.*|by the same (author|translator)\b.*", re.I)
KEEP_NAMES = re.compile(r"(table of )?contents|foreword|preface|introduction|prologue|invocation", re.I)
MAIN_START = re.compile(r"(chapter|book|part|canto|section)\s+(\d+|[ivxlc]+|one|first)\b|\d+\.?\s|[ivxlc]+\.\s", re.I)


def words_in(blocks): return sum(len(re.findall(r"\w+", b["md"])) for b in blocks)


def verse_starts(blocks):
    """Indices of the blocks that open a numbered verse (`**12. …**`, or a paragraph `12. …`), when the chapter
    clearly runs on them: at least eight, from 1 or 2, almost all one after the other. Else []."""
    hits = []
    for i, b in enumerate(blocks):
        m = VERSE.match(b["md"])
        if m and (m.group(1) or b["tag"] == "p"): hits.append((i, int(m.group(1) or m.group(2))))
    if len(hits) < 8 or hits[0][1] > 2: return []
    steps = sum(1 for (_, a), (_, b) in zip(hits, hits[1:]) if b == a + 1)
    return [i for i, _ in hits] if steps >= 0.8 * (len(hits) - 1) else []


def split_at_verses(c):
    """A long chapter as itself (what comes before its first verse) and its pieces, each a run of whole verses; or
    None when it is short or has no clear verses."""
    starts = verse_starts(c["blocks"])
    if words_in(c["blocks"]) <= SPLIT_WORDS or not starts: return None
    bounds = starts + [len(c["blocks"])]
    units = [c["blocks"][a:b] for a, b in zip(bounds, bounds[1:])]
    pieces, cur = [], []
    for u in units:
        if cur and words_in([b for x in cur for b in x]) + words_in(u) > PIECE_WORDS: pieces.append(cur); cur = []
        cur.append(u)
    pieces.append(cur)
    num = lambda u: int(next(g for g in VERSE.match(u[0]["md"]).groups() if g))
    kids = []
    for p in pieces:
        a, b = num(p[0]), num(p[-1])
        blocks = [x for u in p for x in u]
        cited = set(re.findall(r"\[\^(\d+)\]", "\n".join(x["md"] for x in blocks)))
        kids.append({"label": f"Verses {a}–{b}" if a != b else f"Verse {a}", "depth": c["depth"] + 1, "blocks": blocks,
                     "notes": [d for d in c["notes"] if re.match(r"\[\^(\d+)\]", d).group(1) in cited], "gave": 0})
    given = {d for k in kids for d in k["notes"]}
    c = {**c, "blocks": c["blocks"][:starts[0]], "notes": [d for d in c["notes"] if d not in given]}
    return [c] + kids


def same_words(heading, label):
    """True when a heading says nothing its chapter's title doesn't."""
    words = lambda s: re.findall(r"\w+", s.lower())
    h = words(heading.lstrip("#"))
    return bool(h) and set(h) <= set(words(label))



# ---------- one book, whichever way it came in ----------
#
# book = {title, title_full, author, translator, language, source, rights, publisher, year, cover (sha or None),
#         files {sha: (name, bytes, mime)}, chapters [...], summaries [...], hard [...]}
# chapter = {key, label, depth, part (key or None), body, words, kind}; summary = {key, label, of (key or "book"), body, made}
# A body holds pictures as `](file:<sha>)` and links as `[[chap:<key>|text]]`, `[[sum:<key>|text]]`, `[[book|text]]`;
# the writer turns them into storage paths and record paths.

FILE_MAX = 25 * 1024 * 1024      # the Notion import's limits hold here too
FILES_MAX = 150 * 1024 * 1024
TAKEN_MIMES = ("image/png", "image/jpeg", "image/gif", "image/webp")


def sha(data): return hashlib.sha256(data).hexdigest()


def label_of(s):
    """A title as a path segment: 'Section 1: How did we get here?' -> 'Section 1 – How did we get here'."""
    return slugless(re.sub(r"\s*:\s+", " – ", s), 90)


def add_file(book, name, data, mime):
    """A picture into the book's files, or None (and said) when the vault can't take it."""
    mime = mime or mimetypes.guess_type(name)[0] or "application/octet-stream"
    if mime not in TAKEN_MIMES:
        book["hard"].append(f"{name} is {mime}, which the vault doesn't take as a picture; left out with a line saying so")
        return None
    if len(data) > FILE_MAX:
        book["hard"].append(f"{name} is over 25 MB; left out")
        return None
    k = sha(data)
    book["files"].setdefault(k, (posixpath.basename(name), data, mime))
    return k


def drm_locked(z):
    """True when the epub's text is encrypted (a store's DRM), not just its fonts obfuscated."""
    if "META-INF/encryption.xml" not in z.namelist(): return False
    x = ET.fromstring(z.read("META-INF/encryption.xml"))
    fonts = ("http://www.idpf.org/2008/embedding", "http://ns.adobe.com/pdf/enc#RC")
    for ed in [e for e in x.iter() if e.tag.endswith("EncryptedData")]:
        alg = next((m.attrib.get("Algorithm", "") for m in ed.iter() if m.tag.endswith("EncryptionMethod")), "")
        uri = next((c.attrib.get("URI", "") for c in ed.iter() if c.tag.endswith("CipherReference")), "")
        if alg not in fonts and not re.search(r"\.(otf|ttf|woff2?)$", uri, re.I): return True
    return False


EPUB_PIC = re.compile(r"!\[([^\]]*)\]\(epub:([^)]+)\)")


def drop_ornaments(e, blocks, hard):
    """Ornaments out of the text: a picture the book repeats (one before every verse), or a tiny one with no words of
    its own (a flourish). A block left empty stays, empty, for the anchors it holds."""
    def data(p):
        if p in e.inline_files: return e.inline_files[p][0]
        try: return e.z.read(p)
        except KeyError: return None
    shas, uses = {}, {}
    for b in blocks:
        for _, p in EPUB_PIC.findall(b["md"]):
            if p not in shas:
                d = data(p); shas[p] = sha(d) if d is not None else None
                if d is not None and shas[p] not in uses: uses[shas[p]] = [0, image_size(d)]
            if shas[p]: uses[shas[p]][0] += 1
    def ornament(alt, p):
        k = shas.get(p)
        if not k: return False
        n, size = uses[k]
        no_words = GENERIC_ALT.fullmatch(alt.strip()) or alt.strip() == posixpath.basename(p)
        if n >= ORNAMENT_REPEATS and (no_words or (size and max(size) <= ORNAMENT_REPEAT_SIDE)): return True
        return bool(no_words and size and max(size) <= ORNAMENT_SIDE)
    gone = 0
    for b in blocks:
        def one(m):
            nonlocal gone
            if not ornament(m.group(1), m.group(2)): return m.group(0)
            gone += 1; return ""
        md = EPUB_PIC.sub(one, b["md"])
        if md != b["md"]: b["md"] = re.sub(r"(?:^|\n)\\(?=\n|$)", "", md).strip().rstrip("\\").strip()
    if gone: hard.append(f"{gone} ornament pictures (repeated, or tiny with no words of their own) left out")


def read_epub(path, split_depth=None):
    e = Epub(path)
    if drm_locked(e.z):
        raise SystemExit("This epub is locked (DRM): its text is encrypted, so nothing was written. "
                         "Only DRM-free epubs can be imported.")
    hard = []
    title_full = e.meta["title"][0]["text"]
    title = slugless(re.split(r"[:;]|\s+or,?\s+|\.\s", title_full)[0])
    people = e.meta.get("creator", []) + e.meta.get("contributor", [])
    author = ", ".join(p["text"] for p in people if p.get("role") in ("aut", "")) or None
    translator = ", ".join(p["text"] for p in people if p.get("role") == "trl") or None
    first = lambda k: (e.meta.get(k) or [{}])[0].get("text")
    book = {"title": title, "title_full": title_full, "author": author, "translator": translator,
            "language": first("language"), "source": first("identifier"), "rights": first("rights"),
            "publisher": first("publisher"), "year": (first("date") or "")[:4] or None,
            "cover": None, "files": {}, "chapters": [], "summaries": [], "hard": hard}

    conv = Converter(e); blocks = []
    for f in e.spine:
        if not f.endswith((".xhtml", ".html", ".htm")): continue
        root = parse_html(e.z.read(f).decode("utf-8", "replace"))
        body = find(root, "body") or root
        before = len(blocks); conv.blocks(body, f, set(), blocks)
        # the cover's own page (a picture and nothing else) is the book record's cover, not text
        if e.cover and len(blocks) > before and all(b["md"].startswith(f"![](epub:{e.cover})") and len(b["md"]) < 200
                                                    or re.fullmatch(rf"!\[[^\]]*\]\(epub:{re.escape(e.cover)}\)", b["md"])
                                                    for b in blocks[before:]):
            ids = set().union(*[b["ids"] for b in blocks[before:]])
            del blocks[before:]
            blocks.append({"md": "", "ids": ids, "file": f, "tag": "p", "cls": "", "empty": True})

    drop_ornaments(e, blocks, hard)

    toc = [x for x in e.toc if not re.search(r"project gutenberg", x[1], re.I)]
    if len(toc) < len(e.toc): hard.append("Project Gutenberg's licence and header left out.")
    if not toc:  # no contents at all: a chapter per spine file
        toc = [(0, f"Part {i + 1}", f, None) for i, f in enumerate(dict.fromkeys(b["file"] for b in blocks))]
        hard.append("The epub has no contents; one record per file in reading order.")
    if split_depth is None:
        # chapters under parts: cut at the chapters, unless the second level is a cookbook's recipes (hundreds)
        nested = any(d == 1 for d, *_ in toc)
        split_depth = 1 if nested and sum(1 for d, *_ in toc if d <= 1) <= 150 else 0
    starts = []
    for depth, label, f, frag in [x for x in toc if x[0] <= split_depth]:
        i = next((i for i, b in enumerate(blocks) if b["file"] == f and (frag is None or frag in b["ids"])), None)
        if i is None: hard.append(f"contents entry {label!r} points at {f}#{frag}, which no block holds"); continue
        starts.append((i, depth, label))
    starts.sort(key=lambda s: s[0])
    merged = []
    for s in starts:
        if merged and merged[-1][0] == s[0]: continue
        merged.append(s)
    chapters = []
    if merged and merged[0][0] > 0: merged.insert(0, (0, 0, "Front matter"))
    if not merged: merged = [(0, 0, title)]
    for k, (i, depth, label) in enumerate(merged):
        j = merged[k + 1][0] if k + 1 < len(merged) else len(blocks)
        chapters.append({"label": label, "depth": depth, "blocks": blocks[i:j]})
    first_real = next((k for k, c in enumerate(chapters) if sum(len(b["md"]) for b in c["blocks"]) >= 1000
                       and not re.fullmatch(r"(table of )?contents|front matter", c["label"], re.I)), 0)
    front = [c for c in chapters[:first_real] if not roman(c["label"])]
    if front:
        fm = {"label": "Front matter", "depth": 0, "blocks": [b for c in front for b in c["blocks"]]}
        chapters = [fm] + [c for c in chapters if c not in front]
    # short front matter after a long piece (a foreword before the dedication), up to the book's first part or numbered
    # chapter, joins it: a copyright page or a "Books by" is not a chapter to read
    for c in chapters: c["blocks"] = [b for b in c["blocks"] if b["md"]]
    # the main text starts at the first part or numbered chapter, else at the first long piece (on this list, after the
    # merge above)
    main = next((k for k, c in enumerate(chapters) if roman(c["label"]) or MAIN_START.match(c["label"])
                 or (k + 1 < len(chapters) and chapters[k + 1]["depth"] > c["depth"])), None)
    if main is None:
        main = next((k for k, c in enumerate(chapters) if sum(len(b["md"]) for b in c["blocks"]) >= 1000
                     and not re.fullmatch(r"(table of )?contents|front matter", c["label"], re.I)), 0)
    fold = [c for c in chapters[:main] if c["label"] != "Front matter" and not KEEP_NAMES.fullmatch(c["label"].strip())
            and (FRONT_NAMES.fullmatch(c["label"].strip()) or words_in(c["blocks"]) < 200)]
    if fold:
        fm = next((c for c in chapters if c["label"] == "Front matter"), None)
        if fm is None:
            fm = {"label": "Front matter", "depth": 0, "blocks": []}
            chapters.insert(0, fm)
        at = chapters.index(fm)
        joined = sorted([fm] + fold, key=lambda c: chapters.index(c))
        fm["blocks"] = [b for c in joined for b in c["blocks"]]
        chapters = [c for c in chapters if c not in fold]
        chapters.remove(fm); chapters.insert(min(at, len(chapters)), fm)
    # a printed index is left out: search does its work, and its page links make it the biggest record in a book
    index = [c for c in chapters if re.fullmatch(r"(general )?index", c["label"].strip(), re.I)]
    if index:
        chapters = [c for c in chapters if c not in index]
        hard.append("The printed index is left out (search does its work).")
    chapters = [c for c in chapters if c["blocks"]]

    # footnote bodies move to the end of the chapter that cites them
    notes = conv.noterefs
    for c in chapters:
        keep, defs = [], []
        for b in c["blocks"]:
            hit = sorted(notes[(b["file"], i)] for i in b["ids"] if (b["file"], i) in notes)
            if hit:
                body = re.sub(r"^(?:\[\^?\d+\]|\d+\.)\s+", "", b["md"])
                defs.extend(f"[^{n}]: {body}" for n in hit)
            else: keep.append(b)
        c["gave"] = len(c["blocks"]) - len(keep)
        c["blocks"] = keep; c["notes"] = defs
    cited = {}
    for c in chapters:
        for b in c["blocks"]:
            for m in re.findall(r"\[\^(\d+)\]", b["md"]): cited[int(m)] = c
    for c in chapters:
        stay = []
        for d in c["notes"]:
            n = int(re.match(r"\[\^(\d+)\]", d).group(1))
            if cited.get(n) not in (None, c): cited[n]["notes"].append(d)
            else: stay.append(d)
        c["notes"] = stay
    # a notes page whose notes all went to their chapters: only its heading is left, so it goes
    chapters = [c for c in chapters if c["notes"] or not c["gave"] or any(not b["md"].startswith("#") for b in c["blocks"])]

    # a long chapter that runs on numbered verses: itself (its opening) and its verses, a few thousand words a piece
    cut = []
    for c in chapters:
        pieces = split_at_verses(c)
        if pieces:
            hard.append(f"{c['label']} is {words_in(c['blocks']):,} words; cut at its verses into {len(pieces) - 1} parts")
        cut.extend(pieces or [c])
    chapters = cut

    # keys, parts (the nearest shallower entry), internal links to the chapter that holds their target
    where = {}
    for n, c in enumerate(chapters):
        c["key"] = f"c{n}"
        for b in c["blocks"]:
            for i in b["ids"] | {""}: where.setdefault((b["file"], i), c["key"])
    parents = {}
    for c in chapters:
        parents[c["depth"]] = c["key"]
        for d in [d for d in parents if d > c["depth"]]: del parents[d]
        up = [d for d in parents if d < c["depth"]]
        c["part"] = parents[max(up)] if up else None
    has_kids = {c["part"] for c in chapters if c["part"]}

    def picture(m):
        alt, p = m.group(1), m.group(2)
        if p in e.inline_files: data, mime = e.inline_files[p]
        else:
            try: data = e.z.read(p)
            except KeyError: hard.append(f"picture {p} is named but not in the epub"); return f"*({alt or 'a picture'}: missing from the epub)*"
            mime = mimetypes.guess_type(p)[0]
        k = add_file(book, p, data, mime)
        return f"![{alt}](file:{k})" if k else f"*(a picture here was left out: {alt or posixpath.basename(p)})*"

    def xref(m, here):
        f, _, frag = m.group(2).partition("#"); to = where.get((f, frag)) or where.get((f, ""))
        return f"[[chap:{to}|{plain(m.group(1))}]]" if to and to != here else plain(m.group(1))

    for c in chapters:
        label = plain(c["label"])
        blocks = c["blocks"]
        while len(blocks) > 1 and blocks[0]["md"].startswith("#") and same_words(blocks[0]["md"], label): blocks = blocks[1:]
        body = "\n\n".join(b["md"] for b in blocks)
        if c["notes"]: body += "\n\n---\n\n" + "\n".join(c["notes"])
        body = re.sub(r"\[([^\]]*)\]\(xref:([^)]+)\)", lambda m: xref(m, c["key"]), body)
        body = re.sub(r"!\[([^\]]*)\]\(epub:([^)]+)\)", picture, body)
        if label.isupper():
            label = " ".join(w if re.fullmatch(r"[IVXLC]+\.?", w) else w.capitalize() for w in label.split())
        book["chapters"].append({"key": c["key"], "label": label_of(label), "depth": c["depth"], "part": c["part"],
                                 "kind": "part" if c["key"] in has_kids else "chapter", "body": body,
                                 "words": len(re.findall(r"\w+", body))})
    if e.cover:
        try: book["cover"] = add_file(book, e.cover, e.z.read(e.cover), mimetypes.guess_type(e.cover)[0])
        except KeyError: hard.append("the cover named in the package isn't in the epub")
    return book


# ---------- a folder already made from an epub (structure.json, metadata.json, text/, assets/, summaries/) ----------
ANCHOR = re.compile(r'<a id="b\d+"></a><!-- block \d+; page [^>]*? -->\n?')
MD_LINK = re.compile(r"(!?)\[([^\]]*)\]\(([^)\s]+)\)")


def read_folder(root, by="Uni"):
    root = os.path.abspath(root)
    j = lambda *p: os.path.join(root, *p)
    meta = json.load(open(j("metadata.json")))
    structure = json.load(open(j("structure.json")))
    hard = []
    first = lambda k: (meta.get(k) or [None])[0]
    title_full = first("title")
    title = slugless(re.split(r"[:;]", title_full)[0])
    isbn = next((s for s in meta.get("source", []) if re.fullmatch(r"97[89]\d{10}", s or "")), None)
    book = {"title": title, "title_full": title_full, "author": ", ".join(meta.get("creator", [])) or None,
            "translator": None, "language": first("language"), "source": f"ISBN {isbn}" if isbn else first("source"),
            "rights": first("rights"), "publisher": first("publisher"), "year": (first("date") or "")[:4] or None,
            "cover": None, "files": {}, "chapters": [], "summaries": [], "hard": hard}

    def blocks_of(rel):
        """The file's own blocks, in order, and its pictures [(alt, path)] from its artwork section."""
        t = open(j(rel), encoding="utf-8").read()
        t, _, art = t.partition("\n## Source artwork")
        parts = ANCHOR.split(t)
        out = [b.strip() for b in parts[1:] if b.strip()] if len(parts) > 1 else [b.strip() for b in t.split("\n\n")[1:] if b.strip()]
        pics = [(m.group(2), m.group(3)) for m in MD_LINK.finditer(art) if m.group(1)]
        return out, pics

    def place(blocks, pics, rel):
        """Each picture where the book had it: in place of its description, else just above its figure's caption."""
        files = []
        for alt, p in pics:
            fp = os.path.normpath(os.path.join(os.path.dirname(j(rel)), p))
            if not fp.startswith(root + os.sep) or not os.path.isfile(fp):
                hard.append(f"{rel}: picture {p} is missing"); files.append((alt, None)); continue
            files.append((alt, add_file(book, os.path.basename(fp), open(fp, "rb").read(), mimetypes.guess_type(fp)[0])))
        md = lambda alt, k: f"![{alt}](file:{k})" if k else f"*(a picture here was left out: {alt})*"
        desc = [i for i, b in enumerate(blocks) if re.fullmatch(r"\[Image description: .*\]", b, re.S)]
        figs = [i for i, b in enumerate(blocks) if re.match(r"Figure \d+[:.]", b)]
        if files and len(desc) == len(files):
            for i, (alt, k) in zip(desc, files):
                blocks[i] = md(blocks[i][len("[Image description: "):-1].strip(), k)
        elif files and len(figs) == len(files):
            for i, (alt, k) in reversed(list(zip(figs, files))): blocks.insert(i, md(alt, k))
        elif files:
            hard.append(f"{rel}: {len(files)} pictures without a clear place; put at the end")
            blocks.extend(md(alt, k) for alt, k in files)
        return blocks, [k for _, k in files if k]

    # the book's notes, by the chapter they belong to
    notes, note_entry = {}, None
    for s in structure:
        if s["kind"] == "matter" and re.fullmatch(r"(end)?notes", s["title"].strip(), re.I):
            note_entry = s
            cur = None
            for b in blocks_of(s["file"])[0]:
                h = re.fullmatch(r"#+\s+(.*)", b)
                if h:
                    name = h.group(1).strip().upper()
                    if name in ("ENDNOTES", "NOTES"): continue
                    m = re.fullmatch(r"CHAPTER (\d+)", name)
                    cur = int(m.group(1)) if m else name.lower()
                    notes.setdefault(cur, []); continue
                m = re.fullmatch(r"BACK TO NOTE REFERENCE (\d+)", b)
                if m and cur is not None and notes[cur]:
                    notes[cur][-1] = (int(m.group(1)), notes[cur][-1]); continue
                notes.setdefault(cur, []).append(b)

    front, recs = [], []
    for s in structure:
        if s is note_entry: continue
        blocks, pics = blocks_of(s["file"])
        if s["title"].strip().lower() == "cover":
            pics_k = place(list(blocks), pics, s["file"])[1]
            book["cover"] = pics_k[0] if pics_k else None
            continue
        blocks, _ = place(blocks, pics, s["file"])
        if s["kind"] == "matter" and s["matter"] == "front":
            front.append((s, blocks)); continue
        recs.append((s, blocks))

    chapters = []
    if front:
        chapters.append({"key": "front", "label": "Front matter", "depth": 0, "part": None, "kind": "front",
                         "body": "\n\n---\n\n".join("\n\n".join(b) for _, b in front),
                         "words": sum(s["word_count"] for s, _ in front), "files": [s["file"] for s, _ in front]})
    part_key = {}
    for s, blocks in recs:
        key = os.path.splitext(os.path.basename(s["file"]))[0]
        if s["kind"] == "part": part_key[s["part"] or s["title"]] = key
        label = (f"Chapter {s['chapter_no']} – {s['title']}" if s.get("chapter_no") else s["title"])
        nk = s["chapter_no"] if s.get("chapter_no") else s["kind"] if s["kind"] in ("introduction", "epilogue") else None
        body = "\n\n".join(blocks)
        if nk in notes:
            # the text cites a note as [7]: a footnote now, its words at the chapter's end
            ns = notes.pop(nk)
            nums = {n[0] for n in ns if isinstance(n, tuple)}
            body = re.sub(r"\[(\d{1,3})\]", lambda m: f"[^{m.group(1)}]" if int(m.group(1)) in nums else m.group(0), body)
            body += "\n\n## Notes\n\n" + "\n\n".join(f"[^{n[0]}]: {n[1]}" if isinstance(n, tuple) else n for n in ns)
        in_part = s["kind"] != "part" and s.get("part")
        chapters.append({"key": key, "label": label_of(label), "depth": 1 if in_part else 0,
                         "part": part_key.get(s["part"]) if in_part else None,
                         "kind": s["kind"], "body": body, "words": s["word_count"], "files": [s["file"]]})
    if notes:
        left = {k: v for k, v in notes.items() if v}
        if left:
            hard.append(f"notes for {sorted(map(str, left))} match no chapter; kept in a Notes record")
            chapters.append({"key": "notes", "label": "Notes", "depth": 0, "part": None, "kind": "back",
                             "body": "\n\n".join(f"## {k}\n\n" + "\n\n".join(f"{n[0]}. {n[1]}" if isinstance(n, tuple) else n for n in v)
                                                   for k, v in left.items()),
                             "words": 0, "files": [note_entry["file"]]})
    book["chapters"] = chapters

    # links from the guides: a text file -> its chapter, a guide -> its summary, the maps -> the book
    by_file = {f: c["key"] for c in chapters for f in c.get("files", [])}
    sums = []
    if os.path.isdir(j("summaries")):
        for name in sorted(os.listdir(j("summaries"))):
            if not name.endswith(".md"): continue
            m = re.fullmatch(r"part-(\d+)\.md", name)
            if m:
                parts = [c for c in chapters if c["kind"] == "part"]
                n = int(m.group(1))
                if not 0 < n <= len(parts): hard.append(f"summaries/{name} matches no part"); continue
                of = parts[n - 1]["key"]
            else:
                of = by_file.get(f"text/{name}")
                if not of: hard.append(f"summaries/{name} matches no chapter"); continue
            label = next(c["label"] for c in chapters if c["key"] == of)
            sums.append({"key": f"summaries/{name}", "label": label, "of": of, "file": f"summaries/{name}"})
    for name, label in (("book-summary.md", "The whole book"), ("reading-paths.md", "Reading paths")):
        if os.path.isfile(j(name)): sums.append({"key": name, "label": label, "of": "book", "file": name})
    sum_key = {s["file"]: s["key"] for s in sums}

    def link(m, rel):
        bang, text, href = m.groups()
        if bang or re.match(r"[a-z]+:", href): return m.group(0)
        target = os.path.normpath(os.path.join(os.path.dirname(rel), urllib.parse.unquote(href.partition("#")[0])))
        if target in by_file: return f"[[chap:{by_file[target]}|{text}]]"
        if target in sum_key: return f"[[sum:{sum_key[target]}|{text}]]"
        if target in ("structure.md", "README.md"): return f"[[book|{text}]]"
        return text

    for s in sums:
        body = open(j(s["file"]), encoding="utf-8").read()
        body = MD_LINK.sub(lambda m: link(m, s["file"]), body).strip()
        # a guide opens with where it came from ("Source: … All factual assertions report…"): that goes last, so
        # the summary itself comes first (and is what a reader's preview shows)
        paras = body.split("\n\n")
        i = 1 if paras and paras[0].startswith("# ") else 0
        if len(paras) > i + 1 and paras[i].startswith("Source:"):
            src = paras.pop(i)
            body = "\n\n".join(paras) + "\n\n---\n\n" + src
        s["body"] = body + "\n"
        s["made"] = made_on(root, s["file"])
        s["by"] = by
    book["summaries"] = sums
    return book


def made_on(root, rel):
    """When a guide was written: its last commit in the folder's own git, else the file's date."""
    try:
        r = subprocess.run(["git", "-C", root, "log", "-1", "--format=%cs", "--", rel], capture_output=True, text=True, timeout=20)
        if r.returncode == 0 and r.stdout.strip(): return r.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        pass
    return time.strftime("%Y-%m-%d", time.localtime(os.path.getmtime(os.path.join(root, rel))))


# ---------- the Library pack's types: src/kit/packs/library.json in the app, word for word (keep the two the same) ----------
TYPES = {
    "book": ("A book you want to read, are reading, or have read. One you own can hold its chapters in its folder.", {
        "author": {"type": "string"},
        "translator": {"type": "string"},
        "language": {"type": "string"},
        "kind": {"type": "string", "enum": ["book", "scripture", "cookbook", "method"]},
        "status": {"type": "string", "enum": ["want to read", "reading", "read"], "default": "want to read"},
        "rating": {"type": "number"},
        "finished": {"type": "date"},
        "source": {"type": "string"},
        "rights": {"type": "string"},
        "at": {"type": "string", "description": "Where you stopped: the chapter and its paragraph."},
    }),
    "chapter": ("A chapter or part of a book, as the book divides it. Its text is the body.", {
        "book": {"type": "reference", "cardinality": "one"},
        "part": {"type": "reference", "cardinality": "one", "description": "The part it sits in, itself a chapter record."},
        "order": {"type": "integer"},
        "words": {"type": "integer"},
    }),
    "quote": ("Words you marked in a book, with your note. It says where they are, so they can be found again.", {
        "from": {"type": "reference", "cardinality": "one", "description": "The chapter the words are in."},
        "book": {"type": "reference", "cardinality": "one"},
        "block": {"type": "integer", "description": "The paragraph's number in the chapter."},
        "before": {"type": "string", "description": "A few words just before, to find the place again."},
        "after": {"type": "string", "description": "A few words just after."},
        "by": {"type": "string"},
        "used_in": {"type": "array", "description": "The addresses of the pieces it went into."},
    }),
    "summary": ("A summary of a chapter, a part or a whole book, beside it, never inside it. It says who wrote it.", {
        "of": {"type": "reference", "cardinality": "one"},
        "sources": {"type": "reference", "cardinality": "many"},
        "by": {"type": "string"},
        "made": {"type": "date"},
    }),
}



# ---------- what the vault should hold ----------
BODY_MAX = 400_000  # an applet's folder door writes 500 KB a body: a longer chapter is cut into parts


def plan(book):
    """[{path, types, fields, body, files}], in writing order: the book, its chapters, their summaries."""
    folder = f"Books/{book['title']}"
    chs = book["chapters"]
    pad = max(2, len(str(len(chs))))
    path = {c["key"]: f"{folder}/{str(n).zfill(pad)} {c['label']}" for n, c in enumerate(chs)}
    spath = {}
    for s in book["summaries"]:
        n = next((i for i, c in enumerate(chs) if c["key"] == s["of"]), None)
        spath[s["key"]] = f"{folder}/Summaries/" + (f"{str(n).zfill(pad)} {s['label']}" if n is not None else s["label"])
    label = {c["key"]: c["label"] for c in chs}

    def links(body):
        def one(m):
            kind, key, text = m.group(1), m.group(2), m.group(3)
            to = folder if kind == "book" else (path if kind == "chap" else spath).get(key)
            text = plain(text or "")
            if not to: return text or key
            return f"[[{to}|{text}]]" if text else f"[[{to}]]"
        return re.sub(r"\[\[(chap|sum|book):?([^\]|]*)(?:\|([^\]]*))?\]\]", one, body)

    def files_in(body): return list(dict.fromkeys(re.findall(r"\]\(file:([0-9a-f]{64})\)", body)))

    out = []
    head = f"# {book['title_full']}\n\n"
    if book["cover"]: head += f"![Cover](file:{book['cover']})\n\n"
    by = ", ".join(x for x in [book["author"] and f"By {book['author']}",
                               book["translator"] and f"translated by {book['translator']}"] if x)
    pub = ", ".join(x for x in [book["publisher"], book["year"]] if x)
    if by or pub: head += ". ".join(x for x in [by, pub] if x) + ".\n\n"
    contents = "\n".join(f"{'  ' * c['depth']}- [[{path[c['key']]}|{c['label']}]]" for c in chs)
    tail = ""
    whole = [s for s in book["summaries"] if s["of"] == "book"]
    if whole: tail = "\n\n## About the book\n\n" + "\n".join(f"- [[{spath[s['key']]}|{s['label']}]]" for s in whole)
    body = head + "## Contents\n\n" + contents + tail + "\n"
    fields = {k: v for k, v in {"author": book["author"], "translator": book["translator"], "language": book["language"],
                                "kind": "book", "source": book["source"], "rights": book["rights"]}.items() if v}
    out.append({"path": folder, "types": ["book"], "fields": fields, "body": body, "files": files_in(body)})

    for n, c in enumerate(chs):
        p = path[c["key"]]
        body = links(c["body"])
        fields = {"book": folder, "order": n, "words": c["words"], **({"part": path[c["part"]]} if c.get("part") else {})}
        pieces = [body]
        if len(body.encode()) > BODY_MAX:
            book["hard"].append(f"{p} is {len(body.encode()) // 1000} KB; cut at paragraph breaks into parts")
            pieces, cur = [], ""
            for para in body.split("\n\n"):
                if cur and len((cur + para).encode()) > BODY_MAX: pieces.append(cur); cur = ""
                cur += para + "\n\n"
            pieces.append(cur)
        for i, piece in enumerate(pieces):
            pp = p if i == 0 else f"{p} ({i + 1} of {len(pieces)})"
            more = f"\n\nContinued in [[{p} ({i + 2} of {len(pieces)})]]." if i + 1 < len(pieces) else ""
            out.append({"path": pp, "types": ["chapter"], "fields": fields, "body": piece.rstrip() + more + "\n",
                        "files": files_in(piece)})

    for s in book["summaries"]:
        of = folder if s["of"] == "book" else path[s["of"]]
        out.append({"path": spath[s["key"]], "types": ["summary"], "body": links(s["body"]),
                    "fields": {"of": of, "by": s["by"], "made": s["made"]}, "files": []})
    seen = set()
    for r in out:
        if r["path"] in seen: raise SystemExit(f"two records would be written at {r['path']}: nothing was written")
        seen.add(r["path"])
        r["hash"] = sha(json.dumps([r["types"], r["fields"], r["body"]], sort_keys=True).encode())
    return out


# ---------- the hub ----------
class Hub:
    def __init__(self, origin, vault, token):
        self.api = f"{origin.rstrip('/')}/vault/{vault}/api"; self.token = token; self.calls = 0

    def req(self, method, path, body=None, raw=None, ctype="application/json", ok404=False):
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        for attempt in range(12):  # the hub may restart for an update: wait and try again (about 4 minutes in all)
            self.calls += 1
            r = urllib.request.Request(self.api + path, data=data, method=method,
                                       headers={"authorization": "Bearer " + self.token, "accept": "application/json",
                                                **({"content-type": ctype} if data is not None else {})})
            try:
                with urllib.request.urlopen(r, timeout=120) as res: t = res.read()
                return json.loads(t) if t else None
            except urllib.error.HTTPError as e:
                msg = e.read()[:400]
                if e.code == 404 and ok404: return None
                if e.code in (502, 503) or (e.code == 504 and method == "GET"):  # a 504 may come after a write landed
                    wait(attempt, f"{method} {path}: {e.code}"); continue
                raise RuntimeError(f"{method} {path}: {e.code} {msg!r}") from None
            except (urllib.error.URLError, ConnectionError, TimeoutError) as e:
                # a write that timed out may have been done: say so rather than do it twice
                reason = getattr(e, "reason", e)
                if method != "GET" and not isinstance(reason, ConnectionRefusedError):
                    raise RuntimeError(f"{method} {path}: no answer ({e}); it may have been written. Run again: "
                                       "the receipt picks up where this stopped") from None
                wait(attempt, f"{method} {path}: {e}"); continue
        raise RuntimeError(f"{method} {path}: the hub didn't answer after several tries")

    def get(self, path):
        return self.req("GET", f"/records/{urllib.parse.quote(path, safe='')}?include_attachments=true", ok404=True)

    def upload(self, name, data, mime):
        b = "----library" + uuid.uuid4().hex
        payload = (f"--{b}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{name}\"\r\n"
                   f"Content-Type: {mime}\r\n\r\n").encode() + data + f"\r\n--{b}--\r\n".encode()
        return self.req("POST", "/storage/upload", raw=payload, ctype=f"multipart/form-data; boundary={b}")


def read_token(path):
    with open(path) as f: return f.read().strip()


def wait(attempt, why):
    s = min(30, 2 ** attempt)
    print(f"  the hub didn't answer ({why}); trying again in {s} s", file=sys.stderr)
    time.sleep(s)


def updated_of(rec): return (rec or {}).get("updatedAt") or (rec or {}).get("updated_at")


# ---------- the import ----------
RECEIPTS, RECEIPT_TAG = "Parachute/Receipts/", "parachute-receipt"


def book_id(book):
    slug = re.sub(r"[^a-z0-9]+", "-", book["title"].lower()).strip("-")
    return "book-" + (slug if slug else sha(book["title"].encode())[:12])  # a title in another script: by its hash


def cited_by_quotes(hub):
    """Every chapter path a quote in the vault names in its `from`: a record a quote cites is never pruned."""
    out, seen = set(), set()
    # Library knows a quote by its type or tag, or by its place in Quotes/: both are asked
    for q in ("tag=quote", "path_prefix=" + urllib.parse.quote("Quotes/", safe="")):
        off = 0
        while True:
            page = hub.req("GET", f"/notes?{q}&include_metadata=true&limit=200&offset={off}") or []
            new = [r for r in page if r.get("id") not in seen]
            if not new: break
            seen.update(r.get("id") for r in new); off += len(page)
            for r in new:
                ref = str((r.get("metadata") or r.get("fields") or {}).get("from") or "").strip()
                ref = re.sub(r"^\[\[([^\]|]*)(\|[^\]]*)?\]\]$", r"\1", ref).strip()
                if ref: out.add(re.sub(r"\.md$", "", ref))
            if len(page) < 200: break
    return out


def run(book, recs, hub, source, types_hub=None, prune=False):
    t0 = time.time()
    rid = book_id(book)
    rpath = RECEIPTS + rid
    did = {"types": [], "fields": [], "created": [], "updated": [], "attached": 0, "uploaded": 0, "bytes": 0,
           "unchanged": 0, "theirs": [], "changed_since": [], "deleted_since": [], "stale": [], "pruned": []}

    total = sum(len(v[1]) for v in book["files"].values())
    if total > FILES_MAX: raise SystemExit(f"the pictures come to {total // 2**20} MB, over 150 MB: nothing was written")

    # the receipt: what this import made, so a run cut off is finished by the next and a second run changes nothing
    held = hub.get(rpath)
    if held and RECEIPT_TAG not in (held.get("tags") or []):
        raise SystemExit(f"{rpath} is a record of someone's, not a receipt: nothing was written")
    receipt = ((held or {}).get("fields") or {}).get("receipt") or {
        "contract": 1, "id": rid, "name": f"{book['title']} (book import)", "version": 1,
        "source": f"library-import: {os.path.basename(os.path.normpath(source))}",
        "made": {"types": {}, "records": []}, "skipped": [], "files": {}}
    receipt.setdefault("files", {})
    # which book this folder holds: another with the same short title (a second translation) is refused, not merged
    who = {"title": book["title_full"], "author": book["author"], "source": book["source"]}
    if receipt.get("book") not in (None, who):
        raise SystemExit(f"Books/{book['title']} holds another book ({receipt['book'].get('title')}, "
                         f"{receipt['book'].get('author')}): nothing was written. Give this one its own folder "
                         f"with --title, e.g. --title \"{book['title']} ({book['translator'] or book['author']})\".")
    made = {r["path"]: r for r in receipt["made"]["records"]}
    state = {"id": held and held["id"], "updated": updated_of(held), "dirty": receipt.get("book") != who}
    receipt["book"] = who

    def save():
        if not state["dirty"]: return
        receipt["made"]["records"] = list(made.values())
        n = sum(1 for r in made.values() if r.get("id"))
        body = (f"What the book import made for *{book['title_full']}*: {n} records and "
                f"{len(receipt['files'])} pictures. Running it again changes only what it made and nobody changed since.\n")
        if state["id"]:
            r = hub.req("PATCH", f"/records/{state['id']}", {"fields": {"receipt": receipt}, "body": body,
                                                             "if_updated_at": state["updated"]})
        else:
            r = hub.req("POST", "/records", {"path": rpath, "body": body, "tags": [RECEIPT_TAG],
                                             "fields": {"receipt": receipt}, "if_exists": "ignore"})
            if r.get("existed"): raise SystemExit(f"{rpath} appeared while this ran; run again")
            state["id"] = r["id"]
        state["updated"] = updated_of(r) or updated_of(hub.get(rpath))
        state["dirty"] = False

    # types: made when missing; a type the vault has keeps its fields and gets only those it lacks
    have = {t["name"]: t for t in hub.req("GET", "/types?include_schema=true") or []}
    plain = set()  # names this vault keeps as plain tags: its records carry them as tags (the hub refuses them as types)
    for name, (desc, fields) in TYPES.items():
        t = have.get(name)
        if t and t.get("kind") != "type":
            plain.add(name)
            book["hard"].append(f"{name} is a plain tag in this vault; left as it is, and written as a tag"); continue
        missing = {f: v for f, v in fields.items() if f not in ((t or {}).get("fields") or {})}
        if not missing: continue
        try:
            (types_hub or hub).req("PUT", f"/types/{urllib.parse.quote(name)}",
                                   {"kind": "type", **({} if t else {"description": desc}), "fields": missing})
        except RuntimeError as err:
            if "insufficient_scope" in str(err) and not types_hub:
                raise SystemExit(f"This vault's server lets only admin define types (core before #139). Nothing was "
                                 f"written. Pass --types-token-file with a short-lived admin key, used for the "
                                 f"types alone.") from None
            raise
        (did["types"] if not t else did["fields"]).append(name if not t else f"{name}: {', '.join(missing)}")
        receipt["made"]["types"].setdefault(name, [])
        receipt["made"]["types"][name] = sorted(set(receipt["made"]["types"][name]) | set(missing))
        state["dirty"] = True


    def stored(k):
        """The file's storage path, uploading it the first time it's needed."""
        if k not in receipt["files"]:
            name, data, mime = book["files"][k]
            up = hub.upload(name, data, mime)
            receipt["files"][k] = {"path": up["path"], "mime": up.get("mimeType") or mime}
            did["uploaded"] += 1; did["bytes"] += len(data); state["dirty"] = True
        return receipt["files"][k]

    def body_of(r): return re.sub(r"\]\(file:([0-9a-f]{64})\)", lambda m: f"](/api/storage/{stored(m.group(1))['path']})", r["body"])

    def attach(rec_id, r, already):
        n = 0
        for k in r["files"]:
            f = stored(k)
            if f["path"] in already: continue
            hub.req("POST", f"/records/{rec_id}/attachments", {"path": f["path"], "mimeType": f["mime"]})
            n += 1
        did["attached"] += n
        return n

    # Whose is a record? The import's only while it holds exactly what the import last wrote there, or exactly what
    # this run would write (a write that landed before its run stopped): its body and the fields the import writes,
    # as the hub returns them. Anything else is someone's edit, and is never written to again. Pictures attached
    # don't change it, so finishing them never makes a record look edited.
    def print_of(rec, keys):
        f = rec.get("fields") or {}
        return sha(json.dumps([rec.get("body") or rec.get("content") or "", {k: f.get(k) for k in keys}],
                              sort_keys=True, ensure_ascii=False).encode())

    def planned_print(r):
        if any(k not in receipt["files"] for k in r["files"]): return None  # pictures not up yet: can't be there
        return print_of({"body": body_of(r), "fields": r["fields"]}, r["fields"])

    def theirs_now(r, mine):
        if mine["hash"] != r["hash"]: did["changed_since"].append(r["path"])
        else: did["unchanged"] += 1

    for r in recs:
        cur = hub.get(r["path"])
        mine = made.get(r["path"])
        if cur is None:
            if mine and mine.get("id") and not mine.get("pending"):
                did["deleted_since"].append(r["path"]); continue  # deleted since it was imported: stays deleted
            body = body_of(r)  # its pictures go up first, and are noted with the path before anything is written
            made[r["path"]] = {"path": r["path"], "id": None, "updated_at": None, "hash": r["hash"], "pending": True,
                               "next": planned_print(r)}
            state["dirty"] = True; save()
            tags = [t for t in r["types"] if t in plain]
            new = hub.req("POST", "/records", {"path": r["path"], "body": body, "types": [t for t in r["types"] if t not in plain],
                                               **({"tags": tags} if tags else {}), "fields": r["fields"], "if_exists": "ignore"})
            if new.get("existed"):  # someone made it meanwhile: theirs, and the note that it was ours goes
                del made[r["path"]]; state["dirty"] = True; save()
                raise SystemExit(f"{r['path']} appeared while this ran (someone else's); run again")
            attach(new["id"], r, set())
            cur = hub.get(r["path"])
            # the print is of what was sent, never of what is read back (an edit landing in between stays his)
            made[r["path"]] = {"path": r["path"], "id": cur["id"], "updated_at": updated_of(cur), "hash": r["hash"],
                               "wrote": planned_print(r), "keys": sorted(r["fields"])}
            state["dirty"] = True; did["created"].append(r["path"])
            save(); continue
        if not mine:
            did["theirs"].append(r["path"]); continue  # a record this import didn't make: left as it is
        now, planned = print_of(cur, r["fields"]), planned_print(r)
        # the import's last write is checked over the fields it wrote then (a better parse may add or drop one)
        wrote_now = print_of(cur, mine.get("keys") or r["fields"])
        if mine.get("pending"):
            # a create cut off before its receipt: the import's only if the record holds exactly what it sent
            if now not in (planned, mine.get("next")):
                del made[r["path"]]; state["dirty"] = True; did["theirs"].append(r["path"]); continue
            mine.update(id=cur["id"], wrote=now, keys=sorted(r["fields"]), updated_at=updated_of(cur))
            mine.pop("pending"); mine.pop("next", None); wrote_now = now
            state["dirty"] = True
        elif "wrote" not in mine:
            # a receipt from before prints were kept: unchanged since by its time stamp, and its print kept now
            if updated_of(cur) != mine.get("updated_at"): theirs_now(r, mine); continue
            mine["wrote"] = wrote_now; state["dirty"] = True
        # a field this plan adds that the record already holds otherwise was written by someone: his
        cur_f = cur.get("fields") or {}
        added = [k for k in r["fields"] if k not in (mine.get("keys") or r["fields"])]
        as_wrote = wrote_now == mine["wrote"] and all(cur_f.get(k) in (None, r["fields"][k]) for k in added)
        if as_wrote and "keys" not in mine:  # an entry from before keys were kept: they are today's
            mine["keys"] = sorted(r["fields"]); state["dirty"] = True
        if not as_wrote and now not in (planned, mine.get("next")):  # next: what a stopped run was writing
            theirs_now(r, mine); continue
        have = {a.get("path") for a in cur.get("attachments") or []}
        missing = [k for k in r["files"] if (receipt["files"].get(k) or {}).get("path") not in have]
        if now == planned and not missing and mine["hash"] == r["hash"] and mine["wrote"] == now and "next" not in mine \
                and mine.get("keys", sorted(r["fields"])) == sorted(r["fields"]):
            did["unchanged"] += 1; continue
        # everything this write needs is uploaded, and noted with the print of what it will send, before any write
        for k in r["files"]: stored(k)
        planned = planned_print(r)
        if now != planned: mine["next"] = planned
        state["dirty"] = True; save()
        if missing:  # pictures a run cut off before attaching, or ones this plan adds
            cur = hub.get(r["path"])  # read again just before: he may have written it while pictures went up
            if print_of(cur, r["fields"]) != now: theirs_now(r, mine); continue
            attach(cur["id"], r, have)
            cur = hub.get(r["path"])
            if print_of(cur, r["fields"]) != now: theirs_now(r, mine); continue
        if now != planned:
            try:
                hub.req("PATCH", f"/records/{cur['id']}", {"body": body_of(r), "fields": r["fields"],
                                                           "if_updated_at": updated_of(cur)})
            except RuntimeError as err:
                if ": 409 " not in str(err): raise
                theirs_now(r, mine); continue  # he wrote it just now: his
            cur = hub.get(r["path"]); did["updated"].append(r["path"])
        made[r["path"]] = {"path": r["path"], "id": cur["id"], "updated_at": updated_of(cur), "hash": r["hash"],
                           "wrote": planned, "keys": sorted(r["fields"])}
        state["dirty"] = True; save()
    # records an earlier import made where this plan has none (a better parse renumbered or renamed its chapters): listed
    # as stale; with prune, deleted while still exactly what the import wrote and cited by no quote
    planned = {r["path"] for r in recs}
    gone = [p for p, m in made.items() if p not in planned and m.get("id") and not m.get("pending")]
    cited = cited_by_quotes(hub) if prune and gone else set()
    for p in gone:
        mine, cur = made[p], hub.get(p)
        if cur is None:
            del made[p]; state["dirty"] = True; continue
        if not prune or p in cited or print_of(cur, mine.get("keys") or []) != mine.get("wrote"):
            did["stale"].append(p); continue
        try:
            hub.req("DELETE", f"/records/{cur['id']}")
        except RuntimeError as err:
            if ": 404 " not in str(err): raise
            hub.req("DELETE", f"/notes/{cur['id']}")  # a 0.8 hub: the note door
        del made[p]; state["dirty"] = True; did["pruned"].append(p)
    skipped = did["theirs"] + did["changed_since"]
    if sorted(skipped) != sorted(receipt.get("skipped") or []):
        receipt["skipped"] = skipped; state["dirty"] = True
    save()
    did["seconds"] = round(time.time() - t0, 1); did["calls"] = hub.calls
    return did


def counts(book, recs):
    kinds = {}
    for c in book["chapters"]: kinds[c["kind"]] = kinds.get(c["kind"], 0) + 1
    return {"title": book["title_full"], "folder": f"Books/{book['title']}", "records": len(recs),
            "chapters": len(book["chapters"]), "by_kind": kinds, "summaries": len(book["summaries"]),
            "pictures": len(book["files"]), "cover": bool(book["cover"]),
            "pictures_on_chapters": sum(len(r["files"]) for r in recs if "chapter" in r["types"]),
            "hard": book["hard"]}


# ---------- a job: a book someone added in Library, waiting for an AI ----------
JOB_KIND, EPUB = "import-book", "application/epub+zip"
STALE_S = 6 * 3600  # a job taken this long ago and still working: its taker died (a reboot, a kill), and it is taken again


class Job:
    """The job record over REST (the note door, core 0.8 and 0.9 alike): read it, change its fields on the version
    read, and read a stored piece."""
    def __init__(self, hub, ref):
        self.hub, self.ref = hub, ref
        self.rec = hub.req("GET", f"/notes/{urllib.parse.quote(ref, safe='')}?include_metadata=true")
        self.id = self.rec["id"]

    @property
    def fields(self): return self.rec.get("metadata") or self.rec.get("fields") or {}

    def set(self, **fields):
        """Fields set on the version last read; a 409 (someone changed it) raises."""
        self.rec = self.hub.req("PATCH", f"/notes/{self.id}", {"metadata": fields, "if_updated_at": updated_of(self.rec)})

    def fetch(self, path, out):
        """A stored piece into the open file `out`, read in 1 MiB steps: its SHA-256 and size."""
        url = f"{self.hub.api}/storage/{urllib.parse.quote(path)}"
        for attempt in range(12):
            h, n, at = hashlib.sha256(), 0, out.tell()
            try:
                r = urllib.request.Request(url, headers={"authorization": "Bearer " + self.hub.token})
                with urllib.request.urlopen(r, timeout=120) as res:
                    while True:
                        b = res.read(1 << 20)
                        if not b: return h.hexdigest(), n
                        h.update(b); n += len(b); out.write(b)
            except urllib.error.HTTPError as e:
                if e.code not in (502, 503, 504): raise RuntimeError(f"GET storage/{path}: {e.code}") from None
            except (urllib.error.URLError, ConnectionError, TimeoutError) as e:
                pass
            out.seek(at); out.truncate()
            wait(attempt, f"storage/{path}")
        raise RuntimeError(f"storage/{path}: the hub didn't answer after several tries")


def run_job(a, hub, types_hub=None):
    """Take a waiting import-book job, join its epub, import it, and say on the job how it went."""
    job = Job(hub, a.job)
    f = job.fields
    if "job" not in (job.rec.get("types") or []) + (job.rec.get("tags") or []):
        raise SystemExit(f"{job.rec.get('path')} is not a job: left as it is")
    if f.get("kind") != JOB_KIND:
        raise SystemExit(f"{job.rec.get('path')} asks for {f.get('kind')!r}, not {JOB_KIND}: left as it is")
    if f.get("status") != "waiting" and not stale(f):
        raise SystemExit(f"{job.rec.get('path')} is {f.get('status')!r}, not waiting: left as it is")
    up = f.get("upload") or {}
    parts = up.get("parts") or []
    name = os.path.basename(str(up.get("name") or "book.epub"))
    if not (up.get("type") == EPUB or name.lower().endswith(".epub")):
        raise SystemExit(f"this tool takes only an epub; {name} ({up.get('type')}) is left waiting for an AI that reads it")
    if not parts or not isinstance(up.get("size"), int) or sum(p.get("size", 0) for p in parts) != up["size"]:
        raise SystemExit(f"{job.rec.get('path')}: its upload isn't whole (the pieces don't add up to its size): left as it is")
    # only the job's own files: its upload field is writable by the applet that made it, its attachments are what came
    on = {a.get("path") for a in (hub.req("GET", f"/notes/{job.id}/attachments") or [])}
    if any(p.get("path") not in on for p in parts):
        raise SystemExit(f"{job.rec.get('path')}: its upload names a file not attached to it: left as it is")
    # taken: on the version read, so two takers can't both have it
    mine = {"by": a.by, "taken": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    try: job.set(status="working", **mine)
    except RuntimeError as e:
        if " 409 " in str(e): raise SystemExit(f"{job.rec.get('path')} was taken or changed meanwhile: left to whoever has it") from None
        raise
    try:
        with tempfile.TemporaryDirectory(prefix="library-job-") as tmp:
            path = os.path.join(tmp, name)
            with open(path, "wb") as out:
                for i, p in enumerate(parts):
                    sha, n = job.fetch(p["path"], out)
                    if n != p.get("size") or sha != p.get("sha256"):
                        raise RuntimeError(f"piece {i + 1} of {len(parts)} isn't what was sent (its size or SHA-256 differs)")
            book = read_epub(path, a.split_depth)
            if a.title: book["title"] = slugless(a.title)
            recs = plan(book)
            did = run(book, recs, hub, path, types_hub, getattr(a, "prune", False))
        folder = f"Books/{book['title']}"
        note = (f"{len(recs)} records ({len(book['chapters'])} chapters), {len(book['files'])} pictures."
                + (f" Left as someone changed them: {', '.join(did['theirs'] + did['changed_since'])[:300]}" if did["theirs"] or did["changed_since"] else ""))
        job.set(status="done", result=folder, note=note)
        return {"job": job.id, "status": "done", "result": folder, "plan": counts(book, recs), "run": did}
    except BaseException as e:
        why = str(e) if isinstance(e, (RuntimeError, SystemExit, ValueError, KeyError, zipfile.BadZipFile)) else type(e).__name__
        try:
            job.rec = hub.req("GET", f"/notes/{job.id}?include_metadata=true")
            # still this run's: a taker that came after (this one went stale) keeps it
            if all(job.fields.get(k) == v for k, v in mine.items()):
                job.set(status="failed", note=why[:400] or "the import stopped")
        except Exception as e2:
            print(f"  the job couldn't be marked failed: {e2}", file=sys.stderr)
        raise


def stale(f):
    """A job taken and still working after STALE_S: its taker is gone."""
    if f.get("status") != "working": return False
    try: return time.time() - calendar.timegm(time.strptime(str(f.get("taken")), "%Y-%m-%dT%H:%M:%SZ")) > STALE_S
    except ValueError: return False


def waiting_jobs(hub):
    """The waiting import-book jobs in the vault, oldest first (by path: Library names a job by its day and time)."""
    rows, off, seen = [], 0, set()
    while True:  # every job, a page at a time: done ones stay in the folder, so a vault gathers many
        page = hub.req("GET", f"/notes?tag=job&include_metadata=true&limit=200&offset={off}") or []
        new = [r for r in page if r.get("id") not in seen]
        if not new: break  # a hub that doesn't page: what it gave is all there is
        seen.update(r.get("id") for r in new); rows += new; off += len(page)
        if len(page) < 200: break
    mine = [r for r in rows if (r.get("metadata") or {}).get("kind") == JOB_KIND
            and ((r.get("metadata") or {}).get("status") == "waiting" or stale(r.get("metadata") or {}))]
    return sorted(mine, key=lambda r: r.get("path") or "")


def run_jobs(a, hub, types_hub=None):
    """Every waiting import-book job, one at a time: each epub imported, anything else left for an AI that reads it."""
    out = []
    for r in waiting_jobs(hub):
        a.job = r["id"]
        try: out.append(run_job(a, hub, types_hub))
        except SystemExit as e: out.append({"job": r["id"], "path": r.get("path"), "left": str(e)})
        except Exception as e: out.append({"job": r["id"], "path": r.get("path"), "failed": str(e)[:400]})
    return {"jobs": out}


def main():
    ap = argparse.ArgumentParser(description="A book (an epub, or a folder made from one) into a Parachute vault.")
    ap.add_argument("source", nargs="?", help="an .epub, or a folder made from one")
    ap.add_argument("--jobs", action="store_true", help="every waiting import-book job in the vault, one at a time")
    ap.add_argument("--job", help="a job record (id or path) Library's Add a book left: its epub, imported, and the job "
                    "marked done or failed")
    ap.add_argument("--vault", required=True)
    ap.add_argument("--hub", default=os.environ.get("LIBRARY_HUB", "http://127.0.0.1:1939"))
    ap.add_argument("--token-file", help="a file holding a key with write on the vault (never the key itself)")
    ap.add_argument("--types-token-file", help="a key with admin, used only to define the types, for a server "
                    "where write can't (core 0.9.0-pre.1); everything else uses --token-file")
    ap.add_argument("--title", help="the book's folder name, Books/<title> (default: its title up to a colon); for a "
                    "second edition or translation of a book already in, e.g. \"Meditations (Hays)\"")
    ap.add_argument("--by", default="Uni", help="who does it: the summaries' `by`, and the taker a job names")
    ap.add_argument("--split-depth", type=int, help="epub: cut at contents entries down to this depth (default: "
                    "chapters under parts, else the top level)")
    ap.add_argument("--prune", action="store_true", help="delete records an earlier import made at paths this one no "
                    "longer writes (a better parse renumbered them), while still exactly what it wrote and cited by no quote")
    ap.add_argument("--dry", action="store_true", help="read and plan only; print what would be written")
    ap.add_argument("--report", help="write the run's report (paths and counts, never the book's text) here")
    a = ap.parse_args()
    if a.job or a.jobs:
        if a.source or a.dry or (a.job and a.jobs): ap.error("--job or --jobs, with no SOURCE and no --dry")
        if not a.token_file: ap.error("--job needs --token-file")
        types_hub = Hub(a.hub, a.vault, read_token(a.types_token_file)) if a.types_token_file else None
        hub = Hub(a.hub, a.vault, read_token(a.token_file))
        report = run_jobs(a, hub, types_hub) if a.jobs else run_job(a, hub, types_hub)
        print(json.dumps(report, indent=1, ensure_ascii=False))
        if a.report:
            with open(a.report, "w") as f: json.dump(report, f, indent=1, ensure_ascii=False)
        return
    if not a.source: ap.error("give a SOURCE (an epub or a folder), or --job")
    book = read_folder(a.source, a.by) if os.path.isdir(a.source) else read_epub(a.source, a.split_depth)
    if a.title: book["title"] = slugless(a.title)
    recs = plan(book)
    report = {"plan": counts(book, recs)}
    if a.dry:
        report["paths"] = [r["path"] for r in recs]
    else:
        if not a.token_file: ap.error("--token-file is needed to write (or use --dry)")
        token = read_token(a.token_file)
        types_hub = Hub(a.hub, a.vault, read_token(a.types_token_file)) if a.types_token_file else None
        report["run"] = run(book, recs, Hub(a.hub, a.vault, token), a.source, types_hub, a.prune)
    print(json.dumps(report, indent=1, ensure_ascii=False))
    if a.report:
        with open(a.report, "w") as f: json.dump(report, f, indent=1, ensure_ascii=False)


if __name__ == "__main__":
    main()
