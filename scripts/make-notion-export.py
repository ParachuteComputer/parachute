"""make-notion-export.py <out.zip>: a made-up Notion workspace exported as "Markdown & CSV", shaped like a real export:
an outer zip holding Export-<id>-Part-1.zip, whose one root folder is Export-<id>/; names end in a 32-hex id; databases are <name> <id>.csv and _all.csv beside a
folder of row pages, each starting with its properties; links are relative and URL-encoded; CSVs start with a BOM.
Everything in it is invented (Juno Okafor, a freelance illustrator). Run: python3 scripts/make-notion-export.py e2e/fixtures/notion-export.zip"""
import hashlib, io, struct, sys, zipfile, zlib
from urllib.parse import quote

def hid(s): return hashlib.md5(s.encode()).hexdigest()
def nm(title): return f"{title} {hid(title)}"
def link(path): return "/".join(quote(p) for p in path.split("/"))

files = {}
eid = "0c5e1b7a-4f2d-4e1a-9b3c-7d8e9f0a1b2c"
root = f"Export-{eid}"  # as a real export: one root folder named for the export (Obsidian Importer tests/notion)
home = nm("Home")
sl = nm("Sketch log")

books = [
    ("The Overstory", "Richard Powers", "Read", "5", "Fiction, Nature", "March 2, 2026", "Trees as characters. Slow and huge."),
    ("Braiding Sweetgrass", "Robin Wall Kimmerer", "Reading", "", "Nature, Essays", "October 11, 2026", "Reading a chapter a week."),
    ("Steal Like an Artist", "Austin Kleon", "Read", "4", "Craft", "January 20, 2026", "Short. Good for a slump."),
    ("The Creative Act", "Rick Rubin", "Want to read", "", "Craft", "", ""),
    ("Piranesi", "Susanna Clarke", "Read", "5", "Fiction", "July 7, 2026", "The house, the tides. Reread it."),
]
projects = [
    ("Harbor Books cover", "Client", "In progress", "November 28, 2026", "Harbor Books", "Cover for a poetry book, three sketches first."),
    ("Zine: Night Birds", "Personal", "Idea", "", "", "Twelve pages, risograph, two colours."),
    ("Café menu illustrations", "Client", "Done", "September 15, 2026", "Little Fern Café", "Six spot illustrations, delivered as SVG."),
]
tasks = [
    ("Send Harbor Books three sketches", "Harbor Books cover", "November 24, 2026", "No"),
    ("Invoice Little Fern Café", "Café menu illustrations", "September 30, 2026", "Yes"),
    ("Pick paper for the zine", "Zine: Night Birds", "", "No"),
    ("Scan the owl drawings", "Zine: Night Birds", "December 5, 2026", "No"),
]
meetings = [("Kickoff with Harbor Books", "November 10, 2026", "Harbor Books cover",
             "Attendees: Dana (editor)\n\n## Notes\n\n- Muted blues, one bird.\n- Title type is theirs.\n\n## Next\n\n- Three sketches by the 24th.")]

def csv_rows(header, rows):
    out = io.StringIO()
    import csv
    w = csv.writer(out, lineterminator="\r\n")
    w.writerow(header); [w.writerow(r) for r in rows]
    return "﻿" + out.getvalue()

db = f"{root}/{home}"
# Reading list
rl = nm("Reading List")
files[f"{db}/{rl}.csv"] = csv_rows(["Name", "Author", "Status", "Rating", "Tags", "Finished", "Notes"],
                                   [list(b) for b in books if b[2] != "Want to read"])
files[f"{db}/{rl}_all.csv"] = csv_rows(["Name", "Author", "Status", "Rating", "Tags", "Finished", "Notes"], [list(b) for b in books])
for t, a, s, r, tg, f, n in books:
    props = [f"Author: {a}", f"Status: {s}"] + ([f"Rating: {r}"] if r else []) + [f"Tags: {tg}"] + ([f"Finished: {f}"] if f else [])
    body = f"# {t}\n\n" + "\n".join(props) + "\n\n" + (n + "\n" if n else "")
    files[f"{db}/{rl}/{nm(t)}.md"] = body
