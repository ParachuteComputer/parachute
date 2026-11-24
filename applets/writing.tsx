// Writing: pieces by stage (draft, seed, ready, published) and a quiet editor with Uni's prepared references and
// quotes beside it — a sticky column on wide screens, a drawer on phones. Folder-scoped to Writing/Pieces/ (where
// unforced.org reads pieces) and References/ (read from ready().access), with additive reference fields (`piece`,
// `used_in`, `state`: asked | ready | kept | let go). `piece` names the piece as Uni already writes it on the research
// it prepares (the piece's name in Writing/Pieces/); `for` is left alone: in a vault it names the person a thing is for. unforced.org publishes a piece whose stage is ready or published,
// so this applet only moves a piece between seed and draft and shows `slug`, `url` and `published_at` read-only.
// Typing stays instant: the editor is memoized with its own local state and debounced saves, never re-rendering the
// page or Beside-it panel on keystrokes.
import { memo, useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import {
  Button,
  Card,
  Days,
  Drawer,
  Empty,
  Field,
  Fields,
  Link,
  link,
  List,
  Loading,
  Note,
  onBack,
  onOpen,
  onShown,
  Page,
  Problem,
  ready,
  saved,
  Search,
  Tabs,
  toast,
  useSaved,
  vault,
  when,
  Write,
} from "parachute";

export type Stage = "draft" | "seed" | "ready" | "published";
export type RefState = "asked" | "ready" | "kept" | "let go";

export type VaultRec = {
  id: string;
  path: string;
  createdAt?: string | null;
  updatedAt: string | null;
  tags?: string[];
  types?: string[];
  fields?: Record<string, unknown>;
  body?: string;
  links?: {
    sourceId: string;
    targetId: string;
    relationship?: string | null;
    sourceNote?: { id: string; path: string | null };
    targetNote?: { id: string; path: string | null };
  }[];
};

export type QueryVault = {
  queryRecords(q?: Record<string, unknown>): Promise<VaultRec[]>;
};

export const STAGES: readonly Stage[] = ["draft", "seed", "ready", "published"];
export const STAGE_LABELS: Record<Stage, string> = { draft: "Draft", seed: "Seed", ready: "Ready", published: "Published" };
/** The stages this applet may set. `ready` and `published` are the site's: a piece in them goes out on unforced.org. */
export const EDITABLE_STAGES: readonly Stage[] = ["seed", "draft"];
export const REF_STATE_LABELS: Record<RefState, string> = {
  asked: "Asked",
  ready: "Ready",
  kept: "Kept",
  "let go": "Let go",
};

const DEFAULT_PIECES_FOLDER = "Writing/Pieces/";
const DEFAULT_REFS_FOLDER = "References/";
const SAVE_DEBOUNCE_MS = 850;
const WIDE_QUERY = "(min-width: 900px)";

// ── Pure helpers (tested directly in src/applet/writingApplet.test.tsx) ──

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Stage of a piece record: `seed`, `draft`, `ready` or `published` (defaults to `seed`). */
export function stageOf(rec: Pick<VaultRec, "fields">): Stage {
  const s = str(rec.fields?.stage).toLowerCase();
  if (s === "draft" || s === "published" || s === "seed" || s === "ready") return s;
  return "seed";
}

/** Whether this applet may change a piece's stage: only seed or draft (or none yet). Any other stage — ready,
 *  published, or one the site added that this applet doesn't know — is shown as it is and left alone. */
export function stageEditable(rec: Pick<VaultRec, "fields">): boolean {
  const raw = str(rec.fields?.stage).toLowerCase();
  return raw === "" || (EDITABLE_STAGES as readonly string[]).includes(raw);
}

/** State of a reference record: `asked`, `ready`, `kept`, or `let go` (defaults to `ready`). */
export function refStateOf(rec: Pick<VaultRec, "fields">): RefState {
  const s = str(rec.fields?.state).toLowerCase();
  if (s === "asked" || s === "ready" || s === "kept" || s === "let go") return s;
  return "ready";
}

/** Display title for a record: its `title` field if set, else its path without folder prefix or `.md`. */
export function recordTitle(rec: Pick<VaultRec, "path" | "fields">, folder = ""): string {
  const explicit = str(rec.fields?.title);
  if (explicit) return explicit;
  const p = folder && rec.path.startsWith(folder) ? rec.path.slice(folder.length) : rec.path.replace(/^[^/]+\//, "");
  return p.replace(/\.md$/i, "") || rec.path;
}

/** Safe single-segment vault path name, never a code file extension. */
export function cleanName(raw: string, fallback = "Untitled"): string {
  const cleaned = raw
    .replace(/[\\/:*?"<>|#\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.(html?|tsx|jsx|js)$/i, " $1");
  return Array.from(cleaned).slice(0, 72).join("").trim() || fallback;
}

/** Group pieces by stage (draft, seed, ready, published), each sorted last touched first (`updatedAt` descending). */
export function groupPiecesByStage(pieces: readonly VaultRec[]): Record<Stage, VaultRec[]> {
  const out: Record<Stage, VaultRec[]> = { draft: [], seed: [], ready: [], published: [] };
  for (const p of pieces) out[stageOf(p)].push(p);
  const byTouched = (a: VaultRec, b: VaultRec) =>
    (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || a.path.localeCompare(b.path);
  for (const stage of STAGES) out[stage].sort(byTouched);
  return out;
}

/** Strip surrounding wikilink brackets, anchor/alias, or `.md` suffix, and extract IDs from hub URLs or vault:ULID. */
function normalizeTarget(raw: string): string[] {
  const s = raw.trim();
  if (!s) return [];
  const out = new Set<string>([s, s.replace(/\.md$/i, "")]);
  const wiki = /^\[\[([^\]]+)\]\]$/.exec(s);
  if (wiki) {
    const inner = wiki[1].split("|")[0].split("#")[0].trim();
    if (inner) {
      out.add(inner);
      out.add(inner.replace(/\.md$/i, ""));
    }
  }
  const hub = /\/(?:view|n)\/([A-Za-z0-9_-]{8,64})(?:[/?#]|$)/.exec(s);
  if (hub) out.add(hub[1]);
  const shortRef = /^[a-z0-9][a-z0-9_-]{0,39}:([A-Za-z0-9_-]{8,64})$/i.exec(s);
  if (shortRef) out.add(shortRef[1]);
  return [...out];
}

/** The piece's name, as a reference's `piece` field gives it: its path inside the pieces folder (unique there, unlike a
 *  title), else its whole path. */
export function pieceName(piece: Pick<VaultRec, "path">, piecesFolder = DEFAULT_PIECES_FOLDER): string {
  const bare = piece.path.replace(/\.md$/i, "");
  return piecesFolder && bare.startsWith(piecesFolder) ? bare.slice(piecesFolder.length) : bare;
}

/** All string identifiers that a reference's `piece` field might use to name this piece. */
export function pieceMatchKeys(piece: Pick<VaultRec, "id" | "path" | "fields">, piecesFolder = DEFAULT_PIECES_FOLDER): string[] {
  // not its title: two pieces may share one
  const barePath = piece.path.replace(/\.md$/i, "");
  const keys = new Set<string>([piece.id, piece.path, barePath]);
  if (piecesFolder && barePath.startsWith(piecesFolder)) keys.add(barePath.slice(piecesFolder.length));
  return [...keys].filter(Boolean);
}

/** True when a reference's `piece` field (or links) targets the given piece. */
export function matchesPiece(ref: VaultRec, piece: Pick<VaultRec, "id" | "path" | "fields">, piecesFolder = DEFAULT_PIECES_FOLDER): boolean {
  const targets = new Set(pieceMatchKeys(piece, piecesFolder).map((k) => k.toLowerCase()));
  const raw = ref.fields?.piece;
  const values = Array.isArray(raw) ? raw : raw !== undefined && raw !== null ? [raw] : [];
  for (const v of values) {
    if (typeof v !== "string") continue;
    for (const norm of normalizeTarget(v)) {
      if (targets.has(norm.toLowerCase())) return true;
    }
  }
  if (Array.isArray(ref.links)) {
    for (const l of ref.links) {
      if (l.targetId === piece.id || l.sourceId === piece.id) return true;
      const tPath = l.targetNote?.path?.replace(/\.md$/i, "").toLowerCase();
      const sPath = l.sourceNote?.path?.replace(/\.md$/i, "").toLowerCase();
      if ((tPath && targets.has(tPath)) || (sPath && targets.has(sPath))) return true;
    }
  }
  return false;
}

/** Timestamp used to order references newest first: `createdAt`, falling back to `updatedAt`. */
export function refTimestamp(ref: Pick<VaultRec, "createdAt" | "updatedAt">): string {
  return ref.createdAt ?? ref.updatedAt ?? "";
}

/** Filter references belonging to `piece`, deduplicated and sorted newest first. */
export function besideReferences(
  refs: readonly VaultRec[],
  piece: Pick<VaultRec, "id" | "path" | "fields">,
  opts: { includeLetGo?: boolean; piecesFolder?: string } = {},
): VaultRec[] {
  const seen = new Set<string>();
  const out: VaultRec[] = [];
  for (const r of refs) {
    if (!r || seen.has(r.id)) continue;
    if (!matchesPiece(r, piece, opts.piecesFolder ?? DEFAULT_PIECES_FOLDER)) continue;
    if (!opts.includeLetGo && refStateOf(r) === "let go") continue;
    seen.add(r.id);
    out.push(r);
  }
  out.sort((a, b) => refTimestamp(b).localeCompare(refTimestamp(a)) || b.id.localeCompare(a.id));
  return out;
}

/** Query the References folder for all references serving `piece`, newest first.
 *  Uses a server-side `fields.piece` filter first (so large vaults don't miss older records past a page limit),
 *  then merges with the recent folder query (so wikilink/URL/array `piece` values and older 0.8 hubs work too). */
export async function queryBeside(
  vaultApi: QueryVault,
  refsFolder: string,
  piece: Pick<VaultRec, "id" | "path" | "fields">,
  piecesFolder = DEFAULT_PIECES_FOLDER,
): Promise<{ active: VaultRec[]; letGo: VaultRec[]; all: VaultRec[] }> {
  const names = pieceMatchKeys(piece, piecesFolder);
  const keys = [...names, ...names.filter((k) => k !== piece.id).map((k) => `[[${k}]]`)];
  const directPromise = vaultApi
    .queryRecords({
      pathPrefix: refsFolder,
      fields: { piece: { in: keys } },
      includeBody: true,
      includeFields: true,
      orderBy: "created_at",
      sort: "desc",
      limit: 50,
    })
    .catch(() =>
      vaultApi
        .queryRecords({
          pathPrefix: refsFolder,
          fields: { piece: pieceName(piece, piecesFolder) },
          includeBody: true,
          includeFields: true,
          limit: 50,
        })
        .catch(() => [] as VaultRec[]),
    );
  // Not caught: when the folder can't be read, the panel says so (Problem, Retry) rather than "nothing yet"
  const recentPromise = vaultApi.queryRecords({
    pathPrefix: refsFolder,
    includeBody: true,
    includeFields: true,
    includeLinks: true,
    limit: 50,
  });

  const [direct, recent] = await Promise.all([directPromise, recentPromise]);
  const merged = besideReferences([...direct, ...recent], piece, { includeLetGo: true, piecesFolder });
  const active = merged.filter((r) => refStateOf(r) !== "let go");
  const letGo = merged.filter((r) => refStateOf(r) === "let go");
  return { active, letGo, all: merged };
}

/** Extract the quote text from a reference record: `fields.quote`, else a blockquote in `body`, else trimmed `body`. */
export function refQuote(ref: Pick<VaultRec, "fields" | "body">): string {
  const explicit = str(ref.fields?.quote);
  if (explicit) return explicit;
  const body = (ref.body ?? "").trim();
  if (!body) return "";
  const lines = body.split("\n");
  const quoted: string[] = [];
  for (const line of lines) {
    if (/^\s*>/.test(line)) quoted.push(line.replace(/^\s*>\s?/, ""));
    else if (quoted.length) break;
  }
  if (quoted.length) return quoted.join("\n").trim();
  return body;
}

/** Extract source attribution (`label`, `author`, `url`) from a reference record. */
export function refSource(ref: Pick<VaultRec, "path" | "fields">): { label: string; author: string; url: string } {
  const f = ref.fields ?? {};
  const rawUrl = str(f.source_url) || str(f.url);
  const rawSource = str(f.source) || str(f.source_title) || str(f.from);
  const author = str(f.author);
  const urlFromSource = !rawUrl && (/^(https?:|mailto:)/i.test(rawSource) || /^\[\[.+\]\]$/.test(rawSource)) ? rawSource : "";
  const url = rawUrl || urlFromSource;
  let label = rawSource && rawSource !== urlFromSource ? rawSource : "";
  if (!label && url) {
    const wiki = /^\[\[([^\]|#]+)/.exec(url);
    if (wiki) label = wiki[1].split("/").pop() ?? wiki[1];
    else {
      try {
        label = new URL(url).hostname.replace(/^www\./, "") || url;
      } catch {
        label = url;
      }
    }
  }
  if (!label) label = recordTitle(ref);
  return { label, author, url };
}

/** Extract Uni's line on why this reference fits the piece. */
export function refWhy(ref: Pick<VaultRec, "fields">): string {
  const f = ref.fields ?? {};
  return str(f.why) || str(f.why_it_fits) || str(f.reason) || str(f.note);
}

const VAULT_URL = /\/vault\/[^/?#]+\/|\/(?:view|n)\/[A-Za-z0-9_-]{8,64}(?:[/?#]|$)/;

/** `[[Notes/Ivan Illich|Illich]]` → `Illich`, `[[Ivan Illich]]` → `Ivan Illich`: the words a wikilink shows. */
export function unwiki(text: string): string {
  return text.replace(/!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_m, target: string, alias?: string) =>
    (alias ?? target.split("/").pop() ?? target).trim(),
  );
}

/** Format a reference as a Markdown blockquote with a link to its source: its web address when it has one, else the
 *  source in plain words. Never a [[wikilink]] (unforced.org won't publish a piece with one) and never the vault's own
 *  address of the reference (a published piece is public; the vault isn't). */
export function formatQuoteMarkdown(ref: Pick<VaultRec, "id" | "path" | "fields" | "body">): string {
  const quote = refQuote(ref);
  const found = refSource(ref);
  // a vault's address (a hub's /vault/<name>/ or a record's /view/<id>) is no source to cite in public
  const words = [ref.fields?.source, ref.fields?.source_title, ref.fields?.from].map(str).find((w) => w && !/^(https?:|mailto:)/i.test(w)) ?? "";
  const src = VAULT_URL.test(found.url) ? { ...found, url: "", label: words.replace(/^\[\[([^\]|#]+).*$/, (_m, t: string) => t.split("/").pop() ?? t) } : found;
  const bodyLines = unwiki(quote || recordTitle(ref))
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => (line.trim() ? `> ${line}` : ">"));

  // with no source named, the label is the reference's own note name: that stays in the vault
  const named = !!(src.label && (words || src.url));
  const label = named && !/^(https?:|mailto:)/i.test(src.label) ? src.label.replace(/[\[\]]/g, "") : "";
  const author = src.author.replace(/[\[\]]/g, "");
  const href = /^(https?:|mailto:)/i.test(src.url) ? src.url.replace(/\s/g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29") : "";
  const cited = href ? `[${label || href}](${href})` : label;
  const citation = [author, cited].filter(Boolean).join(", ");
  if (citation) bodyLines.push(`> — ${citation}`);
  return bodyLines.join("\n");
}

/** Splice a markdown blockquote cleanly into a piece's body at `[start, end]`, returning the new text and cursor offset. */
export function insertAtSelection(
  body: string,
  insertion: string,
  start = body.length,
  end = start,
): { text: string; cursor: number } {
  const block = insertion.trim();
  const s = Math.max(0, Math.min(body.length, start));
  const e = Math.max(s, Math.min(body.length, end));
  const before = body.slice(0, s);
  const after = body.slice(e);
  const lead = !before.trim() ? "" : before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const trail = !after.trim() ? "\n" : after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
  const prefix = before.trim() ? before + lead : "";
  const suffix = after.trim() ? trail + after : after.length ? "\n" : "";
  const text = prefix + block + suffix;
  return { text, cursor: prefix.length + block.length };
}

/** Build the `createRecord` payload for Ask Uni: a record in the references folder with `state: "asked"` and `piece` set
 *  to the piece's name. Never touches the piece's body. No `types`: the app gives a new record the `reference` the
 *  applet opens there, as a type or a plain tag, whichever the vault has (a vault refuses a plain tag sent as a type). */
export function buildAskRecord(
  refsFolder: string,
  piece: Pick<VaultRec, "id" | "path" | "fields">,
  line: string,
  at: Date = new Date(),
  piecesFolder = DEFAULT_PIECES_FOLDER,
): { path: string; body: string; fields: Record<string, unknown> } {
  const text = line.trim();
  const slug = cleanName(text.split(/\s+/).slice(0, 6).join(" "), "Question");
  return {
    path: `${refsFolder}Ask ${when.stamp(at)} ${slug}`,
    body: text,
    fields: {
      piece: pieceName(piece, piecesFolder),
      state: "asked",
    },
  };
}

/** Merge a piece's name into a reference's `used_in` list; returns null when already present. */
export function mergeUsedIn(existing: unknown, name: string): string[] | null {
  const list = Array.isArray(existing)
    ? existing.filter((x): x is string => typeof x === "string" && x.length > 0)
    : typeof existing === "string" && existing.trim()
      ? [existing.trim()]
      : [];
  if (list.includes(name)) return null;
  return [...list, name];
}

/** Change a reference's fields, reading it again once if it changed since it was listed (Uni may have added to it, or
 *  this applet noted a use). `change` gives the fields from the reference as it is, or null for nothing to change.
 *  Resolves the reference as saved, or null when there was nothing to change. */
export async function changeReference(
  ref: VaultRec,
  change: (cur: VaultRec) => Record<string, unknown> | null,
): Promise<VaultRec | null> {
  let cur: VaultRec | null = ref;
  for (let tries = 0; ; tries++) {
    if (!cur?.updatedAt) throw new Error("This reference has no version to change. Reload it.");
    const fields = change(cur);
    if (!fields) return null;
    try {
      const updated: VaultRec = await vault.updateRecord(ref.id, { if_updated_at: cur.updatedAt, fields });
      return { ...cur, ...updated, fields: { ...(cur.fields ?? {}), ...(updated.fields ?? {}), ...fields } };
    } catch (e) {
      if ((e as { status?: number })?.status !== 409 || tries > 0) throw e;
      cur = await vault.getRecord(ref.id);
    }
  }
}

/** Add the piece (by name) to a reference's `used_in`. */
export function noteUsedIn(ref: VaultRec, name: string): Promise<VaultRec | null> {
  return changeReference(ref, (cur) => {
    const next = mergeUsedIn(cur.fields?.used_in, name);
    return next ? { used_in: next } : null;
  });
}

/** Resolve pieces and references folders from `ready().access`, falling back to Writing/ and References/. */
export function foldersFromAccess(access?: readonly { path: string; verbs: readonly string[] }[]): { pieces: string; refs: string } {
  const readable = (access ?? []).filter((r) => r.verbs.includes("read")).map((r) => r.path);
  const pieces = readable.find((p) => /^writing\//i.test(p)) ?? readable[0] ?? DEFAULT_PIECES_FOLDER;
  const refs = readable.find((p) => /^references\//i.test(p)) ?? readable.find((p) => p !== pieces) ?? DEFAULT_REFS_FOLDER;
  return { pieces, refs };
}

// ── Styling (theme tokens only) ──

const CSS = `
.wr-split { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--gap); align-items: start; }
@media (min-width: 900px) {
  .wr-split { grid-template-columns: minmax(0, 1.55fr) minmax(280px, 1fr); gap: calc(var(--gap) * 1.8); }
  .wr-beside { position: sticky; top: var(--pad); padding-left: calc(var(--pad) * 1.2); border-left: var(--line-row); }
}
.wr-editor .pa-write-box { min-height: 48dvh; font-family: var(--serif); font-size: var(--fs-lead); line-height: 1.7;
  /* grows with the piece, so the page is the one thing that scrolls (a browser without field-sizing keeps a box) */
  field-sizing: content; resize: none; }
.wr-editor-foot { display: flex; align-items: center; justify-content: space-between; gap: var(--gap); margin-top: 4px; }
.wr-save-note { font: italic var(--fs-small) var(--serif); color: var(--muted); font-variant-numeric: tabular-nums; }
.wr-published { margin-top: var(--gap); }
.wr-beside-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--gap); margin: 0 0 var(--gap); padding-bottom: 6px; border-bottom: var(--line-head); }
.wr-beside-title { margin: 0; font: italic 400 var(--fs-head) var(--serif); color: var(--text); }
.wr-beside-count { font: var(--fs-small) var(--sans); color: var(--muted); font-variant-numeric: tabular-nums; }
.wr-ref { padding: calc(var(--gap) * .75) 0; border-bottom: var(--line-row); }
.wr-ref-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 4px; }
.wr-ref-state { font: 600 var(--fs-label) var(--sans); letter-spacing: var(--label-track); text-transform: var(--label-transform); font-variant-caps: var(--label-caps); color: var(--label-ink); }
.wr-ref-time { font: italic var(--fs-small) var(--serif); color: var(--muted); font-variant-numeric: tabular-nums; }
.wr-ref-quote { margin: 4px 0 6px; padding-left: 12px; border-left: var(--line-quote); font: var(--fs-body)/1.5 var(--serif); color: var(--text); overflow-wrap: anywhere; }
.wr-ref-ask { margin: 4px 0 6px; font: italic var(--fs-body)/1.45 var(--serif); color: var(--muted); overflow-wrap: anywhere; }
.wr-ref-why { margin: 0 0 8px; font: var(--fs-small)/1.45 var(--sans); color: var(--muted); overflow-wrap: anywhere; }
.wr-ref-src { margin: 0 0 8px; font: italic var(--fs-small) var(--serif); color: var(--muted); }
.wr-quote-card { margin: 0 0 var(--gap); padding-left: 14px; border-left: var(--line-quote); font: var(--fs-lead)/1.6 var(--serif); color: var(--text); white-space: pre-wrap; overflow-wrap: anywhere; }
.wr-why-block { margin: 0 0 var(--gap); }
.wr-why-label { margin: 0 0 4px; font: 600 var(--fs-label) var(--sans); letter-spacing: var(--label-track); text-transform: var(--label-transform); font-variant-caps: var(--label-caps); color: var(--label-ink); }
.wr-why-text { margin: 0; font: var(--fs-body)/1.55 var(--serif); color: var(--text); }
.wr-letgo-toggle { margin-top: var(--gap); }
`;

// ── Responsive hook (wide column vs phone drawer) ──

function useWide(): boolean {
  const [wide, setWide] = useState(() => (typeof matchMedia === "function" ? matchMedia(WIDE_QUERY).matches : true));
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia(WIDE_QUERY);
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return wide;
}

// ── Quiet memoized piece editor (never re-renders the parent page per key) ──

export type EditorHandle = {
  insert(markdown: string): void;
  /** A change to the piece's fields, in turn with the body's saves, so the two never race on one version. */
  changeFields(fields: Record<string, unknown>): Promise<VaultRec>;
  flush(): Promise<string | null>;
  isDirty(): boolean;
  getBody(): string;
};

type SavedDraft = { body: string; base: string | null };

const draftKey = (id: string) => `draft:${id}`;
/** Where the caret was in each piece when its box last lost focus, so a quote inserted from the Reference page (where
 *  the editor isn't mounted) lands where the writer left off. */
const caretOf = new Map<string, [number, number]>();
/** The last version of each piece this applet saved. A save can land after its editor is gone (Details, Back): the
 *  next editor on the piece knows that version as its own, not as someone else's change. */
const ownVersion = new Map<string, string>();
const readSavedDraft = (id: string): SavedDraft | null => {
  try {
    const raw = saved?.get?.(draftKey(id)) as SavedDraft | null | undefined;
    return raw && typeof raw === "object" && typeof raw.body === "string" ? raw : null;
  } catch {
    return null;
  }
};
const writeSavedDraft = (id: string, value: SavedDraft | null) => {
  try {
    saved?.set?.(draftKey(id), value);
  } catch {
    // ignore outside frame
  }
};

type PieceEditorProps = {
  pieceId: string;
  initialBody: string;
  baseUpdatedAt: string | null;
  onSaved: (updated: VaultRec, body: string) => void;
  onReloadPiece: () => void;
  editorRef: Ref<EditorHandle | null>;
};

const PieceEditor = memo(function PieceEditor({
  pieceId,
  initialBody,
  baseUpdatedAt,
  onSaved,
  onReloadPiece,
  editorRef,
}: PieceEditorProps) {
  const [initialDraft] = useState(() => {
    const kept = readSavedDraft(pieceId);
    if (kept && kept.body === initialBody) writeSavedDraft(pieceId, null); // it reached the hub: nothing to keep
    if (!kept || kept.body === initialBody) return null;
    // a draft written while this applet's own save was out: that save is its version now
    return baseUpdatedAt && ownVersion.get(pieceId) === baseUpdatedAt ? { ...kept, base: baseUpdatedAt } : kept;
  });

  const [body, setBody] = useState<string>(() => initialDraft?.body ?? initialBody);
  const [status, setStatus] = useState<"idle" | "dirty" | "saving" | "saved" | "conflict" | "error">(() =>
    initialDraft ? "dirty" : "idle",
  );

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const bodyRef = useRef(body);
  bodyRef.current = body;
  const savedBodyRef = useRef(initialBody);
  const baseRef = useRef<string | null>(initialDraft?.base ?? baseUpdatedAt);
  const statusRef = useRef(status);
  statusRef.current = status;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflightRef = useRef<Promise<void> | null>(null);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  /** Reload piece was chosen: this editor's words are let go, not kept as a draft. */
  const discarded = useRef(false);

  // A newer version of the piece than this editor saved against (the piece read again, or this editor's own save that
  // landed after it was made again). Taken only where nothing unsaved is lost; with unsaved words here, the next save
  // is refused (409) and Reload piece is offered. Not on mount: a kept draft keeps the version it was written against.
  // (One editor per piece: the page keys it by the piece's id.)
  const lastProps = useRef({ initialBody, baseUpdatedAt });
  useEffect(() => {
    const was = lastProps.current;
    if (was.initialBody === initialBody && was.baseUpdatedAt === baseUpdatedAt) return;
    lastProps.current = { initialBody, baseUpdatedAt };
    if (!baseUpdatedAt || statusRef.current === "conflict") return; // after a conflict, Reload piece makes a new editor
    if (baseRef.current && baseUpdatedAt <= baseRef.current) return; // this editor has it already
    if (ownVersion.get(pieceId) === baseUpdatedAt) {
      // this applet's own save, landed after the editor that made it was gone: the words here build on it
      baseRef.current = baseUpdatedAt;
      savedBodyRef.current = initialBody;
      if (bodyRef.current === initialBody) writeSavedDraft(pieceId, null);
    } else if (bodyRef.current === initialBody) {
      // the hub has what this editor shows
      baseRef.current = baseUpdatedAt;
      savedBodyRef.current = initialBody;
      writeSavedDraft(pieceId, null);
      if (statusRef.current === "dirty") setStatusOnce("saved");
    } else if (bodyRef.current === savedBodyRef.current) {
      // nothing unsaved here: show the piece as the hub has it now
      baseRef.current = baseUpdatedAt;
      savedBodyRef.current = initialBody;
      bodyRef.current = initialBody;
      setBody(initialBody);
    }
  }, [initialBody, baseUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const setStatusOnce = (next: typeof status) => {
    if (statusRef.current !== next) {
      statusRef.current = next;
      setStatus(next);
    }
  };

  const persistNow = useCallback(async (): Promise<string | null> => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (statusRef.current === "conflict") return baseRef.current;
    const text = bodyRef.current;
    if (text === savedBodyRef.current) {
      writeSavedDraft(pieceId, null);
      return baseRef.current;
    }
    const base = baseRef.current;
    if (!base) {
      setStatusOnce("error");
      toast("This piece has no version to save against. Reload it first.", { error: true });
      return null;
    }
    if (inflightRef.current) {
      await inflightRef.current;
      if (bodyRef.current !== savedBodyRef.current) return persistNow();
      return baseRef.current;
    }
    setStatusOnce("saving");
    const run = (async () => {
      try {
        const updated: VaultRec = await vault.updateRecord(pieceId, { body: text, if_updated_at: base });
        baseRef.current = updated.updatedAt ?? base;
        if (updated.updatedAt) ownVersion.set(pieceId, updated.updatedAt);
        savedBodyRef.current = text;
        if (bodyRef.current === text) {
          writeSavedDraft(pieceId, null);
          setStatusOnce("saved");
        } else {
          // More was typed while the save was in flight: save again
          setStatusOnce("dirty");
          timerRef.current = setTimeout(() => void persistNow(), SAVE_DEBOUNCE_MS);
        }
        onSavedRef.current(updated, text);
      } catch (e: unknown) {
        writeSavedDraft(pieceId, { body: bodyRef.current, base });
        const conflict = (e as { status?: number })?.status === 409;
        if (conflict) {
          setStatusOnce("conflict");
          toast("Someone else changed this piece. Copy your latest edits, then reload.", { error: true });
        } else {
          setStatusOnce("error");
          toast(`Not saved: ${e instanceof Error ? e.message : String(e)}`, { error: true });
        }
      } finally {
        inflightRef.current = null;
      }
    })();
    inflightRef.current = run;
    await run;
    return baseRef.current;
  }, [pieceId]);

  const changeFields = useCallback(
    async (fields: Record<string, unknown>): Promise<VaultRec> => {
      await persistNow();
      while (inflightRef.current) await inflightRef.current;
      const base = baseRef.current;
      if (!base) throw new Error("This piece has no version to change. Reload it first.");
      const run = vault.updateRecord(pieceId, { if_updated_at: base, fields }).then((updated: VaultRec) => {
        baseRef.current = updated.updatedAt ?? base;
        if (updated.updatedAt) ownVersion.set(pieceId, updated.updatedAt);
        return updated;
      });
      // a save that comes due meanwhile waits for this, then saves on the new version
      const turn: Promise<void> = run.then(
        () => undefined,
        () => undefined,
      ).finally(() => {
        if (inflightRef.current === turn) inflightRef.current = null;
      });
      inflightRef.current = turn;
      return run;
    },
    [pieceId, persistNow],
  );

  const scheduleSave = useCallback(
    (next: string) => {
      bodyRef.current = next;
      if (statusRef.current !== "conflict") setStatusOnce("dirty");
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void persistNow(), SAVE_DEBOUNCE_MS);
    },
    [pieceId, persistNow],
  );

  const handleChange = useCallback(
    (next: string) => {
      setBody(next);
      scheduleSave(next);
    },
    [scheduleSave],
  );

  // Remember the caret when the box loses focus (a tap on Insert quote, Details, the drawer)
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const keep = () => caretOf.set(pieceId, [el.selectionStart, el.selectionEnd]);
    el.addEventListener("blur", keep);
    return () => el.removeEventListener("blur", keep);
  }, [pieceId]);

  // Keep a draft on this device and save when the applet goes to the background; keep it when the editor goes away.
  // Not on every key: `saved` writes its whole store, and a long piece would make each keystroke cost that.
  useEffect(() => {
    const off =
      typeof onShown === "function"
        ? onShown((visible: boolean) => {
            if (visible) return;
            if (bodyRef.current !== savedBodyRef.current) writeSavedDraft(pieceId, { body: bodyRef.current, base: baseRef.current });
            void persistNow();
          })
        : undefined;
    return () => {
      off?.();
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (!discarded.current && bodyRef.current !== savedBodyRef.current) {
        writeSavedDraft(pieceId, { body: bodyRef.current, base: baseRef.current });
      }
    };
  }, [pieceId, persistNow]);

  useImperativeHandle(
    editorRef,
    () => ({
      insert(markdown: string) {
        const el = textareaRef.current;
        const current = bodyRef.current;
        const focused = !!el && el.ownerDocument.activeElement === el;
        const [start, end] = focused
          ? [el.selectionStart, el.selectionEnd]
          // never touched: at the end (an unfocused box's selection differs between browsers, often the top)
          : caretOf.get(pieceId) ?? [current.length, current.length];
        const { text, cursor } = insertAtSelection(current, markdown, start, end);
        caretOf.set(pieceId, [cursor, cursor]);
        setBody(text);
        scheduleSave(text);
        requestAnimationFrame(() => {
          const box = textareaRef.current;
          if (!box) return;
          box.focus();
          box.setSelectionRange(cursor, cursor);
        });
      },
      flush: persistNow,
      changeFields,
      isDirty: () => bodyRef.current !== savedBodyRef.current,
      getBody: () => bodyRef.current,
    }),
    [pieceId, persistNow, scheduleSave, changeFields],
  );

  const noteText =
    status === "saving"
      ? "Saving…"
      : status === "saved"
        ? "Saved"
        : status === "dirty"
          ? "Unsaved edits"
          : status === "conflict"
            ? "Changed elsewhere — reload to sync"
            : status === "error"
              ? "Save paused — try Save"
              : "";

  return (
    <div className="wr-editor">
      <Write
        label="Piece"
        value={body}
        onChange={handleChange}
        onSend={persistNow}
        send={status === "saving" ? "Saving…" : "Save"}
        canSend={status === "dirty" || status === "error"}
        busy={status === "saving"}
        placeholder="Begin writing…"
        inputRef={textareaRef}
      >
        {status === "conflict" && (
          <Button small onClick={() => { discarded.current = true; writeSavedDraft(pieceId, null); onReloadPiece(); }}>
            Reload piece
          </Button>
        )}
        {noteText && <span className="wr-save-note">{noteText}</span>}
      </Write>
    </div>
  );
});

// ── Beside-it panel (used inside the right column on wide screens and inside Drawer on phones) ──

type BesidePanelProps = {
  refsFolder: string;
  active: VaultRec[];
  letGo: VaultRec[];
  loading: boolean;
  error: unknown;
  hideHeading?: boolean;
  onRetry: () => void;
  onAsk: (line: string) => Promise<void>;
  onInsert: (ref: VaultRec) => void;
  onOpenSource: (ref: VaultRec) => void;
  onOpenRef: (ref: VaultRec) => void;
};

const BesidePanel = memo(function BesidePanel({
  refsFolder,
  active,
  letGo,
  loading,
  error,
  hideHeading = false,
  onRetry,
  onAsk,
  onInsert,
  onOpenSource,
  onOpenRef,
}: BesidePanelProps) {
  const [showLetGo, setShowLetGo] = useState(false);

  return (
    <section aria-label="Beside it">
      {!hideHeading && (
        <div className="wr-beside-head">
          <h2 className="wr-beside-title">Beside it</h2>
          <span className="wr-beside-count">{active.length}</span>
        </div>
      )}
      <Field
        label="Ask Uni"
        placeholder="Ask for a quote, source, or detail…"
        action="Ask"
        onAction={onAsk}
      />
      {error ? (
        <Problem error={error} onRetry={onRetry}>Could not read references in {refsFolder}.</Problem>
      ) : loading ? (
        <Loading>Reading references…</Loading>
      ) : active.length === 0 ? (
        <Empty>No references for this piece yet. Ask Uni above, or prepare materials linked to this piece.</Empty>
      ) : (
        active.map((ref) => {
          const state = refStateOf(ref);
          const src = refSource(ref);
          const quote = refQuote(ref);
          const why = refWhy(ref);
          const asked = state === "asked";
          return (
            <article key={ref.id} className="wr-ref" aria-label={recordTitle(ref, refsFolder)}>
              <div className="wr-ref-head">
                <span className="wr-ref-state">{REF_STATE_LABELS[state]}</span>
                <span className="wr-ref-time">{when.short(refTimestamp(ref))}</span>
              </div>
              {asked ? (
                <p className="wr-ref-ask">{quote || recordTitle(ref, refsFolder)}</p>
              ) : (
                <>
                  <blockquote className="wr-ref-quote">{quote || recordTitle(ref, refsFolder)}</blockquote>
                  <p className="wr-ref-src">
                    {src.author ? `${src.author} · ` : ""}
                    {src.label}
                  </p>
                </>
              )}
              {why && <p className="wr-ref-why">{why}</p>}
              <div className="pa-actions">
                {!asked && (
                  <Button small onClick={() => onInsert(ref)}>
                    Insert quote
                  </Button>
                )}
                {src.url && (
                  <Button small kind="quiet" onClick={() => onOpenSource(ref)}>
                    Open source
                  </Button>
                )}
                <Button small kind="quiet" onClick={() => onOpenRef(ref)}>
                  Details
                </Button>
              </div>
            </article>
          );
        })
      )}
      {letGo.length > 0 && (
        <div className="wr-letgo-toggle">
          <Button small kind="quiet" onClick={() => setShowLetGo((v) => !v)}>
            {showLetGo ? "Hide let go" : `Let go · ${letGo.length}`}
          </Button>
          {showLetGo && (
            <List
              label="Let go"
              hideLabel
              rows={letGo.map((r) => ({
                key: r.id,
                title: recordTitle(r, refsFolder),
                meta: refWhy(r) || refSource(r).label,
                aside: when.short(refTimestamp(r)),
                onPress: () => onOpenRef(r),
              }))}
            />
          )}
        </div>
      )}
    </section>
  );
});

// ── Reference page ──

type ReferenceViewProps = {
  reference: VaultRec;
  refsFolder: string;
  backLabel: string;
  fromPiece: boolean;
  onBackPress: () => void;
  onSetState: (ref: VaultRec, next: "kept" | "let go") => Promise<void>;
  onInsert?: (ref: VaultRec) => void;
  onOpenSource: (ref: VaultRec) => void;
};

function ReferenceView({
  reference,
  refsFolder,
  backLabel,
  fromPiece,
  onBackPress,
  onSetState,
  onInsert,
  onOpenSource,
}: ReferenceViewProps) {
  const [busy, setBusy] = useState<"kept" | "let go" | null>(null);
  const state = refStateOf(reference);
  const quote = refQuote(reference);
  const src = refSource(reference);
  const why = refWhy(reference);
  const asked = state === "asked";
  const title = recordTitle(reference, refsFolder);
  const extraBody = str(reference.fields?.quote) ? (reference.body ?? "").trim() : "";

  const choose = async (next: "kept" | "let go") => {
    setBusy(next);
    try {
      await onSetState(reference, next);
    } finally {
      setBusy(null);
    }
  };

  const sourceFields = [
    { name: "source", label: "Source", value: src.label, readOnly: true },
    ...(src.author ? [{ name: "author", label: "Author", value: src.author, readOnly: true }] : []),
    { name: "state", label: "State", value: REF_STATE_LABELS[state], readOnly: true },
  ];

  return (
    <Page
      title={title}
      kicker={`Reference · ${REF_STATE_LABELS[state]}`}
      back={{ label: backLabel, onPress: onBackPress }}
    >
      <style>{CSS}</style>
      <Card title={asked ? "Asked Uni" : "Quote"}>
        <blockquote className="wr-quote-card">{quote || "No quote recorded yet."}</blockquote>
        {src.url && (
          <p className="wr-ref-src">
            <Link to={src.url} from={reference.path}>
              {src.label}
            </Link>
          </p>
        )}
      </Card>

      {why && (
        <section className="wr-why-block" aria-label="Why it fits">
          <p className="wr-why-label">Why it fits</p>
          <p className="wr-why-text">{why}</p>
        </section>
      )}

      <Fields label="About this reference" fields={sourceFields} />

      <div className="pa-actions">
        {!asked && (
          <Button
            kind={state === "kept" ? "plain" : "primary"}
            busy={busy === "kept"}
            disabled={state === "kept" || busy !== null}
            onClick={() => void choose("kept")}
          >
            {state === "kept" ? "Kept" : "Keep"}
          </Button>
        )}
        <Button
          busy={busy === "let go"}
          disabled={state === "let go" || busy !== null}
          onClick={() => void choose("let go")}
        >
          Let go
        </Button>
        {fromPiece && !asked && onInsert && (
          <Button onClick={() => onInsert(reference)}>Insert as quote</Button>
        )}
        {src.url && (
          <Button kind="quiet" onClick={() => onOpenSource(reference)}>
            Open source
          </Button>
        )}
      </div>

      {extraBody && extraBody !== quote && (
        <Note id={reference.id} body={extraBody} path={reference.path} tags={reference.tags} fields={reference.fields} />
      )}
    </Page>
  );
}

// ── Main applet ──

/** Every piece in the folder, last touched first, a page of 50 at a time (up to 1,000). An older hub that won't
 *  order the query gets it unordered; the list sorts by last touched itself. */
async function allPieces(folder: string): Promise<VaultRec[]> {
  const page = (offset: number, ordered: boolean): Promise<VaultRec[]> =>
    vault.queryRecords({ pathPrefix: folder, includeFields: true, limit: 50, offset, ...(ordered ? { orderBy: "updated_at", sort: "desc" } : {}) });
  let ordered = true;
  let rows: VaultRec[];
  try {
    rows = await page(0, true);
  } catch {
    ordered = false;
    rows = await page(0, false);
  }
  const seen = new Set(rows.map((r) => r.id));
  for (let got = rows, offset = rows.length; got.length === 50 && offset < 1000; offset += got.length) {
    got = await page(offset, ordered);
    if (got.length && got.every((r, i) => r.id === rows[i]?.id)) break; // the first page again: this hub doesn't page
    const fresh = got.filter((r) => !seen.has(r.id));
    for (const r of fresh) seen.add(r.id);
    rows = rows.concat(fresh);
  }
  return rows;
}

type Beside = { active: VaultRec[]; letGo: VaultRec[]; loading: boolean; error: unknown };
const NO_BESIDE: Beside = { active: [], letGo: [], loading: false, error: null };

export default function Writing() {
  const wide = useWide();
  const [folders, setFolders] = useState<{ pieces: string; refs: string }>({
    pieces: DEFAULT_PIECES_FOLDER,
    refs: DEFAULT_REFS_FOLDER,
  });
  const foldersRef = useRef(folders);
  foldersRef.current = folders;

  const [pieces, setPieces] = useState<VaultRec[] | null>(null);
  const [piecesError, setPiecesError] = useState<unknown>(null);
  const [query, setQuery] = useState("");
  const [stageTab, setStageTab] = useSaved<string>("stage", "all");

  const [selectedPieceId, setSelectedPieceId] = useSaved<string | null>("piece", null);
  const [selectedPiece, setSelectedPiece] = useState<VaultRec | null>(null);
  const selectedPieceRef = useRef(selectedPiece);
  selectedPieceRef.current = selectedPiece;
  const [pieceError, setPieceError] = useState<unknown>(null);

  const [beside, setBeside] = useState<Beside>(NO_BESIDE);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [openRef, setOpenRef] = useState<VaultRec | null>(null);
  const editorRef = useRef<EditorHandle | null>(null);
  /** A quote chosen on the Reference page, put in once the piece's editor is back. */
  const pendingInsert = useRef<string | null>(null);
  const piecesSeq = useRef(0);
  const openSeq = useRef(0);
  const besideSeq = useRef(0);

  // the search as typed now, for a load started from a callback made before it (openReferenceById, on mount)
  const queryRef = useRef(query);
  queryRef.current = query;
  const loadPieces = useCallback(async (search = queryRef.current, folder = foldersRef.current.pieces) => {
    const n = ++piecesSeq.current;
    try {
      const rows: VaultRec[] = search
        ? await vault.queryRecords({ pathPrefix: folder, search, includeFields: true, limit: 50 })
        : await allPieces(folder);
      if (n !== piecesSeq.current) return;
      setPieces(rows);
      setPiecesError(null);
    } catch (e) {
      if (n === piecesSeq.current) setPiecesError(e);
    }
  }, [query]);

  const loadBeside = useCallback(async (piece: VaultRec, refsFolder = foldersRef.current.refs, piecesFolder = foldersRef.current.pieces) => {
    const n = ++besideSeq.current;
    setBeside((prev) => ({ ...prev, loading: prev.active.length === 0 && prev.letGo.length === 0, error: null }));
    try {
      const res = await queryBeside(vault, refsFolder, piece, piecesFolder);
      if (n !== besideSeq.current) return;
      setBeside({ active: res.active, letGo: res.letGo, loading: false, error: null });
    } catch (e) {
      if (n === besideSeq.current) setBeside((prev) => ({ ...prev, loading: false, error: e }));
    }
  }, []);

  const openPiece = useCallback(
    async (id: string, f = foldersRef.current) => {
      const n = ++openSeq.current;
      if (selectedPieceRef.current?.id !== id) {
        // another piece: nothing of the last one shows under it while this one loads
        besideSeq.current++;
        setBeside({ ...NO_BESIDE, loading: true });
        setSelectedPiece(null);
        pendingInsert.current = null;
      }
      setSelectedPieceId(id);
      setOpenRef(null);
      setPieceError(null);
      try {
        const full: VaultRec | null = await vault.getRecord(id, { includeLinks: true }).catch(() => vault.getRecord(id));
        if (n !== openSeq.current) return;
        if (!full) {
          setSelectedPiece(null);
          setSelectedPieceId(null);
          toast("That piece is no longer in this vault.", { error: true });
          return;
        }
        setSelectedPiece(full);
        void loadBeside(full, f.refs, f.pieces);
      } catch (e) {
        if (n === openSeq.current) setPieceError(e);
      }
    },
    [loadBeside, setSelectedPieceId],
  );

  /** A reference opened from outside (a link, Vault, the app's launch). It stays with the open piece only when it is
   *  for that piece; else the piece closes, so the Reference page doesn't offer to insert it there. */
  const openReferenceById = useCallback(async (id: string) => {
    try {
      await editorRef.current?.flush();
      const full: VaultRec | null = await vault.getRecord(id, { includeLinks: true });
      if (!full) {
        toast("That reference is no longer in this vault.", { error: true });
        return;
      }
      const piece = selectedPieceRef.current;
      if (!piece || !matchesPiece(full, piece, foldersRef.current.pieces)) {
        openSeq.current++;
        besideSeq.current++;
        setBeside(NO_BESIDE);
        setSelectedPiece(null);
        setSelectedPieceId(null);
        pendingInsert.current = null;
        void loadPieces();
      }
      setOpenRef(full);
    } catch (e) {
      toast(`Could not open reference: ${e instanceof Error ? e.message : String(e)}`, { error: true });
    }
  }, [setSelectedPieceId, loadPieces]);

  useEffect(() => {
    let active = true;
    ready().then((ctx: { access?: { path: string; verbs: string[] }[]; open?: { note: { id: string; path: string } } }) => {
      if (!active) return;
      const f = foldersFromAccess(ctx?.access);
      foldersRef.current = f;
      setFolders(f);
      void loadPieces("", f.pieces);
      const initialNote = ctx?.open?.note;
      if (initialNote) {
        if (initialNote.path.startsWith(f.refs)) void openReferenceById(initialNote.id);
        else void openPiece(initialNote.id, f);
      } else if (selectedPieceId) {
        void openPiece(selectedPieceId, f);
      }
    }).catch((e: unknown) => {
      if (active) setPiecesError(e);
    });
    const offOpen = onOpen((o: { note: { id: string; path: string } }) => {
      const f = foldersRef.current;
      if (o.note.path.startsWith(f.refs)) {
        void openReferenceById(o.note.id);
      } else {
        // the open piece saves first; with none open, straight on
        void Promise.resolve(editorRef.current?.flush()).finally(() => void openPiece(o.note.id, f));
      }
    });
    return () => {
      active = false;
      offOpen?.();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const closePiece = useCallback(() => {
    // the list is read once the last save has landed, so the piece sorts by its new time
    void Promise.resolve(editorRef.current?.flush()).finally(() => void loadPieces());
    openSeq.current++;
    besideSeq.current++;
    setBeside(NO_BESIDE);
    setDrawerOpen(false);
    setOpenRef(null);
    setSelectedPiece(null);
    setSelectedPieceId(null);
    pendingInsert.current = null;
  }, [loadPieces, setSelectedPieceId]);

  const closeRef = useCallback(() => setOpenRef(null), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // Back button chain: Reference page -> Phone Drawer -> Piece -> List
  useEffect(() => {
    if (typeof onBack !== "function") return;
    if (openRef) return onBack(closeRef);
    if (drawerOpen) return onBack(closeDrawer);
    if (selectedPieceId) return onBack(closePiece);
    return undefined;
  }, [openRef, drawerOpen, selectedPieceId, closeRef, closeDrawer, closePiece]);

  const addPiece = useCallback(
    async (rawTitle: string) => {
      const name = cleanName(rawTitle, "");
      if (!name) return;
      const path = `${foldersRef.current.pieces}${name}`;
      try {
        // no `types`: the app gives it the `piece` the applet opens here, as the vault has it (buildAskRecord)
        const made: VaultRec = await vault.createRecord({ path, body: "", fields: { stage: "seed" } });
        toast(`Started ${name}.`);
        await loadPieces();
        await openPiece(made.id);
      } catch (e) {
        toast(`Could not start piece: ${e instanceof Error ? e.message : String(e)}`, { error: true });
        throw e; // the title stays in the box
      }
    },
    [loadPieces, openPiece],
  );

  const handlePieceSaved = useCallback((updated: VaultRec, body: string) => {
    setSelectedPiece((prev) => (prev && prev.id === updated.id ? { ...prev, ...updated, body } : prev));
    setPieces((prev) =>
      prev ? prev.map((p) => (p.id === updated.id ? { ...p, updatedAt: updated.updatedAt ?? p.updatedAt } : p)) : prev,
    );
  }, []);

  const handleStageChange = useCallback(
    async (_name: string, nextValue: unknown) => {
      const selectedPiece = selectedPieceRef.current;
      if (!selectedPiece) return;
      const next = str(nextValue).toLowerCase() as Stage;
      // A refusal throws, so Fields puts the stage it showed back
      if (!EDITABLE_STAGES.includes(next) || !stageEditable(selectedPiece)) {
        throw new Error(`Writing moves a piece only between seed and draft.`);
      }
      const editor = editorRef.current;
      if (!editor) throw new Error("The piece isn't open.");
      try {
        const updated: VaultRec = await editor.changeFields({ stage: next });
        setSelectedPiece((prev) =>
          prev && prev.id === updated.id
            ? { ...prev, ...updated, fields: { ...(prev.fields ?? {}), stage: next } }
            : prev,
        );
        toast(`Moved to ${STAGE_LABELS[next]}.`);
        void loadPieces();
      } catch (e) {
        toast(`Could not update stage: ${e instanceof Error ? e.message : String(e)}`, { error: true });
        throw e;
      }
    },
    [loadPieces],
  );

  const handleAskUni = useCallback(
    async (line: string) => {
      const piece = selectedPieceRef.current;
      if (!piece) return;
      const payload = buildAskRecord(foldersRef.current.refs, piece, line, new Date(), foldersRef.current.pieces);
      try {
        // two asks alike in one minute share a name: the second is "… (2)"
        for (let n = 1; ; n++) {
          try {
            await vault.createRecord(n === 1 ? payload : { ...payload, path: `${payload.path} (${n})` });
            break;
          } catch (e) {
            if ((e as { status?: number })?.status !== 409 || n >= 5) throw e;
          }
        }
        toast("Asked Uni.");
        await loadBeside(piece);
      } catch (e) {
        toast(`Could not ask Uni: ${e instanceof Error ? e.message : String(e)}`, { error: true });
        throw e;
      }
    },
    [loadBeside],
  );

  /** A reference as just saved, wherever the page holds it: Beside it (both lists) and its own page. */
  const patchReference = useCallback((updated: VaultRec) => {
    const swap = (list: VaultRec[]) => list.map((r) => (r.id === updated.id ? { ...r, ...updated } : r));
    setBeside((prev) => ({ ...prev, active: swap(prev.active), letGo: swap(prev.letGo) }));
    setOpenRef((cur) => (cur && cur.id === updated.id ? { ...cur, ...updated } : cur));
  }, []);

  // These read the open piece from its ref, so the Beside-it panel and the editor keep the same callbacks when a
  // save replaces selectedPiece (no re-render of the whole list after each save)
  const handleInsertQuote = useCallback(
    (ref: VaultRec) => {
      const md = formatQuoteMarkdown(ref);
      if (editorRef.current) editorRef.current.insert(md);
      else pendingInsert.current = md;
      setDrawerOpen(false);
      setOpenRef(null);
      toast("Inserted quote.");
      const piece = selectedPieceRef.current;
      if (!piece) return;
      void noteUsedIn(ref, pieceName(piece, foldersRef.current.pieces))
        .then((updated) => {
          if (updated) patchReference(updated);
        })
        .catch((e: unknown) =>
          toast(`The quote is in; the reference didn't note where: ${e instanceof Error ? e.message : String(e)}`, { error: true }),
        );
    },
    [patchReference],
  );

  const handleOpenSource = useCallback((ref: VaultRec) => {
    const src = refSource(ref);
    if (!src.url) return;
    void link.follow(src.url, { from: ref.path }).then((ok: boolean) => {
      if (!ok) toast("Could not open that source here.", { error: true });
    });
  }, []);

  const handleOpenRef = useCallback((ref: VaultRec) => {
    // The Reference page replaces the piece view, so its editor saves first
    void editorRef.current?.flush();
    setDrawerOpen(false);
    setOpenRef(ref);
  }, []);

  // Back from the Reference page with a quote to put in: the editor is mounted again by now
  useEffect(() => {
    if (openRef || !pendingInsert.current || !editorRef.current) return;
    editorRef.current.insert(pendingInsert.current);
    pendingInsert.current = null;
  }, [openRef, selectedPiece]);

  const handleRefState = useCallback(
    async (ref: VaultRec, next: "kept" | "let go") => {
      try {
        const updated = (await changeReference(ref, () => ({ state: next }))) ?? ref;
        toast(next === "kept" ? "Kept." : "Let go.");
        const piece = selectedPieceRef.current;
        if (piece) await loadBeside(piece);
        setOpenRef(piece && next === "let go" ? null : updated);
      } catch (e) {
        toast(`Could not update reference: ${e instanceof Error ? e.message : String(e)}`, { error: true });
      }
    },
    [loadBeside],
  );

  // A new editor on the piece as the hub has it (the old one's words were let go)
  const [reloads, setReloads] = useState(0);
  const handleReloadPiece = useCallback(() => {
    const piece = selectedPieceRef.current;
    if (piece) void openPiece(piece.id).then(() => setReloads((n) => n + 1));
  }, [openPiece]);

  const handleRetryBeside = useCallback(() => {
    const piece = selectedPieceRef.current;
    if (piece) void loadBeside(piece);
  }, [loadBeside]);

  // ── View 1: Reference page ──
  if (openRef) {
    return (
      <ReferenceView
        reference={openRef}
        refsFolder={folders.refs}
        backLabel={selectedPiece ? recordTitle(selectedPiece, folders.pieces) : "Writing"}
        fromPiece={!!selectedPiece}
        onBackPress={closeRef}
        onSetState={handleRefState}
        onInsert={selectedPiece ? handleInsertQuote : undefined}
        onOpenSource={handleOpenSource}
      />
    );
  }

  // ── View 2: Piece editor + Beside it ──
  if (selectedPieceId) {
    if (pieceError) {
      return (
        <Page title="Writing" back={{ label: "Writing", onPress: closePiece }}>
          <style>{CSS}</style>
          <Problem error={pieceError} onRetry={() => void openPiece(selectedPieceId)}>
            Could not open this piece.
          </Problem>
        </Page>
      );
    }
    if (!selectedPiece) {
      return (
        <Page title="Writing" back={{ label: "Writing", onPress: closePiece }}>
          <style>{CSS}</style>
          <Loading>Opening piece…</Loading>
        </Page>
      );
    }

    const stage = stageOf(selectedPiece);
    const title = recordTitle(selectedPiece, folders.pieces);
    const slug = str(selectedPiece.fields?.slug);
    const url = str(selectedPiece.fields?.url);
    const publishedAt = str(selectedPiece.fields?.published_at);
    const publishedDate = publishedAt ? when.date(publishedAt) || publishedAt : "";
    const canMove = stageEditable(selectedPiece);
    const rawStage = str(selectedPiece.fields?.stage);
    const stageShown = STAGE_LABELS[rawStage.toLowerCase() as Stage] ?? rawStage;
    const showSite = stage === "published" || stage === "ready";
    const besidePanel = (
      <BesidePanel
        refsFolder={folders.refs}
        active={beside.active}
        letGo={beside.letGo}
        loading={beside.loading}
        error={beside.error}
        hideHeading={!wide}
        onRetry={handleRetryBeside}
        onAsk={handleAskUni}
        onInsert={handleInsertQuote}
        onOpenSource={handleOpenSource}
        onOpenRef={handleOpenRef}
      />
    );

    return (
      <Page
        title={title}
        kicker={
          selectedPiece.updatedAt
            ? `${stageShown} · Updated ${when.short(selectedPiece.updatedAt)}`
            : stageShown
        }
        back={{ label: "Writing", onPress: closePiece }}
        wide={wide}
        aside={
          !wide ? (
            <Button small onClick={() => setDrawerOpen(true)}>
              {beside.active.length ? `Beside it · ${beside.active.length}` : "Beside it"}
            </Button>
          ) : undefined
        }
      >
        <style>{CSS}</style>
        <div className="wr-split">
          <div className="wr-main">
            <PieceEditor
              key={`${selectedPiece.id}:${reloads}`}
              pieceId={selectedPiece.id}
              initialBody={selectedPiece.body ?? ""}
              baseUpdatedAt={selectedPiece.updatedAt}
              onSaved={handlePieceSaved}
              onReloadPiece={handleReloadPiece}
              editorRef={editorRef}
            />
            <section className="wr-published">
              <Fields
                label="Piece details"
                onSave={canMove ? handleStageChange : undefined}
                fields={[
                  canMove
                    ? { name: "stage", label: "Stage", kind: "choice", choices: [...EDITABLE_STAGES], value: stage }
                    : { name: "stage", label: "Stage", value: stageShown, readOnly: true },
                  ...(showSite
                    ? [
                        { name: "slug", label: "Slug", value: slug || "–", readOnly: true },
                        { name: "url", label: "URL", value: url || "–", readOnly: true },
                        { name: "published_at", label: "Published", value: publishedDate || "–", readOnly: true },
                      ]
                    : []),
                ]}
              />
              {stage === "published" && url && (
                <p className="wr-ref-src">
                  <Link to={url}>Open published piece</Link>
                </p>
              )}
            </section>
          </div>
          {wide && <aside className="wr-beside">{besidePanel}</aside>}
        </div>
        {!wide && (
          <Drawer
            open={drawerOpen}
            onClose={closeDrawer}
            title={beside.active.length ? `Beside it · ${beside.active.length}` : "Beside it"}
          >
            {besidePanel}
          </Drawer>
        )}
      </Page>
    );
  }

  // ── View 3: Pieces list by stage, last touched first ──
  const grouped = groupPiecesByStage(pieces ?? []);
  const tabs = [
    { key: "all", label: "All", count: pieces?.length ?? 0 },
    // Ready is the site's in-between stage: a tab only when a piece is in it
    ...STAGES.filter((s) => s !== "ready" || grouped.ready.length > 0).map((s) => ({ key: s, label: STAGE_LABELS[s], count: grouped[s].length })),
  ];
  const currentTab = tabs.some((t) => t.key === stageTab) ? stageTab : "all";
  const visibleStages: Stage[] = currentTab === "all" ? [...STAGES] : [currentTab as Stage];

  const pieceRow = (p: VaultRec) => {
    const stage = stageOf(p);
    const slug = str(p.fields?.slug);
    const pub = str(p.fields?.published_at);
    const meta =
      stage === "published" || stage === "ready"
        ? [slug, pub ? when.date(pub) || pub : ""].filter(Boolean).join(" · ")
        : undefined;
    return {
      key: p.id,
      title: recordTitle(p, folders.pieces),
      meta: meta || undefined,
      aside: when.short(p.updatedAt),
      onPress: () => void openPiece(p.id),
    };
  };

  return (
    <Page title="Writing" kicker="Pieces" onRefresh={() => void loadPieces()}>
      <style>{CSS}</style>
      <Days times={(pieces ?? []).map((p) => p.updatedAt)} label="Writing activity, the last four weeks" />
      <Field label="New piece" placeholder="Title" action="Start" onAction={addPiece} />
      <Search
        label="Search pieces"
        placeholder="Search pieces"
        value={query}
        onChange={setQuery}
        onSearch={(term: string) => void loadPieces(term)}
        live={250}
      />
      <Tabs label="Stages" tabs={tabs} current={currentTab} onChange={setStageTab} />
      {piecesError ? (
        <Problem error={piecesError} onRetry={() => void loadPieces()}>
          Could not read pieces in {folders.pieces}.
        </Problem>
      ) : pieces === null ? (
        <Loading>Reading pieces…</Loading>
      ) : pieces.length === 0 ? (
        <Empty>{query ? `Nothing matches “${query}”.` : `No pieces in ${folders.pieces} yet. Start one above.`}</Empty>
      ) : currentTab === "all" ? (
        visibleStages.map((s) =>
          grouped[s].length > 0 ? (
            <List key={s} label={`${STAGE_LABELS[s]} · ${grouped[s].length}`} rows={grouped[s].map(pieceRow)} />
          ) : null,
        )
      ) : grouped[currentTab as Stage].length === 0 ? (
        <Empty>No {STAGE_LABELS[currentTab as Stage].toLowerCase()} pieces yet.</Empty>
      ) : (
        <List
          label={STAGE_LABELS[currentTab as Stage]}
          hideLabel
          rows={grouped[currentTab as Stage].map(pieceRow)}
        />
      )}
    </Page>
  );
}
