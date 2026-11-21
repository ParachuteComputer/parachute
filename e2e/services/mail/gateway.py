#!/usr/bin/env python3
# A COPY of the Uni app's mail gateway, for the services specs only (e2e/mail.spec.ts, e2e/services/README.md). The
# original runs on Uni's box; this copy differs only in: example hosts and addresses in the docs below, UNI_MAIL_HOST
# (the address it listens on, so it can run in a container) and a loopback default for "public_url". Keep it in step
# with the original when the app starts using a new gateway operation.
"""Mail bridge for the Uni app (T-45, writes T-210): Stalwart JMAP.

The app never holds a mail password. It signs each request with a Nostr key
(NIP-98, same scheme as the transcription service); this bridge checks the
signature against an allowlist, maps the key to one Stalwart principal and
forwards only read-only JMAP methods to Stalwart with that principal's
server-side credentials. Writes are never raw JMAP: they are named operations
(POST /mail/op) whose JMAP the bridge builds itself, after checking who may do
what on which account (T-210, "Writes" below).

POST /mail/session {}                         -> the key's JMAP session (mail accounts with a role) + "roles"   (v2)
POST /mail/jmap    {"calls": [[method, args, id], ...]}       -> JMAP methodResponses
POST /mail/raw     {"blobId": "...", "accountId": "..."}      -> the blob's bytes (text/plain)
POST /mail/triage                                             -> 404 until Uni's triage store exists
POST /mail/op      {"op": name, "accountId": id, ...}         -> the operation's result (T-210)

Accounts (v2): a call may name an accountId only if it is one of the key's session accounts that has a role, or the
key's own primary account (the one v1 read, so v1 clients keep working). Anything else is a 400. A missing accountId
means the primary account, as in v1. A key whose primary account has no role gets a 404 from /mail/session, which the
app reads as "v1 bridge: one account" and reads through /mail/jmap as before.

Writes (T-210). /mail/session lists, per account, the operations this key may run there ("operations"); the app
enables a write only when it is listed. Who may do what (the design note's table; Stalwart's ACL is the second wall):
  own account (either role): mark_seen, flag, archive, draft.save, draft.review, draft.discard, send, send.check
  owner key on Uni's account: mark_seen, flag, send_as_uni (the deputy path, under Uni's outbound rules), send.check,
                              send.approve and send.decline (a send parked for the owner: Uni's key never decides its own),
                              send.parked (read-only: the sends waiting for the owner there, with what each says; T-213)
  Uni key on the owner's account: draft.add_for_owner only (it never revises, discards or sends there)
draft.save also takes "attachments": [{name, type, base64}] (T-335; type optional): at most 10 files, 18 MB decoded
together, names cleaned, extensions and types from an allowlist (no type: the extension's, else
application/octet-stream).
The files are uploaded to the account and the draft is multipart/mixed; the fingerprint is of the whole message, so a
send binds to the files too, and every gate below applies as to any draft. A review lists the files (name, type, size,
SHA-256); "plain" stays false for such a draft. draft.add_for_owner and send_as_uni take no files.
Only the operations named in the config's "operations" list run at all; without it the bridge is read-only, as before.
Every send binds to the SHA-256 of the draft's raw message as reviewed, runs at most once per opId and once per draft
(a durable reservation in the ledger, SQLite), and passes the header check: exactly one From, equal to the submitting
account's identity, and Sender/Reply-To (if any) the same. Stalwart doesn't check the header From itself
(REPORT-MAILV2-GATES). Anything sent from a "uni" account first passes the outbound policy file: allow, refuse or
needs-aaron, default refuse. A needs-aaron send waits in Drafts, reserved, until the owner's key approves it (the same
draft, unchanged, submitted with every other check run again) or declines it (released; nothing is sent). Parking and
deciding each leave a JSON file in the config's "needs_aaron_spool" (no body), from which a user-uni timer makes and
closes Aaron's task (needs_aaron_tasks.py). The ledger also records each draft Uni's key adds to the owner's Drafts: "drafted by Uni"
comes from there, and the bridge rewrites the $uni-drafted keyword in every Email/get answer to match it.

Listens on 127.0.0.1 only; Tailscale Serve exposes it tailnet-only.
Config: ~/.config/uni/mail-bridge.json
  {"jmap": "https://127.0.0.1:8480", "public_url": "https://mail-gateway.example:8452",
   "public_aliases": ["https://old-name.example:8452"],
   "principals": {"owner@mail.example": {"password_file": "/path/to/secrets/owner"}},
   "keys": {"<hex pubkey>": "owner@mail.example"},
   "roles": {"owner@mail.example": "owner", "uni@mail.example": "uni"},
   "operations": {"owner@...": {"owner@...": ["mark_seen", ...], "uni@...": [...]}}, "ledger": "/path/to/ledger.sqlite3",
   "outbound_policy": "/path/to/outbound-policy.json", "owner_aliases": ["postmaster@...", ...],
   "needs_aaron_spool": "/path/to/needs-aaron"}
  "keys" maps each allowlisted key to one principal; an allowlisted key without a mapping is refused (403).
  "roles" is by principal (the JMAP account name): "owner" or "uni". Without "keys", every key reads the v1 pair
  "user" / "password_file". With "keys", that pair is ignored; the live config keeps it so that v1 code on this config
  still reads as v1 did (for an undo).
  "operations" lists the write operations that run, per (key's principal, account's principal) pair (absent, or any
  other shape such as a flat list: none). The role table still caps each pair. The deputy path (send_as_uni) and
  send.approve also need the Uni account's principal in "principals". "owner_aliases" are addresses (besides the owner accounts' own) that never appear
  in an identity header of mail from a "uni" account.
The app signs for the hub's host; "public_aliases" are the other names accepted (a renamed host, a pass-through).
Allowlist: ~/.config/uni/mail-allow (one hex pubkey per line).
"""
import base64
import binascii
import email
import email.header
import email.policy
import email.utils
import fcntl
import fnmatch
import hashlib
import json
import os
import re
import sqlite3
import sys
import ssl
import threading
import time
import unicodedata
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from coincurve import PublicKeyXOnly

PORT = int(os.environ.get("UNI_MAIL_PORT", "1951"))
CONF = Path.home() / ".config/uni/mail-bridge.json"
ALLOW_FILE = Path.home() / ".config/uni/mail-allow"
MAX_BODY = 64 * 1024
MAX_OP_BODY = 28 * 1024 * 1024  # a /mail/op request may carry draft.save's attachments (18 MB as base64, plus the rest)
MAX_RAW = 30 * 1024 * 1024
MAIL = "urn:ietf:params:jmap:mail"
ROLES = {"owner", "uni"}
SESSION_TTL = 60  # seconds; a share added or revoked in Stalwart shows up here within a minute
# Read-only JMAP surface. Anything else (set/import/submission/copy) is refused.
READ_METHODS = {
    "Mailbox/get", "Mailbox/query", "Mailbox/changes",
    "Email/get", "Email/query", "Email/changes", "Email/queryChanges",
    "Thread/get", "Thread/changes", "SearchSnippet/get", "Identity/get",
}
SEEN: dict[str, float] = {}
SEEN_LOCK = threading.Lock()
_sessions: dict[str, tuple[float, dict]] = {}
_session_lock = threading.Lock()
CTX = ssl._create_unverified_context()  # Stalwart's cert is self-signed; loopback only


class Forbidden(Exception):
    """A signed, allowlisted key that the principal map gives no mailbox (403)."""


class NotFound(Exception):
    """404: a path the bridge doesn't serve, or a session without roles (the app then reads it as a v1 bridge)."""


class Conflict(Exception):
    """409: the operation is allowed but the mail isn't in the state it needs (changed, reserved by a send, gone)."""


def conf() -> dict:
    c = json.loads(CONF.read_text())
    c.setdefault("jmap", "https://127.0.0.1:8480")
    c.setdefault("public_url", f"http://127.0.0.1:{PORT}")
    c.setdefault("public_aliases", [])
    return c


def public_urls(c: dict) -> list[str]:
    return [c["public_url"], *c["public_aliases"]]


def allowed() -> set[str]:
    if not ALLOW_FILE.exists():
        return set()
    lines = (l.split("#")[0].strip().lower() for l in ALLOW_FILE.read_text().splitlines())
    return {l for l in lines if len(l) == 64}


def nip98_event(header: str, urls: list[str]) -> dict:
    """The signed event in a NIP-98 header, if it is well formed, signed, fresh and for one of `urls` (not yet: the
    payload, the allowlist, replay)."""
    if not header.startswith("Nostr "):
        raise ValueError("missing Nostr authorization")
    ev = json.loads(base64.b64decode(header[6:] + "=" * (-len(header[6:]) % 4), altchars=b"-_"))
    if ev.get("kind") != 27235:
        raise ValueError("wrong kind")
    ser = json.dumps([0, ev["pubkey"], ev["created_at"], ev["kind"], ev["tags"], ev["content"]],
                     separators=(",", ":"), ensure_ascii=False).encode()
    if hashlib.sha256(ser).hexdigest() != ev["id"]:
        raise ValueError("bad event id")
    if not PublicKeyXOnly(bytes.fromhex(ev["pubkey"])).verify(bytes.fromhex(ev["sig"]), bytes.fromhex(ev["id"])):
        raise ValueError("bad signature")
    if abs(time.time() - ev["created_at"]) > 120:
        raise ValueError("stale authorization")
    tags = {t[0]: t[1] for t in ev["tags"] if len(t) >= 2}
    if tags.get("u") not in urls or tags.get("method", "").upper() != "POST":
        raise ValueError("authorization is for a different request")
    return ev


def verify_nip98(header: str, urls: list[str], body: bytes) -> str:
    ev = nip98_event(header, urls)
    tags = {t[0]: t[1] for t in ev["tags"] if len(t) >= 2}
    if tags.get("payload") != hashlib.sha256(body).hexdigest():
        raise ValueError("payload hash mismatch")
    if ev["pubkey"].lower() not in allowed():
        raise ValueError("pubkey not allowed")
    now = time.time()
    with SEEN_LOCK:
        for k in [k for k, t in SEEN.items() if now - t > 300]:
            del SEEN[k]
        if ev["id"] in SEEN:
            raise ValueError("replayed authorization")
        SEEN[ev["id"]] = now
    return ev["pubkey"].lower()