# Projects and Tasks (a relation between them)
pj, tk = nm("Projects"), nm("Tasks")
# a relation as current exports write it (2023 on): a notion.so link with the page's id; Projects' Tasks column below
# keeps the older relative-path form, so both are in the export
def url(t): return f"https://www.notion.so/{'-'.join(t.replace(':', '').split())}-{hid(t)}?pvs=21"
def pj_ref(p): return f"{p} ({url(p)})"
files[f"{db}/{pj}_all.csv"] = csv_rows(["Name", "Kind", "Status", "Due", "Client", "Tasks"],
    [[p, k, s, d, c, ", ".join(f"{t[0]} ({link(tk)}/{link(nm(t[0]))}.md)" for t in tasks if t[1] == p)] for p, k, s, d, c, _ in projects])
files[f"{db}/{pj}.csv"] = files[f"{db}/{pj}_all.csv"]
for p, k, s, d, c, n in projects:
    props = [f"Kind: {k}", f"Status: {s}"] + ([f"Due: {d}"] if d else []) + ([f"Client: {c}"] if c else [])
    files[f"{db}/{pj}/{nm(p)}.md"] = f"# {p}\n\n" + "\n".join(props) + f"\n\n{n}\n"
files[f"{db}/{tk}_all.csv"] = csv_rows(["Name", "Project", "Due", "Done"], [[t, pj_ref(p), d, x] for t, p, d, x in tasks])
files[f"{db}/{tk}.csv"] = files[f"{db}/{tk}_all.csv"]
for t, p, d, x in tasks:
    props = [f"Project: {pj_ref(p)}"] + ([f"Due: {d}"] if d else []) + [f"Done: {x}"]
    files[f"{db}/{tk}/{nm(t)}.md"] = f"# {t}\n\n" + "\n".join(props) + "\n"
# Meeting notes: a plain page under Home with a child page
mn = nm("Meeting notes")
files[f"{db}/{mn}.md"] = "# Meeting notes\n\n" + "\n".join(f"[{m[0]}]({link(mn + '/' + nm(m[0]))}.md)" for m in meetings) + "\n"
for t, d, p, body in meetings:
    files[f"{db}/{mn}/{nm(t)}.md"] = f"# {t}\n\nDate: {d}\nProject: {p} (../{link(pj)}/{link(nm(p))}.md)\n\n{body}\n"
# Ideas: a page with a to-do list, a callout-ish quote, and an image
files[f"{db}/{nm('Ideas')}.md"] = ("# Ideas\n\n> 💡 Draw every morning, even ten minutes.\n\n- [ ]  A print series of city birds\n"
    "- [x]  Ask the café about a wall piece\n- [ ]  Sticker sheet for the zine launch\n\n"
    f"![owl sketch]({link(nm('Ideas') + '/owl-sketch.png')})\n")
