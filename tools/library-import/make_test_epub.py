#!/usr/bin/env python3
"""Made-up epubs for the importer (no real book's words or pictures).

    python3 -I make_test_epub.py out.epub            A Small Garden: a small epub3
    python3 -I make_test_epub.py out.epub --sutras   The Made-up Sutras: the shapes of a real sūtra book (T-531)

A Small Garden: nav.xhtml only (no ncx), two parts with chapters nested under them, epub3 footnotes (noteref + aside;
one id reused in another file), a picture inside a chapter, cross-references (to an anchor and to a whole file), and
named entities.

The Made-up Sutras reproduces what a real import of a translated sūtra book with commentary showed (T-531): short
front matter (title page, copyright, dedication, "Books by") with a long foreword among them; a printed Contents whose
links hold a line break and emphasis (`Book One<br/><em>…</em> (…)`) and a plain "Index" line with no link; headings
wrapped in emphasis (`<h2><em>Contents</em></h2>`, `<em><strong>…</strong></em>`); a small ornament picture before
every verse (one file, many times) and a tiny flourish once; one real picture; each verse as a bold numbered line,
word-by-word glosses, a bold translation and commentary paragraphs; a first part far longer than the rest; and a
glossary of terms (`<strong><em>term</em></strong> — meaning`)."""
import struct, sys, zipfile, zlib

def png(w, h, rgb):
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")

X = '<?xml version="1.0" encoding="utf-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>{t}</title></head><body>{b}</body></html>'