def principal(c: dict, pubkey: str) -> tuple[str, str]:
    """The Stalwart principal this key reads as, and its password file."""
    if "keys" not in c:
        return c["user"], c["password_file"]
    user = next((v for k, v in c["keys"].items() if k.lower() == pubkey), None)
    name, p = next(((n, p) for n, p in (c.get("principals") or {}).items() if user and n.lower() == user.lower()),
                   (None, None))
    if not p or not p.get("password_file"):
        raise Forbidden("pubkey has no mailbox")
    return name, p["password_file"]


def auth_header(user: str, password_file: str) -> str:
    pw = Path(os.path.expanduser(password_file)).read_text().strip()
    return "Basic " + base64.b64encode(f"{user}:{pw}".encode()).decode()


def session(c: dict, user: str, password_file: str) -> dict:
    """The principal's JMAP session, mail accounts only: {"primary": id, "accounts": {id: account}}."""
    with _session_lock:
        hit = _sessions.get(user)
    if hit and time.monotonic() - hit[0] < SESSION_TTL:
        return hit[1]
    # fetched outside the lock, so a slow Stalwart holds up only this key's request
    req = urllib.request.Request(c["jmap"] + "/jmap/session", headers={"Authorization": auth_header(user, password_file)})
    s = json.load(urllib.request.urlopen(req, context=CTX, timeout=15))
    accounts = {i: a for i, a in s["accounts"].items() if MAIL in (a.get("accountCapabilities") or {})}
    primary = s["primaryAccounts"].get(MAIL)
    if primary not in accounts:
        raise Forbidden("this key's principal has no mail account")
    out = {"primary": primary, "accounts": accounts}
    with _session_lock:
        _sessions[user] = (time.monotonic(), out)
    return out


def roles(c: dict, s: dict) -> dict[str, str]:
    """{accountId: role} for the session's accounts whose name the principal map gives a role. Others are left out."""
    by_name = {n.lower(): r for n, r in (c.get("roles") or {}).items() if r in ROLES}
    return {i: by_name[a["name"].lower()] for i, a in s["accounts"].items()
            if isinstance(a.get("name"), str) and a["name"].lower() in by_name}


def account_for(s: dict, r: dict[str, str], requested) -> str:
    """The account a call reads: the primary if none is named, else one with a role (r) or the primary itself."""
    if requested is None:
        return s["primary"]
    if isinstance(requested, str) and (requested == s["primary"] or requested in r):
        return requested
    raise ValueError("account not in this key's session")


def mail_session(c: dict, user: str, password_file: str) -> dict:
    s = session(c, user, password_file)
    r = roles(c, s)
    if s["primary"] not in r:
        raise NotFound("no roles for this key's mailbox")
    accounts = {i: {"name": a["name"], "isPersonal": bool(a.get("isPersonal")),
                    "accountCapabilities": {MAIL: a["accountCapabilities"][MAIL]}}
                for i, a in s["accounts"].items() if i in r}
    return {"account": user, "primaryAccounts": {MAIL: s["primary"]}, "accounts": accounts, "roles": r,
            "operations": {i: sorted(o) for i, o in operations(c, s, r).items() if o}}


def jmap(c: dict, user: str, password_file: str, calls) -> dict:
    if not isinstance(calls, list):
        raise ValueError("malformed method call")
    s = session(c, user, password_file)
    r = roles(c, s)
    clean = []
    for call in calls:
        if not (isinstance(call, list) and len(call) == 3 and isinstance(call[1], dict)):
            raise ValueError("malformed method call")
        name, args, cid = call
        # Principal/* is never in READ_METHODS; named here too because it lists every principal on the server
        # (REPORT-MAILV2-SERVER.md section 4, item 4).
        if not isinstance(name, str) or name.startswith("Principal/") or name not in READ_METHODS:
            raise ValueError(f"method not allowed (read-only bridge): {name}")
        if "#accountId" in args:  # a back-reference could name an account the check below never saw
            raise ValueError("accountId must be given directly")
        args = {**args, "accountId": account_for(s, r, args.get("accountId"))}
        clean.append([name, args, str(cid)])
    body = json.dumps({"using": ["urn:ietf:params:jmap:core", MAIL], "methodCalls": clean}).encode()
    req = urllib.request.Request(c["jmap"] + "/jmap/", data=body,
                                 headers={"Authorization": auth_header(user, password_file),
                                          "Content-Type": "application/json"})
    out = json.load(urllib.request.urlopen(req, context=CTX, timeout=30))
    return {"account": user, "methodResponses": with_provenance(c, out.get("methodResponses", []))}


def raw(c: dict, user: str, password_file: str, blob_id: str, account_id) -> bytes:
    if not blob_id or any(ch in blob_id for ch in "/?#{} "):
        raise ValueError("bad blobId")
    s = session(c, user, password_file)
    account = account_for(s, roles(c, s), account_id)
    url = f"{c['jmap']}/jmap/download/{account}/{blob_id}/message.eml?accept=text/plain"
    req = urllib.request.Request(url, headers={"Authorization": auth_header(user, password_file)})
    with urllib.request.urlopen(req, context=CTX, timeout=30) as r:
        data = r.read(MAX_RAW + 1)
    if len(data) > MAX_RAW:
        raise ValueError("message too large")
    return data


# ── Writes (T-210): named operations ─────────────────────────────────────────────────────────────────────────────────
# The client never sends JMAP that writes. Each operation below checks the key's role on the account named, checks every
# email id against that account (and the mailbox the operation expects), and builds its own Email/set or
# EmailSubmission/set. The design note (t45-design/DESIGN.md, "Who may do what" and "The submission contract") is the
# spec; the step numbers below are its.