def owl_png(w=96, h=96):
    """A small owl drawn in code (a PNG big enough to see on the record): body, two eyes, a beak, ear tufts."""
    paper, body, belly, white, ink, beak = (250, 246, 238), (122, 92, 62), (196, 164, 120), (255, 255, 255), (40, 32, 24), (226, 150, 60)
    def px(x, y):
        dx, dy = (x - 48) / 30, (y - 56) / 36
        if dx * dx + dy * dy > 1:
            # ear tufts: two triangles above the head
            for ex in (30, 66):
                if 14 <= y <= 30 and abs(x - ex) <= (y - 14) / 2: return body
            return paper
        for ex in (37, 59):
            d = (x - ex) ** 2 + (y - 44) ** 2
            if d <= 16: return ink
            if d <= 100: return white
        if 44 <= x <= 52 and 52 <= y <= 60 and abs(x - 48) <= (60 - y) / 2 + 1: return beak
        return belly if ((x - 48) / 18) ** 2 + ((y - 72) / 16) ** 2 <= 1 else body
    raw = b"".join(b"\0" + bytes(c for x in range(w) for c in px(x, y)) for y in range(h))
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
files[f"{db}/{nm('Ideas')}/owl-sketch.png"] = owl_png()
# Home links to everything, the way Notion writes it
files[f"{root}/{home}.md"] = ("# Home\n\nMy studio, in one place.\n\n"
    f"[Reading List]({link(home + '/' + rl)}.csv)\n\n[Projects]({link(home + '/' + pj)}.csv)\n\n[Tasks]({link(home + '/' + tk)}.csv)\n\n"
    f"[Meeting notes]({link(home + '/' + mn)}.md)\n\n[Ideas]({link(home + '/' + nm('Ideas'))}.md)\n\n[Sketch log]({link(home + '/' + sl)}.csv)\n\n"
    f"[Open tasks]({link(home + '/' + nm('Open tasks'))}.csv)\n")
# a daily log: 70 rows (more than a frame's 60 reads in 10 s), its title a date mention as Notion writes one in the CSV;
# two of its pages are headed "@Today" and "@Yesterday" (relative mentions), so only their properties say which row they are
import datetime
days = [datetime.date(2026, 9, 13) + datetime.timedelta(days=i) for i in range(70)]
def mention(d): return f"@{d.strftime('%B')} {d.day}, {d.year}"
rows = [[mention(d) + " ", "Yes" if i % 3 else "No", str(10 + i % 50), "Owls" if i % 2 else "Herons"] for i, d in enumerate(days)]
files[f"{db}/{sl}_all.csv"] = csv_rows(["Day", "Drew", "Minutes", "Subject"], rows)
files[f"{db}/{sl}.csv"] = csv_rows(["Day", "Drew", "Minutes", "Subject"], rows[-14:])
for i, d in enumerate(days):
    title = "@Today" if i == 69 else "@Yesterday" if i == 68 else mention(d)
    page = f"# {title}\n\nDrew: {rows[i][1]}\nMinutes: {rows[i][2]}\nSubject: {rows[i][3]}\n"
    if i >= 68: page += f"\nDay {i + 1}: {'owl wings, three tries' if i == 69 else 'heron legs'}.\n"
    files[f"{db}/{sl}/{title} {hid(title + str(i))}.md"] = page
# odd titles a real workspace has: one ending like code, and pages nested deep with long names
files[f"{root}/{nm('Next.js notes')}.md"] = "# Next.js notes\n\nFor the portfolio site.\n"
deep = root
for t in ["Client archive for the years before I went freelance full time", "Harbor Books and the other small presses I worked with", "Every single draft cover with the notes from each round of feedback"]:
    deep = f"{deep}/{nm(t)}"
    files[f"{deep}.md"] = f"# {t}\n\nOld things.\n"
# a top-level page with a table in it
files[f"{root}/{nm('Rates')}.md"] = ("# Rates\n\n| Work | Price |\n| --- | --- |\n| Spot illustration | $180 |\n"
    "| Book cover | $1,200 |\n| Zine page | $90 |\n\nDeposits are half up front.\n")

files[f"{root}/index.html"] = "<html><body><p>Workspace name: Juno's studio</p></body></html>"
inner = io.BytesIO()
with zipfile.ZipFile(inner, "w", zipfile.ZIP_DEFLATED) as z:
    for p, c in sorted(files.items()):
        z.writestr(p, c if isinstance(c, bytes) else c.encode("utf-8"))
with zipfile.ZipFile(sys.argv[1], "w", zipfile.ZIP_STORED) as z:
    z.writestr(f"Export-{eid}-Part-1.zip", inner.getvalue())
print(sys.argv[1], len(files), "files")
