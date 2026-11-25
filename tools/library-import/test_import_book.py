#!/usr/bin/env python3
"""Tests for import_book.py (T-476).

    python3 -I test_import_book.py                      the parser checks (no hub)
    LIBRARY_TEST_VAULT=library-t476-b LIBRARY_TEST_TOKEN_FILE=W LIBRARY_TEST_TYPES_TOKEN_FILE=A \\
        python3 -I test_import_book.py                  also the re-import checks, on a throwaway vault of a real hub

The hub checks write a made-up book into the vault named; give them a fresh throwaway one.
"""
import copy, os, struct, sys, tempfile, unittest, urllib.parse, zipfile, zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ib = {"__name__": "import_book"}
exec(compile(open(os.path.join(HERE, "import_book.py")).read(), "import_book.py", "exec"), ib)


def png(rgb):
    raw = b"".join(b"\x00" + bytes(rgb) * 4 for _ in range(4))
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 4, 4, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


X = '<?xml version="1.0" encoding="utf-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>t</title></head><body>{}</body></html>'


def epub(path, docs, pictures=(), title="A Test Book"):
    """A small epub2 (ncx contents), one contents entry per document."""
    names = list(docs)
    opf = ('<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
           f'<dc:title>{title}</dc:title><dc:creator>Made Up</dc:creator><dc:language>en</dc:language></metadata><manifest>'
           + "".join(f'<item id="d{i}" href="{n}" media-type="application/xhtml+xml"/>' for i, n in enumerate(names))
           + "".join(f'<item id="p{i}" href="{n}" media-type="image/png"/>' for i, n in enumerate(pictures))
           + '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest><spine toc="ncx">'
           + "".join(f'<itemref idref="d{i}"/>' for i in range(len(names))) + "</spine></package>")
    ncx = ('<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>'
           + "".join(f'<navPoint id="n{i}"><navLabel><text>{n.split(".")[0].title()}</text></navLabel><content src="{n}"/></navPoint>' for i, n in enumerate(names))
           + "</navMap></ncx>")
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("mimetype", "application/epub+zip")
        z.writestr("META-INF/container.xml", '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
        z.writestr("OEBPS/content.opf", opf)
        z.writestr("OEBPS/toc.ncx", ncx)
        for n, body in docs.items(): z.writestr(f"OEBPS/{n}", X.format(body))
        for n in pictures: z.writestr(f"OEBPS/{n}", png((10, 120, 40)))


def chapters(path):
    return {c["label"]: c["body"] for c in ib["read_epub"](path)["chapters"]}


class Parser(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()

    def test_a_footnotes_link_back_keeps_the_paragraph_that_cites_it(self):
        # Project Gutenberg: the citing link is class fnanchor; the note links back to #FNanchor_1_1
        p = os.path.join(self.dir, "g.epub")
        epub(p, {"one.xhtml": '<h2>One</h2><p>Main text of the chapter, long enough to be a chapter of its own and not front matter at all.'
                              '<a id="FNanchor_1_1" href="#Footnote_1_1" class="fnanchor">[1]</a> More words.</p>'
                              '<p>A second paragraph.</p>'
                              '<div class="footnote"><p><a id="Footnote_1_1" href="#FNanchor_1_1"><span class="label">[1]</span></a> The note itself.</p></div>'
                              + "<p>" + "Filler words for length. " * 60 + "</p>"})
        body = chapters(p)["One"]
        self.assertIn("Main text of the chapter", body.split("---")[0])
        self.assertIn("[^1] More words.", body)
        self.assertRegex(body, r"\[\^1\]: .*The note itself\.")
        self.assertEqual(body.count("[^"), 2)  # one citation, one note: the main paragraph didn't become a note

    def test_a_marked_note_reference_counts_whatever_its_target_is_called(self):
        p = os.path.join(self.dir, "n.epub")
        epub(p, {"one.xhtml": '<h2>One</h2><p>Cited here.<a epub:type="noteref" href="#ref1">1</a> And on.</p>'
                              '<aside epub:type="footnote" id="ref1"><p>The note.</p></aside>' + "<p>" + "More words. " * 120 + "</p>"})
        self.assertRegex(chapters(p)["One"], r"Cited here\.\[\^1\] And on\.[\s\S]*\[\^1\]: The note\.")

    def test_a_link_back_marked_by_class_keeps_its_paragraph(self):
        # pandoc: the citation is class footnote-ref to #fn1, the note's link back is class footnote-back to #fnref1
        p = os.path.join(self.dir, "b.epub")
        epub(p, {"one.xhtml": '<h2>One</h2><p>Main paragraph.<a href="#fn1" class="footnote-ref" id="fnref1"><sup>1</sup></a></p>'
                              '<section class="footnotes"><ol><li id="fn1"><p>The note. <a href="#fnref1" class="footnote-back">↩</a></p></li></ol></section>'
                              + "<p>" + "More words. " * 120 + "</p>"})
        body = chapters(p)["One"]
        self.assertIn("Main paragraph.", body.split("---")[0])
        self.assertEqual(body.count("[^"), 2)

    def test_italics_keep_the_space_beside_them(self):
        p = os.path.join(self.dir, "i.epub")
        epub(p, {"one.xhtml": "<h2>One</h2><p><em>Hello </em>world and <b>bold</b> words." + " More." * 300 + "</p>"})
        self.assertIn("*Hello* world and **bold** words.", chapters(p)["One"])

    def test_a_title_in_another_script_gets_its_own_receipt(self):
        a, b = ib["book_id"]({"title": "Война и мир"}), ib["book_id"]({"title": "道德經"})
        self.assertNotEqual(a, b)
        self.assertNotEqual(a, "book-")


@unittest.skipUnless(os.environ.get("LIBRARY_TEST_VAULT"), "needs a throwaway vault on a hub (LIBRARY_TEST_VAULT)")
class Reimport(unittest.TestCase):
    """Against a real hub: what a second import may and may not change."""

    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.mkdtemp()
        cls.src = os.path.join(cls.dir, "garden.epub")
        epub(cls.src, {"seeds.xhtml": "<h2>Seeds</h2><p>" + "Every seed holds a plan. " * 50 + '</p><p><img src="sprout.png" alt="A sprout"/></p>',
                       "water.xhtml": "<h2>Water</h2><p>" + "Water at dawn. " * 50 + "</p>",
                       "picking.xhtml": "<h2>Picking</h2><p>" + "Pick in the cool of the morning. " * 50 + "</p>"},
             pictures=["sprout.png"], title=f"A Test Book {os.urandom(3).hex()}")  # its own folder each run
        hub, vault = os.environ.get("LIBRARY_TEST_HUB", "http://127.0.0.1:1939"), os.environ["LIBRARY_TEST_VAULT"]
        cls.hub = ib["Hub"](hub, vault, ib["read_token"](os.environ["LIBRARY_TEST_TOKEN_FILE"]))
        types = os.environ.get("LIBRARY_TEST_TYPES_TOKEN_FILE")
        cls.types_hub = ib["Hub"](hub, vault, ib["read_token"](types)) if types else None

    def run_import(self, book, hub=None):
        return ib["run"](book, ib["plan"](book), hub or self.hub, self.src, self.types_hub)

    def rec(self, label):
        return self.hub.req("GET", f"/records/{urllib.parse.quote(self.folder + '/' + label, safe='')}?include_attachments=true")

    def test_reimport(self):
        book = ib["read_epub"](self.src)
        self.folder = f"Books/{book['title']}"

        # 1. a run cut off after a chapter is written and before its picture is attached
        class CutOff(ib["Hub"]):
            def req(s, method, path, *a, **k):
                if method == "POST" and path.endswith("/attachments"): raise KeyboardInterrupt("cut off")
                return super().req(method, path, *a, **k)
        cut = CutOff(self.hub.api.split("/vault/")[0], self.hub.api.split("/vault/")[1].split("/")[0], self.hub.token)
        with self.assertRaises(KeyboardInterrupt): self.run_import(book, cut)
        self.assertEqual(self.rec("00 Seeds")["attachments"], [])

        # 2. the next run adopts it and attaches its picture
        did = self.run_import(book)
        self.assertEqual(len(self.rec("00 Seeds")["attachments"]), 1)
        self.assertNotIn(f"{self.folder}/00 Seeds", did["created"])

        # 3. running again changes nothing
        did = self.run_import(book)
        self.assertEqual([did["created"], did["updated"], did["attached"], did["uploaded"], did["types"], did["fields"]],
                         [[], [], 0, 0, [], []])

        # 4. he edits Water; a better parser now gives every chapter a picture and new words
        water = self.rec("01 Water")
        self.hub.req("PATCH", f"/records/{water['id']}", {"body": "My own words.", "if_updated_at": ib["updated_of"](water)})
        better = copy.deepcopy(book)
        k = ib["add_file"](better, "leaf.png", png((200, 30, 30)), "image/png")
        for c in better["chapters"]: c["body"] += f"\n\nA better parse.\n\n![A leaf](file:{k})"
        did = self.run_import(better)
        self.assertIn(f"{self.folder}/01 Water", did["changed_since"])
        self.assertIn(f"{self.folder}/02 Picking", did["updated"])
        water = self.rec("01 Water")
        self.assertEqual(water.get("body") or water.get("content"), "My own words.")
        self.assertEqual(water["attachments"], [])  # nothing attached to his record either
        self.assertEqual(len(self.rec("02 Picking")["attachments"]), 1)

        # 5. and the run after that still leaves his record alone
        did = self.run_import(better)
        self.assertEqual(did["updated"], [])
        self.assertEqual((self.rec("01 Water").get("body") or ""), "My own words.")

        # 6. an update run cut off midway: what it updated before stopping is still its own, so the next run
        # finishes the rest and calls nothing "changed since"
        again = copy.deepcopy(better)
        for c in again["chapters"]: c["body"] += "\n\nAn even better parse."
        class StopAtPicking(ib["Hub"]):
            def req(s, method, path, *a, **k):
                if method == "PATCH" and path == f"/records/{self.rec('02 Picking')['id']}": raise KeyboardInterrupt("cut off")
                return super().req(method, path, *a, **k)
        stop = StopAtPicking(self.hub.api.split("/vault/")[0], self.hub.api.split("/vault/")[1].split("/")[0], self.hub.token)
        with self.assertRaises(KeyboardInterrupt): self.run_import(again, stop)
        did = self.run_import(again)
        self.assertEqual(did["changed_since"], [f"{self.folder}/01 Water"])  # his, still; nothing of the import's
        self.assertIn(f"{self.folder}/02 Picking", did["updated"])
        self.assertIn("An even better parse.", self.rec("00 Seeds").get("body") or "")

        # 7. he edits Picking just as the import writes it: the write is refused (409), and his words stay his, this
        # run and the next
        latest = copy.deepcopy(again)
        for c in latest["chapters"]: c["body"] += "\n\nThe latest parse."
        hub = self.hub
        class HeWritesFirst(ib["Hub"]):
            def req(s, method, path, *a, **k):
                pick = self.rec("02 Picking")
                if method == "PATCH" and path == f"/records/{pick['id']}":
                    hub.req("PATCH", path, {"body": "Picking, in my words.", "if_updated_at": ib["updated_of"](pick)})
                return super().req(method, path, *a, **k)
        racing = HeWritesFirst(self.hub.api.split("/vault/")[0], self.hub.api.split("/vault/")[1].split("/")[0], self.hub.token)
        did = self.run_import(latest, racing)
        self.assertIn(f"{self.folder}/02 Picking", did["changed_since"])
        did = self.run_import(latest)
        self.assertIn(f"{self.folder}/02 Picking", did["changed_since"])
        self.assertEqual(self.rec("02 Picking").get("body"), "Picking, in my words.")

        # 8. a run stops after marking Seeds and before writing it; he edits Seeds; the next run leaves it his
        final = copy.deepcopy(latest)
        for c in final["chapters"]: c["body"] += "\n\nThe final parse."
        class StopAtSeeds(ib["Hub"]):
            def req(s, method, path, *a, **k):
                if method == "PATCH" and path == f"/records/{self.rec('00 Seeds')['id']}": raise KeyboardInterrupt("cut off")
                return super().req(method, path, *a, **k)
        stop = StopAtSeeds(self.hub.api.split("/vault/")[0], self.hub.api.split("/vault/")[1].split("/")[0], self.hub.token)
        with self.assertRaises(KeyboardInterrupt): self.run_import(final, stop)
        seeds = self.rec("00 Seeds")
        self.hub.req("PATCH", f"/records/{seeds['id']}", {"body": "Seeds, in my words.", "if_updated_at": ib["updated_of"](seeds)})
        did = self.run_import(final)
        self.assertIn(f"{self.folder}/00 Seeds", did["changed_since"])
        self.assertEqual(self.rec("00 Seeds").get("body"), "Seeds, in my words.")


    def fresh_book(self):
        """The same made-up book under a title of its own, so each check starts with nothing written."""
        src = os.path.join(self.dir, f"b{os.urandom(3).hex()}.epub")
        epub(src, {"seeds.xhtml": "<h2>Seeds</h2><p>" + "Every seed holds a plan. " * 50 + '</p><p><img src="sprout.png" alt="A sprout"/></p>',
                   "water.xhtml": "<h2>Water</h2><p>" + "Water at dawn. " * 50 + "</p>"},
             pictures=["sprout.png"], title=f"A Test Book {os.urandom(3).hex()}")
        book = ib["read_epub"](src)
        self.folder = f"Books/{book['title']}"
        return book

    def hub_that(self, before):
        """The hub, with `before(method, path)` run ahead of each call (a stop, or his edit landing first)."""
        class H(ib["Hub"]):
            def req(s, method, path, *a, **k):
                before(method, path)
                return super().req(method, path, *a, **k)
        return H(self.hub.api.split("/vault/")[0], self.hub.api.split("/vault/")[1].split("/")[0], self.hub.token)

    def edit(self, label, **change):
        r = self.rec(label)
        self.hub.req("PATCH", f"/records/{r['id']}", {**change, "if_updated_at": ib["updated_of"](r)})

    def test_his_edit_after_a_stopped_create_stays_his(self):
        book = self.fresh_book()
        def stop(method, path):
            if method == "POST" and path.endswith("/attachments"): raise KeyboardInterrupt("cut off")
        with self.assertRaises(KeyboardInterrupt): self.run_import(book, self.hub_that(stop))
        self.edit("00 Seeds", body="Seeds, in my words.")
        did = self.run_import(book)
        self.assertIn(f"{self.folder}/00 Seeds", did["theirs"])
        self.assertEqual(self.rec("00 Seeds").get("body"), "Seeds, in my words.")
        self.assertEqual(self.rec("00 Seeds")["attachments"], [])

    def test_his_edit_while_pictures_go_up_stays_his(self):
        book = self.fresh_book()
        self.run_import(book)
        better = copy.deepcopy(book)
        k = ib["add_file"](better, "leaf.png", png((200, 30, 30)), "image/png")
        for c in better["chapters"]: c["body"] += f"\n\n![A leaf](file:{k})"
        done, water = [], self.rec("01 Water")["id"]
        def he_writes(method, path):  # as Water's own new picture goes on
            if method == "POST" and path == f"/records/{water}/attachments" and not done:
                done.append(1); self.edit("01 Water", body="Water, in my words.")
        did = self.run_import(better, self.hub_that(he_writes))
        self.assertIn(f"{self.folder}/01 Water", did["changed_since"])
        self.assertEqual(self.rec("01 Water").get("body"), "Water, in my words.")
        self.assertEqual(self.run_import(better)["updated"], [])

    def test_his_field_after_a_landed_write_stays_his(self):
        book = self.fresh_book()
        self.run_import(book)
        better = copy.deepcopy(book)
        for c in better["chapters"]: c["body"] += "\n\nA better parse."
        water = self.rec("01 Water")["id"]
        class StopAfter(ib["Hub"]):
            def req(s, method, path, *a, **k):
                out = super().req(method, path, *a, **k)
                if method == "PATCH" and path == f"/records/{water}": raise KeyboardInterrupt("cut off after it landed")
                return out
        with self.assertRaises(KeyboardInterrupt):
            self.run_import(better, StopAfter(self.hub.api.split("/vault/")[0], self.hub.api.split("/vault/")[1].split("/")[0], self.hub.token))
        self.edit("01 Water", fields={"words": 999})
        did = self.run_import(better)
        self.assertIn(f"{self.folder}/01 Water", did["changed_since"])
        self.assertEqual(self.rec("01 Water")["fields"]["words"], 999)
        self.assertEqual(self.run_import(better)["updated"], [])


    def test_a_record_adopted_after_a_lost_answer_and_then_deleted_stays_deleted(self):
        book = self.fresh_book()
        class LoseWaterAnswer(ib["Hub"]):
            def req(s, method, path, body=None, *a, **k):
                out = super().req(method, path, body, *a, **k)
                if method == "POST" and path == "/records" and (body or {}).get("path", "").endswith("01 Water"):
                    raise KeyboardInterrupt("the answer was lost")
                return out
        lose = LoseWaterAnswer(self.hub.api.split("/vault/")[0], self.hub.api.split("/vault/")[1].split("/")[0], self.hub.token)
        with self.assertRaises(KeyboardInterrupt): self.run_import(book, lose)
        self.assertEqual(self.run_import(book)["theirs"], [])  # adopted: it holds exactly what was sent
        self.hub.req("DELETE", f"/records/{self.rec('01 Water')['id']}")
        did = self.run_import(book)
        self.assertEqual(did["created"], [])
        self.assertIn(f"{self.folder}/01 Water", did["deleted_since"])

    def test_a_landed_update_with_a_new_picture_is_finished_not_disowned(self):
        book = self.fresh_book()
        self.run_import(book)
        better = copy.deepcopy(book)
        k = ib["add_file"](better, "leaf.png", png((200, 30, 30)), "image/png")
        for c in better["chapters"]:  # the new picture in Water alone, so nothing before it saves it
            c["body"] += "\n\nA better parse." + (f"\n\n![A leaf](file:{k})" if c["label"] == "Water" else "")
        water = self.rec("01 Water")["id"]
        class StopAfter(ib["Hub"]):
            def req(s, method, path, *a, **k):
                out = super().req(method, path, *a, **k)
                if method == "PATCH" and path == f"/records/{water}": raise KeyboardInterrupt("cut off after it landed")
                return out
        with self.assertRaises(KeyboardInterrupt):
            self.run_import(better, StopAfter(self.hub.api.split("/vault/")[0], self.hub.api.split("/vault/")[1].split("/")[0], self.hub.token))
        did = self.run_import(better)
        self.assertEqual([did["changed_since"], did["uploaded"]], [[], 0])
        self.assertEqual(len(self.rec("01 Water")["attachments"]), 1)
        self.assertEqual(self.run_import(better)["attached"], 0)

    def test_his_edit_just_after_the_import_writes_stays_his(self):
        book = self.fresh_book()
        self.run_import(book)
        better = copy.deepcopy(book)
        for c in better["chapters"]: c["body"] += "\n\nA better parse."
        water, state = self.rec("01 Water")["id"], []
        def he_writes(method, path):  # after the import's PATCH of Water, before it reads Water back
            if method == "PATCH" and path == f"/records/{water}": state.append("patched")
            elif method == "GET" and "01%20Water" in path and state == ["patched"]:
                state.append("edited"); self.edit("01 Water", body="Water, in my words.")
        self.run_import(better, self.hub_that(he_writes))
        best = copy.deepcopy(better)
        for c in best["chapters"]: c["body"] += "\n\nThe best parse."
        did = self.run_import(best)
        self.assertIn(f"{self.folder}/01 Water", did["changed_since"])
        self.assertEqual(self.rec("01 Water").get("body"), "Water, in my words.")


    def test_another_book_with_the_same_title_is_refused_not_merged(self):
        book = self.fresh_book()
        self.run_import(book)
        other = copy.deepcopy(book)
        other["title_full"] += " (another translation)"; other["author"] = "Someone Else"
        for c in other["chapters"]: c["body"] = "Another translation's words."
        with self.assertRaises(SystemExit): self.run_import(other)
        self.assertIn("Every seed holds a plan.", self.rec("00 Seeds").get("body"))

    def test_a_better_parse_that_adds_a_field_still_reaches_the_record(self):
        book = self.fresh_book()
        self.run_import(book)
        better = copy.deepcopy(book)
        better["translator"] = "A Translator"  # a field the book record didn't have before
        did = self.run_import(better)
        self.assertEqual(did["changed_since"], [])
        self.assertIn(self.folder, did["updated"])
        self.assertEqual(self.hub.req("GET", f"/records/{urllib.parse.quote(self.folder, safe='')}")["fields"]["translator"], "A Translator")
        self.assertEqual(self.run_import(better)["updated"], [])

    def test_a_field_he_typed_stays_his_when_a_better_parse_adds_it(self):
        book = self.fresh_book()
        self.run_import(book)
        r = self.hub.req("GET", f"/records/{urllib.parse.quote(self.folder, safe='')}")
        self.hub.req("PATCH", f"/records/{r['id']}", {"fields": {"translator": "His Translator"}, "if_updated_at": ib["updated_of"](r)})
        better = copy.deepcopy(book)
        better["translator"] = "Parsed Translator"
        did = self.run_import(better)
        self.assertIn(self.folder, did["changed_since"])
        self.assertEqual(self.hub.req("GET", f"/records/{urllib.parse.quote(self.folder, safe='')}")["fields"]["translator"], "His Translator")


if __name__ == "__main__":
    unittest.main(verbosity=2)
