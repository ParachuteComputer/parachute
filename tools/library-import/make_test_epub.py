#!/usr/bin/env python3
"""A small made-up epub3 for the importer: nav.xhtml only (no ncx), two parts with chapters nested under them,
epub3 footnotes (noteref + aside; one id reused in another file), a picture inside a chapter, cross-references (to
an anchor and to a whole file), and named entities.
    python3 -I make-test-epub.py out.epub"""
import struct, sys, zipfile, zlib

def png(w, h, rgb):
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")

X = '<?xml version="1.0" encoding="utf-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>{t}</title></head><body>{b}</body></html>'
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
items = "".join(f'<item id="d{i}" href="{p}" media-type="application/xhtml+xml"/>' for i, p in enumerate(docs))
opf = ('<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
       '<dc:identifier id="id">urn:uuid:made-up-garden</dc:identifier><dc:title>A Small Garden: A Made-up Book</dc:title><dc:creator id="a">Robin Example</dc:creator>'
       '<meta refines="#a" property="role" scheme="marc:relators">aut</meta><dc:language>en</dc:language></metadata><manifest>'
       f'<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover" href="images/cover.png" media-type="image/png" properties="cover-image"/>'
       f'<item id="sprout" href="images/sprout.png" media-type="image/png"/>{items}</manifest><spine>'
       + "".join(f'<itemref idref="d{i}"/>' for i in range(len(docs))) + "</spine></package>")
with zipfile.ZipFile(sys.argv[1], "w") as z:
    z.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
    z.writestr("META-INF/container.xml", '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
    z.writestr("OEBPS/content.opf", opf); z.writestr("OEBPS/nav.xhtml", nav)
    z.writestr("OEBPS/images/cover.png", png(60, 90, (40, 90, 60))); z.writestr("OEBPS/images/sprout.png", png(40, 40, (90, 170, 60)))
    for p, d in docs.items(): z.writestr("OEBPS/" + p, d)