SUBMISSION = "urn:ietf:params:jmap:submission"
OPS_OWN = {"mark_seen", "flag", "archive", "draft.save", "draft.review", "draft.discard", "send", "send.check"}
OPS_OWNER_ON_UNI = {"mark_seen", "flag", "send_as_uni", "send.check", "send.approve", "send.decline", "send.parked"}
OPS_UNI_ON_OWNER = {"draft.add_for_owner"}
MAX_IDS = 100
MAX_RCPTS = 50
MAX_TEXT = 48 * 1024
MAX_SUBJECT = 300
MAX_NAME = 100
OP_ID = re.compile(r"[A-Za-z0-9_-]{16,64}")
FINGERPRINT = re.compile(r"[0-9a-f]{64}")
EMAIL = re.compile(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+")
FIELDS = {"to", "cc", "bcc", "subject", "text", "inReplyTo"}
# draft.save's attachments (T-335): [{name, type, base64}]. The decoded files together are at most MAX_ATTACH_TOTAL:
# base64 in the sent message makes that about 24.7 MB, under the 25 MB many receiving servers take, and under MAX_RAW,
# which every later read (review, send) downloads.
MAX_ATTACHMENTS = 10
MAX_ATTACH_TOTAL = 18 * 1024 * 1024
MAX_FILENAME = 100
# a file's name ends in one of these extensions, or has none (a mail client opens a file by its name, whatever type it
# claims); its type is one of these types (parameters dropped), or without a type the one its extension gives, else
# application/octet-stream
ATTACH_TYPES = {
    ".csv": "text/csv", ".txt": "text/plain", ".md": "text/markdown", ".ics": "text/calendar", ".json": "application/json",
    ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
    ".webp": "image/webp", ".heic": "image/heic",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".ods": "application/vnd.oasis.opendocument.spreadsheet", ".odt": "application/vnd.oasis.opendocument.text",
}
ATTACH_DEFAULT = "application/octet-stream"
# what each operation takes besides op and accountId; anything else is refused, never ignored
ARGS = {"mark_seen": {"emailIds", "seen"}, "flag": {"emailIds", "flagged"}, "archive": {"emailIds"},
        "draft.save": {"fields", "replaces", "base", "attachments"}, "draft.review": {"draftId"}, "draft.discard": {"draftId"},
        "draft.add_for_owner": {"fields"}, "send": {"opId", "draftId", "fingerprint", "discard"},
        "send_as_uni": {"opId", "fields"}, "send.check": {"opId"}, "send.approve": {"opId", "fingerprint"},
        "send.decline": {"opId"}, "send.parked": set()}
# a reservation in one of these states is over: its draft may be replaced or discarded again. A row that reached
# "submitting" never gets here; it ends in submitted/cleaned, failed or unknown. "declined": the owner said no to a
# needs-aaron send.
RELEASED = ("refused", "declined")
# one write to a draft at a time (send, replace, discard): a second request for the same draft waits, then sees the
# first's reservation. The ledger's process lock (Ledger) keeps it to one bridge process.
SEND_LOCK = threading.Lock()
_ledgers: dict[str, "Ledger"] = {}
_ledgers_lock = threading.Lock()

_RELEASED_SQL = ", ".join(f"'{state}'" for state in RELEASED)
LEDGER_SCHEMA = f"""
CREATE TABLE IF NOT EXISTS uni_drafts (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL, email_id TEXT NOT NULL, thread_id TEXT,
  rank INTEGER NOT NULL, origin TEXT, created_at REAL NOT NULL, UNIQUE (account_id, email_id));
CREATE TABLE IF NOT EXISTS sends (
  id INTEGER PRIMARY KEY AUTOINCREMENT, op_id TEXT NOT NULL UNIQUE, op TEXT NOT NULL, actor TEXT NOT NULL,
  account_id TEXT NOT NULL, draft_id TEXT, internal INTEGER NOT NULL DEFAULT 0, fingerprint TEXT,
  request_hash TEXT NOT NULL, discard TEXT NOT NULL DEFAULT '[]', state TEXT NOT NULL, reason TEXT, submission_id TEXT,
  alias_of TEXT, created_at REAL NOT NULL, updated_at REAL NOT NULL,
  decision TEXT, decided_by TEXT, decided_at REAL, notice TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS sends_one_live_per_draft ON sends (account_id, draft_id)
  WHERE draft_id IS NOT NULL AND state NOT IN ({_RELEASED_SQL});
"""
# columns added after the first deploy (T-210 approval): an older ledger gets them on open
LEDGER_ADDED = {"decision": "TEXT", "decided_by": "TEXT", "decided_at": "REAL", "notice": "TEXT"}


class Refused(Exception):
    """A send's checks or the outbound rules said no: the reservation ends as refused(reason), nothing was submitted."""


class Upstream(Exception):
    """Stalwart answered a write with a method error (so it did nothing)."""


class Ledger:
    """The bridge's durable store: which drafts Uni's key made (provenance) and one row per send (the reservation)."""

    def __init__(self, path: str):
        self.path = path
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        # one bridge process owns the ledger: recovery below is only safe when no other process is mid-send
        self._lock = open(path + ".lock", "a")
        try:
            fcntl.flock(self._lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self._lock.close()
            raise RuntimeError("another bridge process holds the ledger")
        init = sqlite3.connect(path, timeout=30, isolation_level=None)
        try:
            have = {r[1] for r in init.execute("PRAGMA table_info(sends)")}
            if have:  # an older ledger: its new columns first, so the index below can be built
                for col, kind in LEDGER_ADDED.items():
                    if col not in have:
                        init.execute(f"ALTER TABLE sends ADD COLUMN {col} {kind}")
            init.executescript(LEDGER_SCHEMA)
            init.execute("DROP INDEX IF EXISTS sends_one_per_draft")  # the old index, which didn't release "declined"
        finally:
            init.close()
        with self.db() as db:
            now = time.time()
            # crash recovery: submission happens only after "submitting" is committed, so a row still reserved (or still
            # making its internal draft) was never submitted; one left in "submitting" is uncertain
            db.execute("UPDATE sends SET state='refused', reason='interrupted', updated_at=? WHERE state IN ('reserved', 'drafting')", (now,))
            db.execute("UPDATE sends SET state='unknown', updated_at=? WHERE state='submitting'", (now,))

    def close(self) -> None:
        """Release the process lock (a stopped bridge; tests)."""
        self._lock.close()

    def db(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.path, timeout=30, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA synchronous=FULL")
        return _Tx(db)

    # provenance

    def uni_drafted(self, account: str, ids) -> set:
        ids = list(ids)
        if not ids:
            return set()
        with self.db() as db:
            q = f"SELECT email_id FROM uni_drafts WHERE account_id=? AND email_id IN ({','.join('?' * len(ids))})"
            return {r[0] for r in db.execute(q, (account, *ids))}

    def add_uni_draft(self, account: str, email_id: str, thread_id, origin=None) -> None:
        with self.db() as db:
            rank = None
            if origin:
                r = db.execute("SELECT rank FROM uni_drafts WHERE account_id=? AND email_id=?", (account, origin)).fetchone()
                rank = r[0] if r else None
            cur = db.execute("INSERT OR IGNORE INTO uni_drafts (account_id, email_id, thread_id, rank, origin, created_at) "
                             "VALUES (?, ?, ?, -1, ?, ?)", (account, email_id, thread_id, origin, time.time()))
            # a new draft ranks by its own creation; one saved over a Uni draft keeps that draft's place
            db.execute("UPDATE uni_drafts SET rank=? WHERE seq=? AND rank=-1", (rank if rank is not None else cur.lastrowid, cur.lastrowid))

    def rank(self, account: str, email_id: str):
        with self.db() as db:
            r = db.execute("SELECT rank FROM uni_drafts WHERE account_id=? AND email_id=?", (account, email_id)).fetchone()
            return r[0] if r else None

    def older_uni_drafts(self, account: str, thread_id: str, rank: int) -> list[str]:
        with self.db() as db:
            return [r[0] for r in db.execute("SELECT email_id FROM uni_drafts WHERE account_id=? AND thread_id=? AND rank<? "
                                             "ORDER BY rank", (account, thread_id, rank))]

    # sends

    def by_op(self, op_id: str):
        with self.db() as db:
            return db.execute("SELECT * FROM sends WHERE op_id=?", (op_id,)).fetchone()

    def active_for_draft(self, account: str, draft_id: str):
        with self.db() as db:
            return db.execute(f"SELECT * FROM sends WHERE account_id=? AND draft_id=? AND state NOT IN ({_RELEASED_SQL})",
                              (account, draft_id)).fetchone()

    def insert(self, **row) -> None:
        now = time.time()
        row = {**row, "created_at": now, "updated_at": now}
        with self.db() as db:
            db.execute(f"INSERT INTO sends ({', '.join(row)}) VALUES ({', '.join('?' * len(row))})", tuple(row.values()))

    def update(self, op_id: str, **fields) -> None:
        fields["updated_at"] = time.time()
        with self.db() as db:
            db.execute(f"UPDATE sends SET {', '.join(f'{k}=?' for k in fields)} WHERE op_id=?", (*fields.values(), op_id))

    def awaiting(self, account: str) -> list:
        """The sends on `account` waiting for the owner, oldest first."""
        with self.db() as db:
            return db.execute("SELECT * FROM sends WHERE account_id=? AND state='awaiting-approval' AND alias_of IS NULL "
                              "ORDER BY created_at, id", (account,)).fetchall()

    def noticed(self) -> list:
        """Every send that was parked for the owner (it has a notice, or it waits without one), for the spool files."""
        with self.db() as db:
            return db.execute("SELECT * FROM sends WHERE notice IS NOT NULL OR (state='awaiting-approval' AND alias_of IS NULL)").fetchall()


class _Tx:
    """A connection used as `with ledger.db() as db:` — one transaction, committed on success, closed either way."""

    def __init__(self, db):
        self._db = db

    def __enter__(self):
        self._db.execute("BEGIN IMMEDIATE")
        return self._db

    def __exit__(self, kind, *_):
        try:
            self._db.execute("ROLLBACK" if kind else "COMMIT")
        finally:
            self._db.close()

    def execute(self, *a):  # outside a transaction (PRAGMAs)
        return self._db.execute(*a)


def ledger(c: dict) -> Ledger:
    path = c.get("ledger") or str(Path.home() / ".local/state/uni-mail-bridge/ledger.sqlite3")
    with _ledgers_lock:
        if path not in _ledgers:
            _ledgers[path] = Ledger(path)
            spool_sync(c, _ledgers[path])
        return _ledgers[path]


# ── The owner's task for a parked send: spool files ─────────────────────────────────────────────────────────────────
# The bridge (uni-mail) can't write Aaron's vault. It leaves one file per parked send, <opId>.json (what is waiting
# and why; never the body), and one more, <opId>.done.json, when the owner decides it. needs_aaron_tasks.py (user uni,
# a timer) makes the task from the first and closes it on the second. The dir is uni-mail:uni 2750, files 0640.

def spool(c: dict, name: str, data: dict) -> None:
    """Write one spool file atomically. A failure is logged, never fatal: the ledger holds the notice, and the next
    bridge start writes any file that is missing (spool_sync)."""
    d = c.get("needs_aaron_spool")
    if not d:
        return
    path = Path(d) / name
    tmp = path.with_name(f".{name}.tmp")
    try:
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o640)
        try:
            os.fchmod(fd, 0o640)  # the unit's UMask is 0077; user uni reads these through the group
            os.write(fd, json.dumps(data, indent=1, ensure_ascii=False).encode() + b"\n")
            os.fsync(fd)
        finally:
            os.close(fd)
        os.replace(tmp, path)
    except OSError as e:
        sys.stderr.write(f"needs-aaron spool: {name}: {type(e).__name__} {e.strerror or ''}\n")


def iso(t: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t))


def decided(row) -> dict:
    return {"opId": row["op_id"], "accountId": row["account_id"], "decision": row["decision"], "decidedBy": row["decided_by"],
            "decidedAt": iso(row["decided_at"]) if row["decided_at"] else None, "state": row["state"], "reason": row["reason"]}


def spool_sync(c: dict, led: Ledger) -> None:
    """At start: a file for every parked send that lacks one (a write that failed, a crash between the ledger and the
    file). Decided sends get their .done file; the .json is written first so the timer sees the pair in order."""
    d = c.get("needs_aaron_spool")
    if not d:
        return
    try:
        rows = led.noticed()
    except Exception as e:
        sys.stderr.write(f"needs-aaron spool sync: {type(e).__name__}\n")
        return
    for row in rows:
        if not row["notice"]:  # parked before the spool existed: its notice from the stored draft
            try:
                notice_for(c, led, row)
            except Exception as e:
                sys.stderr.write(f"needs-aaron spool sync: {row['op_id']}: no notice ({type(e).__name__}: {str(e)[:200]})\n")
            continue
        if not (Path(d) / f"{row['op_id']}.json").exists():
            spool(c, f"{row['op_id']}.json", json.loads(row["notice"]))
        if row["decision"] and not (Path(d) / f"{row['op_id']}.done.json").exists():
            spool(c, f"{row['op_id']}.done.json", decided(row))


def park_notice(row, address: str, rcpts: list[str], blob: bytes, why: str) -> dict:
    """What the owner's task says about a parked send: who it is to, its subject, why it waits. No body."""
    try:
        subject = str(email.message_from_bytes(blob, policy=email.policy.default).get("Subject") or "")
    except Exception:
        subject = ""
    subject = " ".join(subject.split())[:MAX_SUBJECT]
    return {"opId": row["op_id"], "account": address, "accountId": row["account_id"], "draftId": row["draft_id"],
            "fingerprint": row["fingerprint"], "recipients": rcpts, "subject": subject, "reason": why,
            "sentBy": "owner, as Uni" if row["op"] == "send_as_uni" else "Uni", "time": iso(time.time())}


def with_provenance(c: dict, responses: list) -> list:
    """Every Email/get answer's $uni-drafted keyword, set from the ledger: shown only on drafts Uni's key made (or saved
    over one), whatever the stored keyword says. Without a ledger (none yet, or it can't be opened) no message is marked."""
    try:
        led = ledger(c)
    except Exception:
        led = None
    for r in responses:
        if not (isinstance(r, list) and len(r) == 3 and r[0] == "Email/get" and isinstance(r[1], dict)):
            continue
        emails = [e for e in r[1].get("list") or [] if isinstance(e, dict) and isinstance(e.get("keywords"), dict)]
        made = led.uni_drafted(r[1].get("accountId"), [e.get("id") for e in emails if isinstance(e.get("id"), str)]) if led else set()
        for e in emails:
            e["keywords"].pop("$uni-drafted", None)
            if e.get("id") in made:
                e["keywords"]["$uni-drafted"] = True
    return responses


def operations(c: dict, s: dict, r: dict[str, str]) -> dict[str, set]:
    """{accountId: operations this key may run there}: the role table, cut to the config's "operations".

    "operations" is per pair: {key's principal: {account's principal: [ops]}}, so each capability set (the owner on
    their own account, the owner on Uni's, Uni on its own, Uni on the owner's) turns on by itself. Any other shape (the old flat list included) runs
    nothing: a single list would switch every account on at once."""
    table = c.get("operations")
    own = s["primary"]
    names = {i: str(a.get("name", "")).lower() for i, a in s["accounts"].items()}
    if isinstance(table, dict):
        mine_ops = {str(k).lower(): v for k, v in table.items()}.get(names.get(own, ""))
        mine_ops = {str(k).lower(): v for k, v in mine_ops.items()} if isinstance(mine_ops, dict) else {}
    else:
        mine_ops = {}
    mine = r.get(own)
    out = {}
    for acct, role in r.items():
        if acct == own:
            ops = set(OPS_OWN)
        elif mine == "owner" and role == "uni":
            ops = set(OPS_OWNER_ON_UNI)
            if not deputy(c, s, acct):  # these submit or read submissions as Uni's own principal
                ops -= {"send_as_uni", "send.check", "send.approve"}
        elif mine == "uni" and role == "owner":
            ops = set(OPS_UNI_ON_OWNER)
        else:
            ops = set()
        enabled = mine_ops.get(names.get(acct, ""))
        out[acct] = ops & set(enabled) if isinstance(enabled, list) else set()
    return out


def deputy(c: dict, s: dict, acct: str):
    """The Uni account's own principal and password file, for the deputy path; None if the config holds none."""
    name = s["accounts"].get(acct, {}).get("name")
    p = next((p for n, p in (c.get("principals") or {}).items() if isinstance(name, str) and n.lower() == name.lower()), None)
    return (name, p["password_file"]) if p and p.get("password_file") else None


def upstream(c: dict, cred: tuple[str, str], calls: list, submission: bool = False) -> list:
    """One JMAP request to Stalwart as `cred`; the method responses. A method error raises Upstream (nothing was done)."""
    using = ["urn:ietf:params:jmap:core", MAIL] + ([SUBMISSION] if submission else [])
    body = json.dumps({"using": using, "methodCalls": calls}).encode()
    req = urllib.request.Request(c["jmap"] + "/jmap/", data=body,
                                 headers={"Authorization": auth_header(*cred), "Content-Type": "application/json"})
    out = json.load(urllib.request.urlopen(req, context=CTX, timeout=30)).get("methodResponses", [])
    for name, args, _ in out:
        if name == "error":
            raise Upstream(f"{args.get('type', 'error')} {args.get('description', '')}".strip())
    return out


def answer(responses: list, name: str, cid: str) -> dict:
    for n, args, i in responses:
        if n == name and i == cid:
            return args
    raise Upstream(f"no {name} answer")


def set_ok(responses: list, cid: str, kind: str, ids) -> None:
    """Every id in an Email/set answer's `kind` (created/updated/destroyed) went through; otherwise say why not."""
    a = answer(responses, "Email/set", cid)
    failed = a.get("not" + kind.capitalize()) or {}
    if failed:
        first = next(iter(failed.values())) or {}
        raise Conflict(f"the mail server refused it: {first.get('type', 'error')} {first.get('description', '')}".strip())


def download(c: dict, cred: tuple[str, str], account: str, blob_id: str) -> bytes:
    url = f"{c['jmap']}/jmap/download/{account}/{blob_id}/message.eml?accept=text/plain"
    req = urllib.request.Request(url, headers={"Authorization": auth_header(*cred)})
    with urllib.request.urlopen(req, context=CTX, timeout=30) as r:
        data = r.read(MAX_RAW + 1)
    if len(data) > MAX_RAW:
        raise ValueError("message too large")
    return data


def emails(c: dict, cred, account: str, ids: list[str], props: list[str]) -> dict[str, dict]:
    r = upstream(c, cred, [["Email/get", {"accountId": account, "ids": ids, "properties": ["id", *props]}, "g"]])
    return {e["id"]: e for e in answer(r, "Email/get", "g").get("list") or []}


def boxes(c: dict, cred, account: str) -> dict[str, str]:
    """{role: mailbox id} for the account."""
    r = upstream(c, cred, [["Mailbox/get", {"accountId": account, "ids": None, "properties": ["id", "role"]}, "m"]])
    return {b["role"]: b["id"] for b in answer(r, "Mailbox/get", "m").get("list") or [] if b.get("role")}


def identity(c: dict, cred, account: str, address: str) -> dict:
    """The submitting account's identity for its own address (Identity/get as that principal)."""
    r = upstream(c, cred, [["Identity/get", {"accountId": account, "ids": None}, "i"]], submission=True)
    for i in answer(r, "Identity/get", "i").get("list") or []:
        if str(i.get("email", "")).lower() == address.lower():
            return i
    raise Refused(f"no sending identity for {address}")


def fingerprint(blob: bytes) -> str:
    return hashlib.sha256(blob).hexdigest()


def ids_arg(v, what="emailIds") -> list[str]:
    if not isinstance(v, list) or not v or len(v) > MAX_IDS:
        raise ValueError(f"{what}: one to {MAX_IDS} ids")
    for i in v:
        check_id(i)
    return list(dict.fromkeys(v))


def check_id(v) -> str:
    if not isinstance(v, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,255}", v):
        raise ValueError("bad mail id")
    return v


def plain(v, what: str, most: int) -> str:
    if v is None:
        return ""
    if not isinstance(v, str) or len(v) > most or any(ord(ch) < 32 or ord(ch) == 127 for ch in v):
        raise ValueError(f"{what}: plain text on one line, at most {most} characters")
    return v.strip()


def addresses_arg(v, what: str) -> list[dict]:
    out = []
    for a in v or []:
        if not isinstance(a, dict) or set(a) - {"name", "email"}:
            raise ValueError(f"{what}: each address is {{name, email}}")
        addr = a.get("email")
        if not isinstance(addr, str) or len(addr) > 254 or not EMAIL.fullmatch(addr):
            raise ValueError(f"{what}: not an email address")
        name = plain(a.get("name"), f"{what} name", MAX_NAME)
        out.append({"email": addr, **({"name": name} if name else {})})
    return out


def fields_arg(f) -> dict:
    """A message's structured fields. There is no From: the bridge sets it from the account."""
    if not isinstance(f, dict) or set(f) - FIELDS:
        raise ValueError(f"fields: only {', '.join(sorted(FIELDS))}")
    out = {k: addresses_arg(f.get(k), k) for k in ("to", "cc", "bcc")}
    if sum(len(v) for v in out.values()) > MAX_RCPTS:
        raise ValueError(f"at most {MAX_RCPTS} recipients")
    out["subject"] = plain(f.get("subject"), "subject", MAX_SUBJECT)
    text = f.get("text") or ""
    if not isinstance(text, str) or len(text.encode()) > MAX_TEXT or "\0" in text:
        raise ValueError(f"text: at most {MAX_TEXT // 1024} KB")
    out["text"] = text.replace("\r\n", "\n").replace("\r", "\n")
    out["inReplyTo"] = check_id(f["inReplyTo"]) if f.get("inReplyTo") is not None else None
    return out


def attachment_name(v) -> str:
    """A file's name as the recipient will see it: the last path segment, no control, format (bidi) or separator
    characters, none of <>:"|?*, no leading or trailing dots, at most MAX_FILENAME characters (the extension kept),
    and an extension from ATTACH_TYPES or none, so nothing that runs or renders when opened."""
    if not isinstance(v, str) or len(v) > 1000:
        raise ValueError("attachments: each needs a name")
    n = unicodedata.normalize("NFC", v).replace("\\", "/").rsplit("/", 1)[-1]
    n = "".join("_" if ch in '<>:"|?*' or unicodedata.category(ch) in ("Cc", "Cf", "Cs", "Co", "Cn", "Zl", "Zp") else ch for ch in n)
    n = " ".join(n.split()).strip(". ")
    ext = name_ext(n)
    if len(n) > MAX_FILENAME:
        n = n[:MAX_FILENAME - len(ext)].rstrip(". ") + ext
    if not n or n == ext:
        raise ValueError("attachments: a name with no usable characters")
    ext = name_ext(n)  # of the name as it will be sent
    if ext and ext not in ATTACH_TYPES:
        raise ValueError(f"attachments: {ext} files aren't sent (only {', '.join(sorted(ATTACH_TYPES))}, or no extension)")
    return n


def name_ext(n: str) -> str:
    stem, dot, ext = n.rpartition(".")
    return f".{ext.lower()}" if dot and stem else ""


def attachment_type(v, name: str) -> str:
    """The file's media type: one of ATTACH_TYPES' (or the default), never a type a mail client renders as a page."""
    if v is None or v == "":
        return ATTACH_TYPES.get(name_ext(name), ATTACH_DEFAULT)
    t = v.split(";", 1)[0].strip().lower() if isinstance(v, str) else None
    if t not in {*ATTACH_TYPES.values(), ATTACH_DEFAULT}:
        raise ValueError(f"attachments: {name}: type must be one of {', '.join(sorted({*ATTACH_TYPES.values(), ATTACH_DEFAULT}))}")
    return t


def attachments_arg(v) -> list[dict]:
    """draft.save's files, [{name, type, base64}] (type optional): [{name, type, data}], every check done before
    anything is written. At most MAX_ATTACHMENTS files, MAX_ATTACH_TOTAL bytes together, none empty."""
    if v is None:
        return []
    if not isinstance(v, list) or len(v) > MAX_ATTACHMENTS:
        raise ValueError(f"attachments: a list of at most {MAX_ATTACHMENTS} files")
    out, total = [], 0
    for a in v:
        if not isinstance(a, dict) or set(a) - {"name", "type", "base64"} or not isinstance(a.get("base64"), str):
            raise ValueError("attachments: each is {name, type, base64}")
        name = attachment_name(a.get("name"))
        kind = attachment_type(a.get("type"), name)
        if len(a["base64"]) > 2 * MAX_ATTACH_TOTAL:
            raise ValueError(f"attachments: at most {MAX_ATTACH_TOTAL // (1024 * 1024)} MB together")
        try:
            data = base64.b64decode("".join(a["base64"].split()), validate=True)
        except (binascii.Error, ValueError):
            raise ValueError(f"attachments: {name}: base64 is not valid")
        if not data:
            raise ValueError(f"attachments: {name} is empty")
        total += len(data)
        if total > MAX_ATTACH_TOTAL:
            raise ValueError(f"attachments: at most {MAX_ATTACH_TOTAL // (1024 * 1024)} MB together")
        out.append({"name": name, "type": kind, "data": data})
    return out


def uploaded(c: dict, cred, account: str, files: list) -> list[dict]:
    """attachments_arg's files, uploaded to the account: the JMAP attachments of a draft (Email/set create)."""
    return [{"blobId": upload(c, cred, account, f["data"], f["type"]), "type": f["type"], "name": f["name"],
             "disposition": "attachment", **({"charset": "utf-8"} if f["type"].startswith("text/") and utf8(f["data"]) else {})}
            for f in files]


def upload(c: dict, cred, account: str, data: bytes, kind: str) -> str:
    """One file into the account's blob store (JMAP upload); its blobId. A short or odd answer is an Upstream."""
    req = urllib.request.Request(f"{c['jmap']}/jmap/upload/{account}/", data=data, method="POST",
                                 headers={"Authorization": auth_header(*cred), "Content-Type": kind})
    with urllib.request.urlopen(req, context=CTX, timeout=120) as r:
        out = json.load(r)
    if not isinstance(out, dict) or not isinstance(out.get("blobId"), str) or out.get("size") != len(data):
        raise Upstream("an attachment didn't upload whole")
    return out["blobId"]


def utf8(data: bytes) -> bool:
    try:
        data.decode("utf-8")
        return True
    except UnicodeDecodeError:
        return False


def create_draft(c: dict, cred, account: str, fields: dict, sender: dict, uni: bool, threading: dict | None = None,
                 attachments: list | None = None) -> dict:
    """Email/set create in the account's Drafts from structured fields; returns {id, threadId, blobId, fingerprint}.
    `threading` ({inReplyTo, references}, from a draft being saved over) keeps a revision in its thread. `attachments`
    (uploaded's) make the message multipart/mixed, the text and the files. Stalwart encodes each file itself (base64,
    or quoted-printable/7bit only where that keeps the bytes; T-335 probe)."""
    drafts = boxes(c, cred, account).get("drafts")
    if not drafts:
        raise Conflict("this account has no Drafts mailbox")
    e = {"mailboxIds": {drafts: True}, "keywords": {"$draft": True, "$seen": True, **({"$uni-drafted": True} if uni else {})},
         "from": [sender], "subject": fields["subject"],
         "bodyValues": {"t": {"value": fields["text"]}}, "textBody": [{"partId": "t", "type": "text/plain"}]}
    for k in ("to", "cc", "bcc"):
        if fields[k]:
            e[k] = fields[k]
    if attachments:
        e["attachments"] = attachments
    if threading and not fields["inReplyTo"]:
        for k in ("inReplyTo", "references"):
            if threading.get(k):
                e[k] = threading[k]
    if fields["inReplyTo"]:
        parent = emails(c, cred, account, [fields["inReplyTo"]], ["messageId", "references"]).get(fields["inReplyTo"])
        if not parent:
            raise Conflict("the message replied to isn't in this account")
        if parent.get("messageId"):
            e["inReplyTo"] = parent["messageId"]
            e["references"] = [*(parent.get("references") or []), *parent["messageId"]]
    r = upstream(c, cred, [["Email/set", {"accountId": account, "create": {"d": e}}, "s"]])
    set_ok(r, "s", "created", ["d"])
    new = answer(r, "Email/set", "s")["created"]["d"]["id"]
    got = emails(c, cred, account, [new], ["threadId", "blobId", "size"]).get(new)
    if not got:
        raise Upstream("the new draft isn't there")
    if not isinstance(got.get("size"), int) or got["size"] > MAX_RAW:  # every later read would refuse it: don't keep it
        set_ok(upstream(c, cred, [["Email/set", {"accountId": account, "destroy": [new]}, "x"]]), "x", "destroyed", [new])
        raise ValueError(f"the message would be over {MAX_RAW // (1024 * 1024)} MB once encoded")
    return {"id": new, "threadId": got.get("threadId"), "blobId": got["blobId"],
            "fingerprint": fingerprint(download(c, cred, account, got["blobId"]))}


def a_draft(c: dict, cred, account: str, draft_id: str, drafts: str) -> dict:
    """The draft, if it is a $draft in the account's Drafts; else a Conflict."""
    e = emails(c, cred, account, [draft_id], ["threadId", "mailboxIds", "keywords", "blobId"]).get(draft_id)
    if not e or not (e.get("keywords") or {}).get("$draft") or not (e.get("mailboxIds") or {}).get(drafts):
        raise Conflict("that isn't a draft in this account's Drafts")
    return e


def discard_set(c: dict, cred, led: Ledger, account: str, draft: dict, drafts: str) -> list[str]:
    """The Uni drafts sending `draft` will discard: in its thread, strictly older (by the ledger), still drafts."""
    rank = led.rank(account, draft["id"])
    if rank is None or not draft.get("threadId"):
        return []
    # a draft held by a send (awaiting approval, outcome unknown) is never discarded
    older = [i for i in led.older_uni_drafts(account, draft["threadId"], rank) if i != draft["id"] and not led.active_for_draft(account, i)]
    if not older:
        return []
    got = emails(c, cred, account, older, ["mailboxIds", "keywords"])
    return [i for i in older if i in got and (got[i].get("keywords") or {}).get("$draft") and (got[i].get("mailboxIds") or {}).get(drafts)]


def text_and_files(msg):
    """(text, [file parts]) if the message is draft.save's shape with attachments: multipart/mixed, first a text/plain
    part, then only leaf parts marked attachment with a name. None for any other shape."""
    if msg.get_content_type() != "multipart/mixed":
        return None
    parts = msg.get_payload()
    if not isinstance(parts, list) or len(parts) < 2:
        return None
    first, rest = parts[0], parts[1:]
    if first.is_multipart() or first.get_content_type() != "text/plain" or first.get_filename() or first.get_content_disposition() == "attachment":
        return None
    if any(p.is_multipart() or p.get_content_disposition() != "attachment" or not p.get_filename() for p in rest):
        return None
    return first.get_content(), rest


def blob_fields(blob: bytes) -> tuple[dict, bool]:
    """What a stored draft says, read from its raw message: recipients, subject and plain text, and whether that is all
    of it (one text/plain part: no HTML, no attachments). The app shows these with the fingerprint of the same bytes, so
    what it reviews is what that fingerprint sends. `attachments` lists the files of a message that is text plus files
    and nothing else (T-335: name, type, size and SHA-256 of the decoded bytes), with its text; `plain` stays false for
    it, so a client that shows only text never offers to send files it hasn't shown."""
    try:
        msg = email.message_from_bytes(blob, policy=email.policy.default)
        addrs = lambda h: [{"name": n or None, "email": a} for n, a in email.utils.getaddresses([str(v) for v in msg.get_all(h) or []]) if a]
        plain = not msg.is_multipart() and msg.get_content_type() == "text/plain" and not msg.get_filename()
        text, files = msg.get_content() if plain else "", []
        mixed = None if plain else text_and_files(msg)
        if mixed:
            text = mixed[0]
            for p in mixed[1]:
                data = p.get_payload(decode=True) or b""
                files.append({"name": p.get_filename(), "type": p.get_content_type(), "size": len(data),
                              "sha256": hashlib.sha256(data).hexdigest()})
        return {"to": addrs("To"), "cc": addrs("Cc"), "bcc": addrs("Bcc"), "subject": str(msg.get("Subject") or ""),
                "text": text.replace("\r\n", "\n"), "attachments": files}, plain
    except Exception:
        return {"to": [], "cc": [], "bcc": [], "subject": "", "text": "", "attachments": []}, False


def reviewed(c, cred, led, account, e, drafts, content: bool = False) -> dict:
    """A draft for review: its fingerprint, the Uni drafts sending it discards, and (`content`) what it says, from the
    same bytes the fingerprint is of."""
    out = {"accountId": account, "draftId": e["id"], "threadId": e.get("threadId"),
           "discard": discard_set(c, cred, led, account, e, drafts), "uniDrafted": led.rank(account, e["id"]) is not None}
    if "fingerprint" in e and not content:
        out["fingerprint"] = e["fingerprint"]
    else:
        blob = download(c, cred, account, e["blobId"])
        out["fingerprint"] = fingerprint(blob)
        if content:
            out["fields"], out["plain"] = blob_fields(blob)
    return out


def header_check(blob: bytes, address: str, uni: bool, owner_addresses: set[str]) -> list[str]:
    """Contract step 5 on the message as stored: its identity headers name only `address`. Returns the envelope
    recipients (To + Cc + Bcc)."""
    try:
        msg = email.message_from_bytes(blob, policy=email.policy.compat32)
    except Exception:
        raise Refused("the draft's headers can't be read")
    mine = address.lower()

    def one(name, required):
        values = msg.get_all(name) or []
        if len(values) > 1 or (required and not values):
            raise Refused(f"the draft must have exactly one {name}" if required else f"the draft has more than one {name}")
        if not values:
            return
        raw = str(values[0])
        try:  # an encoded-word display name ("=?utf-8?b?…?=") is read as the recipient will see it
            shown = str(email.header.make_header(email.header.decode_header(raw)))
        except Exception:
            raise Refused(f"the draft's {name} can't be read")
        found = email.utils.getaddresses([raw])
        if len(found) != 1 or found[0][1].lower() != mine:
            raise Refused(f"{name} must be {address}, the account sending it")
        if uni and any(o in text.lower() for text in (raw, shown) for o in owner_addresses):
            raise Refused(f"mail from Uni can't name the owner in {name}")

    one("From", True)
    one("Sender", False)
    one("Reply-To", False)
    if any(k.lower().startswith("resent-") for k in msg.keys()):
        raise Refused("the draft has Resent- headers")
    rcpts = [a for _, a in email.utils.getaddresses([str(v) for k in ("To", "Cc", "Bcc") for v in (msg.get_all(k) or [])]) if a]
    if not rcpts:
        raise Refused("the draft has no recipients")
    if len(rcpts) > MAX_RCPTS:
        raise Refused(f"at most {MAX_RCPTS} recipients")
    for a in rcpts:
        if not EMAIL.fullmatch(a):
            raise Refused(f"not an email address: {a[:80]}")
    return list(dict.fromkeys(rcpts))


def outbound(c: dict, rcpts: list[str]) -> tuple[str, str]:
    """Uni's outbound rules (the policy file #mail owns): "allow", "refuse" or "needs-aaron", with why. Each recipient
    takes the first rule whose pattern matches it (an address, or `*@domain`), else the default; one refusal refuses the
    message, else one needs-aaron parks it. A missing or unreadable file, or an unknown outcome, refuses."""
    outcomes = {"allow", "refuse", "needs-aaron"}
    try:
        p = json.loads(Path(c["outbound_policy"]).read_text())
        default = p.get("default", "refuse")
        rules = p.get("rules") or []
        if default not in outcomes or not isinstance(rules, list):
            raise ValueError
    except Exception:
        return "refuse", "Uni's outbound rules can't be read"
    worst = ("allow", "")
    for a in rcpts:
        got = default
        for rule in rules:
            if isinstance(rule, dict) and isinstance(rule.get("to"), str) and fnmatch.fnmatchcase(a.lower(), rule["to"].lower()):
                got = rule.get("outcome")
                break
        if got not in outcomes:
            got = "refuse"
        if got == "refuse":
            return "refuse", f"Uni's outbound rules refuse {a}"
        if got == "needs-aaron":
            worst = ("needs-aaron", f"Uni's outbound rules want Aaron to approve mail to {a}")
    return worst


def owner_addresses(c: dict, s: dict, r: dict[str, str]) -> set[str]:
    names = {str(s["accounts"][i].get("name", "")).lower() for i, role in r.items() if role == "owner"}
    names |= {n.lower() for n, role in (c.get("roles") or {}).items() if role == "owner"}
    return names | {a.lower() for a in c.get("owner_aliases") or []}


def outcome(row) -> dict:
    out = {"opId": row["op_id"], "accountId": row["account_id"], "draftId": row["draft_id"], "state": row["state"]}
    if row["reason"]:
        out["reason"] = row["reason"]
    if row["submission_id"]:
        out["submissionId"] = row["submission_id"]
    if row["decision"]:
        out["decision"] = {"by": row["decided_by"], "at": iso(row["decided_at"]), "outcome": row["decision"]}
    return out


def request_hash(a: dict) -> str:
    return hashlib.sha256(json.dumps(a, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


class Op:
    """One /mail/op request: who asks (key, principal, role), on which account, with what."""

    def __init__(self, c, pubkey, user, password_file, req):
        self.c, self.pubkey, self.cred = c, pubkey, (user, password_file)
        self.s = session(c, user, password_file)
        self.r = roles(c, self.s)
        self.name = req.get("op")
        self.account = req.get("accountId")
        if not isinstance(self.name, str) or not isinstance(self.account, str):
            raise ValueError("op and accountId are required")
        if self.account not in self.r:
            raise ValueError("account not in this key's session")
        if self.name not in operations(c, self.s, self.r).get(self.account, set()):
            raise Forbidden(f"{self.name} isn't allowed for this key on this account")
        extra = set(req) - {"op", "accountId"} - ARGS[self.name]
        if extra:
            if self.name == "draft.add_for_owner":
                raise ValueError("draft.add_for_owner takes only fields: Uni can't revise, discard or send the owner's drafts")
            raise ValueError(f"{self.name} doesn't take {', '.join(sorted(extra))}")
        self.req = req
        self.own = self.account == self.s["primary"]
        self.address = self.s["accounts"][self.account]["name"]

    def ledger(self) -> Ledger:
        return ledger(self.c)


def run_op(c: dict, pubkey: str, user: str, password_file: str, req: dict) -> dict:
    op = Op(c, pubkey, user, password_file, req)
    return OPS[op.name](op)


def op_mark(keyword: str, arg: str):
    def run(op: Op) -> dict:
        ids = ids_arg(op.req.get("emailIds"))
        on = op.req.get(arg)
        if not isinstance(on, bool):
            raise ValueError(f"{arg} must be true or false")
        got = emails(op.c, op.cred, op.account, ids, ["mailboxIds"])
        if any(i not in got for i in ids):
            raise Conflict("a message isn't in this account")
        patch = {i: {f"keywords/{keyword}": True if on else None} for i in ids}
        r = upstream(op.c, op.cred, [["Email/set", {"accountId": op.account, "update": patch}, "s"]])
        set_ok(r, "s", "updated", ids)
        return {"accountId": op.account, "updated": ids}
    return run


def op_archive(op: Op) -> dict:
    ids = ids_arg(op.req.get("emailIds"))
    b = boxes(op.c, op.cred, op.account)
    if "inbox" not in b or "archive" not in b:
        raise Conflict("this account has no Archive mailbox")
    got = emails(op.c, op.cred, op.account, ids, ["mailboxIds"])
    if any(not (got.get(i, {}).get("mailboxIds") or {}).get(b["inbox"]) for i in ids):
        raise Conflict("a message isn't in this account's Inbox")
    patch = {i: {f"mailboxIds/{b['inbox']}": None, f"mailboxIds/{b['archive']}": True} for i in ids}
    r = upstream(op.c, op.cred, [["Email/set", {"accountId": op.account, "update": patch}, "s"]])
    set_ok(r, "s", "updated", ids)
    return {"accountId": op.account, "archived": ids}


def own_sender(op: Op) -> dict:
    i = identity(op.c, op.cred, op.account, op.address)
    return {"email": op.address, **({"name": i["name"]} if i.get("name") else {})}


def op_draft_save(op: Op) -> dict:
    fields = fields_arg(op.req.get("fields"))
    # a revision has only the files it is saved with. Uploaded before the lock (slow, and no draft's state matters to
    # it); a draft that is then never made leaves only unreferenced blobs, which Stalwart expires.
    files = uploaded(op.c, op.cred, op.account, attachments_arg(op.req.get("attachments")))
    with SEND_LOCK:  # a draft being replaced can't be reserved by a send halfway through
        return _draft_save(op, fields, files)


def _draft_save(op: Op, fields: dict, files: list) -> dict:
    led = op.ledger()
    drafts = boxes(op.c, op.cred, op.account).get("drafts")
    if not drafts:
        raise Conflict("this account has no Drafts mailbox")
    old = None
    if op.req.get("replaces") is not None:
        replaces = check_id(op.req["replaces"])
        base = op.req.get("base")
        if not isinstance(base, str) or not FINGERPRINT.fullmatch(base):
            raise ValueError("replacing a draft needs the fingerprint it had when it was opened (base)")
        old = a_draft(op.c, op.cred, op.account, replaces, drafts)
        if led.active_for_draft(op.account, replaces):
            raise Conflict("that draft is being sent (or was sent); it can't be replaced")
        if fingerprint(download(op.c, op.cred, op.account, old["blobId"])) != base:
            raise Conflict("the draft changed since it was opened")
    try:
        sender = own_sender(op)
    except Refused as e:
        raise Conflict(str(e))
    made_by_uni = old is not None and led.rank(op.account, old["id"]) is not None
    threading = emails(op.c, op.cred, op.account, [old["id"]], ["inReplyTo", "references"]).get(old["id"]) if old else None
    new = create_draft(op.c, op.cred, op.account, fields, sender, made_by_uni, threading, files)
    if made_by_uni:
        led.add_uni_draft(op.account, new["id"], new["threadId"], origin=old["id"])  # provenance carries over
    if old:
        r = upstream(op.c, op.cred, [["Email/set", {"accountId": op.account, "destroy": [old["id"]]}, "x"]])
        set_ok(r, "x", "destroyed", [old["id"]])
    return reviewed(op.c, op.cred, led, op.account, new, drafts)


def op_draft_review(op: Op) -> dict:
    draft_id = check_id(op.req.get("draftId"))
    drafts = boxes(op.c, op.cred, op.account).get("drafts")
    e = a_draft(op.c, op.cred, op.account, draft_id, drafts)
    return reviewed(op.c, op.cred, op.ledger(), op.account, e, drafts, content=True)


def op_draft_discard(op: Op) -> dict:
    with SEND_LOCK:
        return _draft_discard(op)


def _draft_discard(op: Op) -> dict:
    draft_id = check_id(op.req.get("draftId"))
    drafts = boxes(op.c, op.cred, op.account).get("drafts")
    a_draft(op.c, op.cred, op.account, draft_id, drafts)
    if op.ledger().active_for_draft(op.account, draft_id):
        raise Conflict("that draft is being sent (or was sent); it can't be discarded")
    r = upstream(op.c, op.cred, [["Email/set", {"accountId": op.account, "destroy": [draft_id]}, "x"]])
    set_ok(r, "x", "destroyed", [draft_id])
    return {"accountId": op.account, "discarded": draft_id}


def op_add_for_owner(op: Op) -> dict:
    """Uni's one write into the owner's mail: a new draft in Drafts. Never a revision (no `replaces`), never a send."""
    fields = fields_arg(op.req.get("fields"))
    led = op.ledger()  # first: no draft is made that the ledger can't record as Uni's
    new = create_draft(op.c, op.cred, op.account, fields, {"email": op.address}, True)
    led.add_uni_draft(op.account, new["id"], new["threadId"])
    return {"accountId": op.account, "draftId": new["id"], "threadId": new["threadId"], "fingerprint": new["fingerprint"]}


def op_send(op: Op) -> dict:
    """The submission contract for the key's own account, by draft id (steps 2–7)."""
    op_id = op.req.get("opId")
    if not isinstance(op_id, str) or not OP_ID.fullmatch(op_id):
        raise ValueError("opId: 16 to 64 letters, digits, - or _")
    draft_id = check_id(op.req.get("draftId"))
    fp = op.req.get("fingerprint")
    if not isinstance(fp, str) or not FINGERPRINT.fullmatch(fp):
        raise ValueError("fingerprint: the SHA-256 of the reviewed draft")
    discard = op.req.get("discard") or []
    if not isinstance(discard, list) or len(discard) > MAX_IDS:
        raise ValueError("discard: a list of draft ids")
    for d in discard:
        check_id(d)
    discard = sorted(set(discard))
    rh = request_hash({"op": "send", "accountId": op.account, "draftId": draft_id, "fingerprint": fp, "discard": discard})
    led = op.ledger()
    with SEND_LOCK:
        known = replay(op, led, op_id, rh)
        if known:
            return known
        taken = led.active_for_draft(op.account, draft_id)
        if taken:
            # this opId now stands for that send: recorded, so it can't later be reused for another request
            led.insert(op_id=op_id, op="send", actor=op.pubkey, account_id=op.account, draft_id=None, fingerprint=fp, request_hash=rh,
                       discard=json.dumps(discard), state="duplicate", alias_of=taken["op_id"])
            return aliased(op_id, taken)
        led.insert(op_id=op_id, op="send", actor=op.pubkey, account_id=op.account, draft_id=draft_id, fingerprint=fp,
                   request_hash=rh, discard=json.dumps(discard), state="reserved")
        return submit(op, led, op_id, op.cred, internal=False)


def op_send_as_uni(op: Op) -> dict:
    """The deputy path: the owner sends as Uni. The bridge makes one internal draft per opId in Uni's Drafts with Uni's
    identity, and runs the contract on it from step 3, with Uni's outbound rules."""
    op_id = op.req.get("opId")
    if not isinstance(op_id, str) or not OP_ID.fullmatch(op_id):
        raise ValueError("opId: 16 to 64 letters, digits, - or _")
    fields = fields_arg(op.req.get("fields"))
    rh = request_hash({"op": "send_as_uni", "accountId": op.account, "fields": fields})
    cred = deputy(op.c, op.s, op.account)
    led = op.ledger()
    with SEND_LOCK:
        known = replay(op, led, op_id, rh)
        if known:
            return known
        led.insert(op_id=op_id, op="send_as_uni", actor=op.pubkey, account_id=op.account, internal=1, request_hash=rh,
                   state="drafting")
        try:
            ds = session(op.c, *cred)
            if ds["primary"] != op.account:
                raise Refused("Uni's credential doesn't open Uni's account")
            i = identity(op.c, cred, op.account, op.address)
            new = create_draft(op.c, cred, op.account, fields, {"email": op.address, **({"name": i["name"]} if i.get("name") else {})}, False)
        except Refused as e:
            led.update(op_id, state="refused", reason=str(e))
            return outcome(led.by_op(op_id))
        except Exception:
            led.update(op_id, state="refused", reason="the draft couldn't be made")
            raise
        led.update(op_id, draft_id=new["id"], fingerprint=new["fingerprint"], state="reserved")
        return submit(op, led, op_id, cred, internal=True)


def aliased(op_id: str, base) -> dict:
    return {**outcome(base), "opId": op_id, "note": "this draft was already sent (or is being sent) under another opId"}


def replay(op: Op, led: Ledger, op_id: str, rh: str):
    """A retry: the same opId from the same key with the same request gets the recorded outcome (an unknown one is
    reconciled first, a submitted one has its cleanup retried). Anything else under that opId is refused."""
    row = led.by_op(op_id)
    if not row:
        return None
    if row["actor"] != op.pubkey or row["request_hash"] != rh or row["account_id"] != op.account:
        raise Conflict("this opId was used for a different request")
    if row["alias_of"]:
        settle(op, led, led.by_op(row["alias_of"]))
        return aliased(op_id, led.by_op(row["alias_of"]))
    return settle(op, led, row)


def settle(op: Op, led: Ledger, row, cred=None) -> dict:
    cred = cred or (deputy(op.c, op.s, row["account_id"]) if row["op"] == "send_as_uni" else op.cred)
    if row["state"] == "unknown":
        reconcile(op.c, cred, led, row)
    row = led.by_op(row["op_id"])
    if row["state"] == "submitted":
        cleanup(op, led, row, cred)
    return outcome(led.by_op(row["op_id"]))


def submit(op: Op, led: Ledger, op_id: str, cred, internal: bool, approved: dict | None = None) -> dict:
    """Steps 4–7 for a reserved row. `approved` (the owner's decision on a parked send) skips only the needs-aaron
    verdict, and is recorded with the row's first state after the checks."""
    decision = approved or {}
    row = led.by_op(op_id)
    account, draft_id = row["account_id"], row["draft_id"]
    uni = op.r.get(account) == "uni"
    try:
        b = boxes(op.c, cred, account)
        drafts, sent = b.get("drafts"), b.get("sent")
        if not drafts or not sent:
            raise Refused("this account has no Drafts or Sent mailbox")
        # step 4: the stored message is the one reviewed, and a draft in the submitting account's Drafts
        e = emails(op.c, cred, account, [draft_id], ["threadId", "mailboxIds", "keywords", "blobId"]).get(draft_id)
        if not e or not (e.get("keywords") or {}).get("$draft") or not (e.get("mailboxIds") or {}).get(drafts):
            raise Refused("that isn't a draft in this account's Drafts")
        try:
            blob = download(op.c, cred, account, e["blobId"])
        except Exception:
            raise Refused("the draft couldn't be read")
        if fingerprint(blob) != row["fingerprint"]:
            raise Refused("the draft changed since it was reviewed")
        discard = json.loads(row["discard"])
        if discard and (internal or set(discard) - set(discard_set(op.c, cred, led, account, e, drafts))):
            raise Refused("the discard list isn't the bridge's own")
        # step 5: identity headers, the identity, the envelope
        rcpts = header_check(blob, op.address, uni, owner_addresses(op.c, op.s, op.r))
        ident = identity(op.c, cred, account, op.address)
        # Uni's outbound rules, between steps 5 and 6, for anything sent from a "uni" account
        if uni:
            verdict, why = outbound(op.c, rcpts)
            if verdict == "refuse":
                raise Refused(why)
            if verdict == "needs-aaron" and not approved:
                notice = park_notice(row, op.address, rcpts, blob, why)
                led.update(op_id, state="awaiting-approval", reason=why, notice=json.dumps(notice))
                spool(op.c, f"{op_id}.json", notice)
                return outcome(led.by_op(op_id))
    except Refused as e:
        led.update(op_id, state="refused", reason=str(e), **decision)
        return outcome(led.by_op(op_id))
    except Exception:
        if approved:  # the parked send stays parked: the owner can try again
            raise
        led.update(op_id, state="refused", reason="interrupted before submitting")
        raise
    # step 6: committed as submitting before the call; from here the row never reopens
    led.update(op_id, state="submitting", **decision)
    call = ["EmailSubmission/set", {"accountId": account, "create": {"s1": {
        "identityId": ident["id"], "emailId": draft_id,
        "envelope": {"mailFrom": {"email": op.address}, "rcptTo": [{"email": a} for a in rcpts]}}},
        "onSuccessUpdateEmail": {"#s1": {f"mailboxIds/{drafts}": None, f"mailboxIds/{sent}": True, "keywords/$draft": None}}}, "0"]
    try:
        r = upstream(op.c, cred, [call], submission=True)
    except Upstream as e:
        led.update(op_id, state="failed", reason=f"the mail server refused the submission: {e}")
        return outcome(led.by_op(op_id))
    except Exception:
        led.update(op_id, state="unknown", reason="no answer from the mail server; checking before anything else")
        return outcome(led.by_op(op_id))
    try:
        created = (answer(r, "EmailSubmission/set", "0").get("created") or {}).get("s1")
    except Upstream:
        created = None
    if not created or not created.get("id"):
        why = ((answer(r, "EmailSubmission/set", "0").get("notCreated") or {}).get("s1") or {}).get("type", "not created")
        led.update(op_id, state="failed", reason=f"the mail server refused the submission: {why}")
        return outcome(led.by_op(op_id))
    led.update(op_id, state="submitted", submission_id=created["id"], reason=None)
    cleanup(op, led, led.by_op(op_id), cred)
    return outcome(led.by_op(op_id))


def reconcile(c: dict, cred, led: Ledger, row) -> None:
    """An uncertain submission: look for it on the server. Found: submitted. Not found: it stays unknown and blocked."""
    try:
        r = upstream(c, cred, [["EmailSubmission/query", {"accountId": row["account_id"], "filter": {"emailIds": [row["draft_id"]]}}, "q"]],
                     submission=True)
        ids = answer(r, "EmailSubmission/query", "q").get("ids") or []
    except Exception:
        return
    if ids:
        led.update(row["op_id"], state="submitted", submission_id=ids[0], reason=None)


def cleanup(op: Op, led: Ledger, row, cred) -> None:
    """After a submission: the copy in Sent (if onSuccessUpdateEmail didn't move it), then the listed Uni drafts.
    A failure leaves the row submitted, to retry as cleanup only."""
    account, draft_id = row["account_id"], row["draft_id"]
    try:
        b = boxes(op.c, cred, account)
        e = emails(op.c, cred, account, [draft_id], ["mailboxIds", "keywords"]).get(draft_id)
        if e and (e.get("mailboxIds") or {}).get(b["drafts"]):
            r = upstream(op.c, cred, [["Email/set", {"accountId": account, "update": {draft_id: {
                f"mailboxIds/{b['drafts']}": None, f"mailboxIds/{b['sent']}": True, "keywords/$draft": None}}}, "m"]])
            set_ok(r, "m", "updated", [draft_id])
        discard = json.loads(row["discard"]) if not row["internal"] else []
        if discard:
            got = emails(op.c, cred, account, discard, ["mailboxIds", "keywords"])
            gone = [d for d in discard if d in got and (got[d].get("keywords") or {}).get("$draft")
                    and (got[d].get("mailboxIds") or {}).get(b["drafts"]) and led.rank(account, d) is not None
                    and not led.active_for_draft(account, d)]
            if gone:
                r = upstream(op.c, cred, [["Email/set", {"accountId": account, "destroy": gone}, "x"]])
                set_ok(r, "x", "destroyed", gone)
    except Exception:
        led.update(row["op_id"], reason="sent; cleanup pending")
        return
    led.update(row["op_id"], state="cleaned", reason=None)


def parked(op: Op, led: Ledger, op_id: str):
    """The send under `op_id` on this account that was parked for the owner (now, or before a decision)."""
    row = led.by_op(op_id)
    if not row or row["account_id"] != op.account or row["alias_of"]:
        raise NotFound("no such send")
    if not row["notice"] and row["state"] != "awaiting-approval":
        raise Conflict(f"that send isn't waiting for approval (it is {row['state']})")
    return row


def op_send_approve(op: Op) -> dict:
    """The owner approves a parked send: exactly the draft it was parked with, every check run again except the
    needs-aaron verdict (a recipient the rules now refuse is still refused). At most once: a retry from the same key
    gets the outcome."""
    op_id = op.req.get("opId")
    if not isinstance(op_id, str) or not OP_ID.fullmatch(op_id):
        raise ValueError("opId: 16 to 64 letters, digits, - or _")
    fp = op.req.get("fingerprint")
    if not isinstance(fp, str) or not FINGERPRINT.fullmatch(fp):
        raise ValueError("fingerprint: the SHA-256 of the parked draft")
    cred = deputy(op.c, op.s, op.account)
    led = op.ledger()
    with SEND_LOCK:
        row = parked(op, led, op_id)
        if row["decision"]:
            if row["decision"] != "approved" or row["decided_by"] != op.pubkey or row["fingerprint"] != fp:
                raise Conflict(f"that send was already {row['decision']}")
            return settle(op, led, row, cred)
        if row["state"] != "awaiting-approval":
            raise Conflict(f"that send isn't waiting for approval (it is {row['state']})")
        if row["fingerprint"] != fp:
            raise Conflict("that isn't the draft this send was parked with")
        out = submit(op, led, op_id, cred, internal=bool(row["internal"]),
                     approved={"decision": "approved", "decided_by": op.pubkey, "decided_at": time.time()})
        spool(op.c, f"{op_id}.done.json", decided(led.by_op(op_id)))
        return out


def op_send_decline(op: Op) -> dict:
    """The owner declines a parked send: nothing is sent, and the draft is released (Uni may revise or discard it)."""
    op_id = op.req.get("opId")
    if not isinstance(op_id, str) or not OP_ID.fullmatch(op_id):
        raise ValueError("opId: 16 to 64 letters, digits, - or _")
    led = op.ledger()
    with SEND_LOCK:
        row = parked(op, led, op_id)
        if row["decision"]:
            if row["decision"] != "declined" or row["decided_by"] != op.pubkey:
                raise Conflict(f"that send was already {row['decision']}")
            return outcome(row)
        if row["state"] != "awaiting-approval":
            raise Conflict(f"that send isn't waiting for approval (it is {row['state']})")
        led.update(op_id, state="declined", reason="the owner declined it", decision="declined", decided_by=op.pubkey,
                   decided_at=time.time())
        spool(op.c, f"{op_id}.done.json", decided(led.by_op(op_id)))
        return outcome(led.by_op(op_id))


def renotify(c: dict, op_id: str) -> dict:
    """A send parked before the spool existed: its notice (and spool file). The bridge does this itself when it opens
    the ledger (spool_sync); this is for running it in-process, with the bridge stopped (one process owns the ledger)."""
    led = ledger(c)
    row = led.by_op(op_id)
    if not row or row["state"] != "awaiting-approval" or row["notice"]:
        raise ValueError("not a parked send without a notice")
    return notice_for(c, led, row)


def notice_for(c: dict, led: Ledger, row) -> dict:
    """The notice for a parked send, from the stored draft as the account's own principal reads it; recorded and spooled."""
    if row["state"] != "awaiting-approval" or not row["draft_id"]:
        raise ValueError("not a parked send")
    for name, p in (c.get("principals") or {}).items():
        cred = (name, (p or {}).get("password_file"))
        try:
            s = session(c, *cred)
        except Exception:  # a principal whose session fails can't be the one
            continue
        if s["primary"] == row["account_id"]:
            break
    else:
        raise ValueError("no principal in the config opens that account")
    e = emails(c, cred, row["account_id"], [row["draft_id"]], ["blobId"]).get(row["draft_id"])
    if not e:
        raise Conflict("the parked draft isn't there")
    blob = download(c, cred, row["account_id"], e["blobId"])
    if fingerprint(blob) != row["fingerprint"]:
        raise Conflict("the parked draft changed")
    rcpts = header_check(blob, name, True, owner_addresses(c, s, roles(c, s)))
    notice = park_notice(row, name, rcpts, blob, row["reason"])
    led.update(row["op_id"], notice=json.dumps(notice))
    spool(c, f"{row['op_id']}.json", notice)
    return notice


def op_send_parked(op: Op) -> dict:
    """Read-only (T-213): the sends on this account waiting for the owner, so the app can show them and offer
    send.approve and send.decline. Each says what it sends, read as the asking key from the parked draft's bytes, and
    `fingerprint` is of those same bytes: an approve bound to it sends what the owner read, and if the stored draft
    changed under its reservation that fingerprint isn't the parked one, so the approve is refused. Nothing is written."""
    out = []
    for row in op.ledger().awaiting(op.account)[:MAX_IDS]:
        notice = json.loads(row["notice"]) if row["notice"] else {}
        item = {"opId": row["op_id"], "draftId": row["draft_id"], "reason": row["reason"],
                "sentBy": "owner, as Uni" if row["op"] == "send_as_uni" else "Uni", "parkedAt": iso(row["updated_at"]),
                "recipients": notice.get("recipients") or []}
        try:
            e = emails(op.c, op.cred, op.account, [row["draft_id"]], ["blobId"]).get(row["draft_id"]) if row["draft_id"] else None
            if not e:
                raise Conflict("the parked draft isn't there")
            blob = download(op.c, op.cred, op.account, e["blobId"])
        except Conflict as x:
            item["problem"] = str(x)
        except Exception:
            item["problem"] = "the parked draft couldn't be read"
        else:
            item["fingerprint"] = fingerprint(blob)
            item["changed"] = item["fingerprint"] != row["fingerprint"]
            item["fields"], item["plain"] = blob_fields(blob)
        out.append(item)
    return {"accountId": op.account, "parked": out}


def op_send_check(op: Op) -> dict:
    op_id = op.req.get("opId")
    if not isinstance(op_id, str) or not OP_ID.fullmatch(op_id):
        raise ValueError("opId: 16 to 64 letters, digits, - or _")
    led = op.ledger()
    with SEND_LOCK:
        row = led.by_op(op_id)
        if not row or row["actor"] != op.pubkey or row["account_id"] != op.account:
            raise NotFound("no such send")
        if row["alias_of"]:
            settle(op, led, led.by_op(row["alias_of"]))
            row = led.by_op(row["alias_of"])
            out = aliased(op_id, row)
        else:
            out = settle(op, led, row)
    row = led.by_op(row["op_id"])
    if row["submission_id"]:
        cred = deputy(op.c, op.s, row["account_id"]) if row["op"] == "send_as_uni" else op.cred
        try:
            r = upstream(op.c, cred, [["EmailSubmission/get", {"accountId": op.account, "ids": [row["submission_id"]],
                                                                "properties": ["id", "undoStatus", "deliveryStatus"]}, "g"]], submission=True)
            sub = (answer(r, "EmailSubmission/get", "g").get("list") or [None])[0] or {}
            out["delivery"] = {a: (d or {}).get("delivered", "unknown") for a, d in (sub.get("deliveryStatus") or {}).items()}
        except Exception:
            pass
    return out


OPS = {
    "mark_seen": op_mark("$seen", "seen"),
    "flag": op_mark("$flagged", "flagged"),
    "archive": op_archive,
    "draft.save": op_draft_save,
    "draft.review": op_draft_review,
    "draft.discard": op_draft_discard,
    "draft.add_for_owner": op_add_for_owner,
    "send": op_send,
    "send_as_uni": op_send_as_uni,
    "send.check": op_send_check,
    "send.approve": op_send_approve,
    "send.decline": op_send_decline,
    "send.parked": op_send_parked,
}


class Handler(BaseHTTPRequestHandler):
    def send(self, code: int, data: bytes, ctype: str = "application/json") -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self) -> None:
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if n <= 0 or n > (MAX_OP_BODY if self.path == "/mail/op" else MAX_BODY):
                return self.send(413, b'{"error":"bad body size"}')
            c = conf()
            urls = [u + self.path for u in public_urls(c)]
            if n > MAX_BODY:  # a big body (attachments) is read only for a signed, allowlisted key
                try:
                    ev = nip98_event(self.headers.get("Authorization", ""), urls)
                    if ev["pubkey"].lower() not in allowed():
                        raise ValueError("pubkey not allowed")
                    with SEEN_LOCK:
                        if ev["id"] in SEEN:
                            raise ValueError("replayed authorization")
                except (ValueError, KeyError, json.JSONDecodeError, binascii.Error) as e:
                    self.close_connection = True
                    return self.send(401, json.dumps({"error": str(e)}).encode())
            body = self.rfile.read(n)
            try:
                pubkey = verify_nip98(self.headers.get("Authorization", ""), urls, body)
            except (ValueError, KeyError, json.JSONDecodeError) as e:
                return self.send(401, json.dumps({"error": str(e)}).encode())
            user, password_file = principal(c, pubkey)
            req = json.loads(body)
            if not isinstance(req, dict):
                raise ValueError("body must be a JSON object")
            if self.path == "/mail/session":
                return self.send(200, json.dumps(mail_session(c, user, password_file)).encode())
            if self.path == "/mail/jmap":
                return self.send(200, json.dumps(jmap(c, user, password_file, req.get("calls") or [])).encode())
            if self.path == "/mail/raw":
                data = raw(c, user, password_file, str(req.get("blobId") or ""), req.get("accountId"))
                return self.send(200, data, "text/plain; charset=utf-8")
            if self.path == "/mail/op":
                return self.send(200, json.dumps(run_op(c, pubkey, user, password_file, req)).encode())
            raise NotFound("not found")  # /mail/triage too, until Uni's triage store exists
        except Forbidden as e:
            return self.send(403, json.dumps({"error": str(e)}).encode())
        except NotFound as e:
            return self.send(404, json.dumps({"error": str(e)}).encode())
        except Conflict as e:
            return self.send(409, json.dumps({"error": str(e)}).encode())
        except ValueError as e:
            return self.send(400, json.dumps({"error": str(e)}).encode())
        except Upstream as e:  # Stalwart's own method-error type/description: no credentials in it
            sys.stderr.write(f"upstream: {str(e)[:300]}\n")
            return self.send(502, json.dumps({"error": f"mail server: {str(e)[:300]}"}).encode())
        except Exception as e:  # anything else; never leak credentials
            return self.send(502, json.dumps({"error": f"mail server: {type(e).__name__}"}).encode())

    def log_message(self, fmt, *args):
        print(f"{self.address_string()} {fmt % args}", flush=True)


def open_ledger_at_start() -> None:
    """Crash recovery and the spool files at start, not at the first request that happens to need the ledger."""
    try:
        c = conf()
        if c.get("ledger") or c.get("operations"):
            ledger(c)
    except Exception as e:
        sys.stderr.write(f"ledger at start: {type(e).__name__}\n")


if __name__ == "__main__":
    threading.Thread(target=open_ledger_at_start, daemon=True).start()
    ThreadingHTTPServer((os.environ.get("UNI_MAIL_HOST", "127.0.0.1"), PORT), Handler).serve_forever()