def write(path, title, author, ident, docs, nav, images, cover):
    items = "".join(f'<item id="d{i}" href="{p}" media-type="application/xhtml+xml"/>' for i, p in enumerate(docs))
    pics = "".join(f'<item id="i{i}" href="images/{n}" media-type="image/png"{" properties=\"cover-image\"" if n == cover else ""}/>' for i, n in enumerate(images))
    opf = ('<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
           f'<dc:identifier id="id">{ident}</dc:identifier><dc:title>{title}</dc:title><dc:creator id="a">{author}</dc:creator>'
           '<meta refines="#a" property="role" scheme="marc:relators">aut</meta><dc:language>en</dc:language></metadata><manifest>'
           f'<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>{pics}{items}</manifest><spine>'
           + "".join(f'<itemref idref="d{i}"/>' for i in range(len(docs))) + "</spine></package>")
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        z.writestr("META-INF/container.xml", '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
        z.writestr("OEBPS/content.opf", opf); z.writestr("OEBPS/nav.xhtml", nav)
        for n, data in images.items(): z.writestr("OEBPS/images/" + n, data)
        for p, d in docs.items(): z.writestr("OEBPS/" + p, d)


def garden(path):
    docs = {
        "text/part1.xhtml": X.format(t="Part One", b='<section epub:type="part" id="p1"><h1>Part One: The Garden</h1><p>A made-up book for testing.</p></section>'),
        "text/ch1.xhtml": X.format(t="Seeds", b='<section id="c1"><h2>1. Seeds</h2><p>Every seed holds a plan.<a epub:type="noteref" href="#n1">1</a> Plant them shallow&nbsp;&mdash; then wait.</p>'
            '<figure><img src="../images/sprout.png" alt="A green sprout"/><figcaption>A sprout on day four.</figcaption></figure>'
            '<p>See <a href="ch2.xhtml#water">watering</a> for the next step.</p>'
            '<aside epub:type="footnote" id="n1"><p>Seeds in this book are imaginary.</p></aside></section>'),
        "text/ch2.xhtml": X.format(t="Water", b='<section id="c2"><h2>2. Water</h2><p id="water">Water at dawn.<a epub:type="noteref" href="#n2">2</a> Rain counts too.<a epub:type="noteref" href="notes.xhtml#e1">3</a></p>'
            '<blockquote><p>Too much water drowns the roots.</p><p>Too little starves them.</p></blockquote>'
            '<aside epub:type="footnote" id="n2"><p>Dawn here means before the sun is high.</p></aside></section>'),
        "text/notes.xhtml": X.format(t="Notes", b='<section id="endnotes"><h2>Notes</h2><aside epub:type="endnote" id="e1"><p>1896 was a good year for gardens.</p></aside></section>'),
        "text/part2.xhtml": X.format(t="Part Two", b='<section epub:type="part" id="p2"><h1>Part Two: The Harvest</h1></section>'),
        "text/ch3.xhtml": X.format(t="Picking", b='<section id="c3"><h2>3. Picking</h2><ul><li>Pick in the cool of the morning.</li><li>Leave one for the birds.</li></ul>'
            '<p>Start again from <a href="ch1.xhtml">the seeds</a>.<a epub:type="noteref" href="#n1">1</a></p>'
            '<aside epub:type="footnote" id="n1"><p>This file reuses the id n1, as many epubs do.</p></aside></section>'),
    }
    nav = X.format(t="Contents", b='<nav epub:type="toc"><ol>'
        '<li><a href="text/part1.xhtml#p1">Part One: The Garden</a><ol><li><a href="text/ch1.xhtml">Seeds</a></li><li><a href="text/ch2.xhtml#c2">Water</a></li></ol></li>'
        '<li><a href="text/notes.xhtml#endnotes">Notes</a></li><li><a href="text/part2.xhtml">Part Two: The Harvest</a><ol><li><ol><li><a href="text/ch3.xhtml#c3">Picking</a></li></ol></li></ol></li></ol></nav>')
    write(path, "A Small Garden: A Made-up Book", "Robin Example", "urn:uuid:made-up-garden", docs, nav,
          {"cover.png": png(60, 90, (40, 90, 60)), "sprout.png": png(40, 40, (90, 170, 60))}, "cover.png")


# made-up words for made-up verses: none of them is from a real book
SYL = ["ka", "ra", "nā", "vi", "dha", "ma", "sa", "tī", "pra", "ja", "lo", "ve", "śa", "nu", "ya", "ṛ", "ho", "dī"]
EN = ["breath", "stillness", "the river", "a lamp", "the field", "attention", "the seed", "a cup", "the hill", "patience",
      "the morning", "a thread", "the gate", "rest", "the path", "clear water"]
FILL = ("The teacher in this made-up book returns to the image again and again, as if to say that nothing here is new "
        "and everything must be seen once more. A student who reads quickly will miss it; one who reads slowly will find "
        "that each line leans on the one before it, the way stones in a wall lean on each other. ")


def word(i, n=3):
    return "".join(SYL[(i * 7 + k * 5) % len(SYL)] for k in range(n))


def verse(n, seed, paras):
    words = [word(seed + k, 2 + (k % 2)) for k in range(3)]
    meanings = [EN[(seed + k) % len(EN)] for k in range(3)]
    line = " ".join(words).capitalize()
    gloss = "; ".join(f"<strong>{w}</strong> = {m}" for w, m in zip(words, meanings)) + ";"
    trans = f"{meanings[0].capitalize()} rests in {meanings[1]}, and {meanings[2]} follows."
    out = (f'<p class="orn"><img src="../images/ornament.png" alt="Image"/></p>'
           f'<p class="sutra"><strong>{n}. {line}.</strong></p><p class="gloss">{gloss}</p><p class="trans"><strong>{trans}</strong></p>')
    for k in range(paras):
        out += f"<p>{FILL if k % 2 == 0 else FILL.replace('teacher', 'commentator')}On verse {n}, part {k + 1}: {meanings[k % 3]} is the point.</p>"
    return out


def sutras(path):
    short = lambda h, t: f"<h2><em>{h}</em></h2><p>{t}</p>"
    book1 = ("<section><h2><em>Book One</em></h2><h2><em><strong>Ārambha Pāda</strong></em></h2><h3><em>Portion on Beginning</em></h3>"
             "<p>This first book sets out the ground. It is far longer than the others, as such first books often are.</p>"
             + "".join(verse(n, n, 6) for n in range(1, 31))
             + '<figure><img src="../images/streams.png" alt="A diagram of the four streams"/><figcaption>The four streams, as the commentary draws them.</figcaption></figure>'
             + '<p class="orn"><img src="../images/flourish.png" alt=""/></p></section>')
    book2 = ("<section><h2><em>Book Two</em></h2><h2><em><strong>Sādhana Pāda</strong></em></h2><h3><em>Portion on Practice</em></h3>"
             + "".join(verse(n, 40 + n, 2) for n in range(1, 9)) + "</section>")
    gloss = "<h2><em>Glossary of Made-up Terms</em></h2>" + "".join(
        f"<p><strong><em>{word(60 + k)}</em></strong> — {EN[k % len(EN)]}</p>" for k in range(12))
    contents = ('<h2><em>Contents</em></h2>'
                '<p class="toc"><a href="foreword.xhtml">Foreword</a></p>'
                '<p class="toc"><a href="book1.xhtml">Book One<br/><em>Ārambha Pāda</em> (Portion on Beginning)</a></p>'
                '<p class="toc"><a href="book2.xhtml">Book Two<br/><em>Sādhana Pāda</em> (Portion on Practice)</a></p>'
                '<p class="toc"><a href="glossary.xhtml"><em>Glossary of Made-up Terms</em></a></p>'
                '<p class="toc">Index</p>')
    docs = {f"text/{k}": v for k, v in {
        "cover.xhtml": X.format(t="Cover", b='<div><img src="../images/cover.png" alt=""/></div>'),
        "title.xhtml": X.format(t="Title", b="<h1><em>The Made-up Sutras</em></h1><p>With a made-up commentary</p>"),
        "copyright.xhtml": X.format(t="Copyright", b=short("Copyright", "Made up for testing. No rights reserved; nothing here is from a real book.")),
        "foreword.xhtml": X.format(t="Foreword", b="<h2><em>Foreword</em></h2>" + "".join(f"<p>{FILL}</p>" for _ in range(6))),
        "dedication.xhtml": X.format(t="Dedication", b=short("Dedication", "For everyone who reads slowly.")),
        "contents.xhtml": X.format(t="Contents", b=contents),
        "booksby.xhtml": X.format(t="Books by", b=short("Books by the Same Made-up Teacher", "The Small Lamp. The Long Road. The Quiet Field.")),
        "book1.xhtml": X.format(t="Book One", b=book1),
        "book2.xhtml": X.format(t="Book Two", b=book2),
        "glossary.xhtml": X.format(t="Glossary", b=gloss),
        "index.xhtml": X.format(t="Index", b="<h2>Index</h2>" + "".join(f"<p>{word(k)}, 1.{k}</p>" for k in range(20))),
    }.items()}
    entries = [("title.xhtml", "Title Page"), ("copyright.xhtml", "Copyright"), ("foreword.xhtml", "Foreword"),
               ("dedication.xhtml", "Dedication"), ("contents.xhtml", "Contents"), ("booksby.xhtml", "Books by the Same Made-up Teacher"),
               ("book1.xhtml", "Book One: Ārambha Pāda (Portion on Beginning)"), ("book2.xhtml", "Book Two: Sādhana Pāda (Portion on Practice)"),
               ("glossary.xhtml", "Glossary of Made-up Terms"), ("index.xhtml", "Index")]
    nav = X.format(t="Contents", b='<nav epub:type="toc"><ol>' + "".join(f'<li><a href="text/{f}">{t}</a></li>' for f, t in entries) + "</ol></nav>")
    write(path, "The Made-up Sutras: With a Made-up Commentary", "Sam Example", "urn:uuid:made-up-sutras", docs, nav,
          {"cover.png": png(60, 90, (120, 60, 40)), "ornament.png": png(24, 24, (150, 110, 60)),
           "flourish.png": png(48, 12, (150, 110, 60)), "streams.png": png(240, 160, (60, 110, 150))}, "cover.png")


if __name__ == "__main__":
    (sutras if "--sutras" in sys.argv[2:] else garden)(sys.argv[1])
