// Ambient types for Parachute TSX/JSX applets (`import { ... } from "parachute"`).
// Kept in sync with src/applet/kits/modules.ts (PART_NAMES) and src/applet/kits/frameKit.ts: src/applet/check.test.ts
// holds every part name to it and type-checks applets/starter.tsx against it.
declare module "parachute" {
  import type { ButtonHTMLAttributes, KeyboardEvent, ReactNode, Ref } from "react";

  // ── Lifecycle & host context ──
  export interface ReadyContext {
    contract?: number;
    applet: { id: string; name: string };
    access: { path: string; verbs: ("read" | "create" | "update")[] }[];
    services: Record<string, unknown>[];
    theme?: Record<string, string>;
    open?: { note: { id: string; path: string }; screen: string };
    launch?: { room?: string; event?: string; vault?: string; record?: string; show?: "changes" | "sharing" };
    place?: "settings";
    screen?: string;
    shown?: boolean;
    saved?: Record<string, unknown>;
  }
  export function ready(): Promise<ReadyContext>;
  export function launch(): Promise<ReadyContext["launch"] | null>;
  export function onLaunch(cb: (launch: NonNullable<ReadyContext["launch"]>) => void): () => void;
  export function shown(): boolean;
  export function onShown(cb: (isShown: boolean) => void): () => void;
  export function onFresh(cb: () => void): () => void;
  /** While held, the app's Back (its bar's ‹, Android's) calls `cb` instead of leaving: close a screen of your own.
   *  Hold it in the tap that opened that screen. Returns the function that lets go. Not on an app before 11-23. */
  export function onBack(cb: () => void): () => void;
  export function onOpen(cb: (open: { note: { id: string; path: string }; screen: string }) => void): () => void;
  export function props(): Record<string, unknown>;
  export function onProps(cb: (next: Record<string, unknown>) => void): () => void;
  export function signal(id: string, count: number): Promise<unknown>;

  // ── Folder-scoped vault client (default for applets) ──
  export interface AppletRecord {
    id: string;
    path: string;
    createdAt?: string | null;
    updatedAt: string | null;
    tags?: string[];
    types?: string[];
    fields?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    body?: string;
    content?: string;
    /** With includeLinks: its links both ways, only those whose other end is in a folder it may read. */
    links?: AppletLink[];
  }
  /** One end of a link: a record in a folder it may read. */
  export interface AppletLinkEnd { id: string; path: string | null; tags: string[]; fields: Record<string, unknown>; createdAt: string | null; updatedAt: string | null }
  export interface AppletLink { sourceId: string; targetId: string; relationship: string | null; fields: Record<string, unknown>; createdAt: string | null; sourceNote?: AppletLinkEnd; targetNote?: AppletLinkEnd }
  /** A field filter: a value (equals: text, a number or yes/no), or one or more operators ({ gte: 2, lte: 5 }). An operator
   *  compares text and numbers, not yes/no; on a 0.8 hub it, or ordering by a field, needs the field indexed. An empty
   *  `in` filters nothing. */
  export type FieldFilter = string | number | boolean | { eq?: string | number; ne?: string | number; gt?: string | number; gte?: string | number; lt?: string | number; lte?: string | number; in?: (string | number)[]; not_in?: (string | number)[]; exists?: boolean };
  /** A record from `vaults.*` (every vault on the device): always with its title, types, tags and fields, and `own`
   *  for the app's own records (settings, approvals, an applet's code). */
  export interface VaultsRecord {
    id: string;
    path: string;
    title: string;
    createdAt: string | null;
    updatedAt: string | null;
    types: string[];
    tags: string[];
    fields: Record<string, unknown>;
    own: boolean;
    body?: string;
    createdBy?: string | null;
    createdVia?: string | null;
    updatedBy?: string | null;
    updatedVia?: string | null;
    links?: { dir: "out" | "in"; id: string; path: string; relationship: string }[];
  }
  /** A folder's records (docs/WRITE-AN-APPLET.md "vault.queryRecords"): 50 at most a page, newest changed first. */
  export interface RecordQuery {
    pathPrefix?: string;
    tag?: string;
    /** Ranked by the hub: one page, no offset, orderBy or sort with it. */
    search?: string;
    limit?: number;
    /** The next page: up to 5,000. */
    offset?: number;
    /** updated_at, created_at (on 0.9), or a field's name (one folder: pathPrefix). Never link_count. */
    orderBy?: string;
    sort?: "asc" | "desc";
    /** Filter by fields: { course: "soup" }, { serves: { gte: 2 } }. */
    fields?: Record<string, FieldFilter>;
    includeLinks?: boolean;
    id?: string;
    path?: string;
    includeBody?: boolean;
    includeFields?: boolean;
    includeContent?: boolean;
    includeMetadata?: boolean;
  }
  export interface AppletVault {
    queryRecords(q?: RecordQuery): Promise<AppletRecord[]>;
    getRecord(idOrPath: string, opts?: { includeLinks?: boolean }): Promise<AppletRecord | null>;
    /** The tags (and types) on the records in its folders, each with how many there carry it. */
    listTags(): Promise<{ name: string; count: number }[]>;
    /** A body up to 500 KB (before 11-23, 7 KB). */
    createRecord(rec: { path: string; body: string; types?: string[]; tags?: string[]; fields?: Record<string, unknown> }): Promise<AppletRecord>;
    updateRecord(id: string, change: { if_updated_at: string; body?: string; fields?: Record<string, unknown>; types?: { add?: string[]; remove?: string[] }; tags?: { add?: string[]; remove?: string[] } }): Promise<AppletRecord>;
    queryNotes(q?: Record<string, unknown>): Promise<AppletRecord[]>;
    getNote(idOrPath: string): Promise<AppletRecord | null>;
    createNote(rec: { path: string; content: string; types?: string[]; tags?: string[]; metadata?: Record<string, unknown> }): Promise<AppletRecord>;
    updateNote(id: string, change: { if_updated_at?: string; content?: string; metadata?: Record<string, unknown>; types?: { add?: string[]; remove?: string[] }; tags?: { add?: string[]; remove?: string[] } }): Promise<AppletRecord>;
    attach(noteId: string, bytes: ArrayBuffer | ArrayBufferView, type: string, opts?: { transcribe?: boolean }): Promise<{ id: string | null; path: string; type: string; transcribe: boolean }>;
    /** A picture attached to a record in its folders, as its words link it (`/api/storage/…`). The Note asks it by itself
     *  when given the record's id. Absent in an app before 11-23. */
    file?(id: string, path: string): Promise<Blob>;
    /** A file attached to record `fromId` (one it reads) attached to `noteId` (one it may change) too, with no new bytes:
     *  a picture shown on a second record. Already there: nothing more. Absent in an app before 11-23. */
    attachFrom?(noteId: string, fromId: string, path: string): Promise<{ id: string | null; path: string; type: string }>;
  }
  export const vault: AppletVault;

  // ── Whole-vault / cross-vault API (requires fields.app: ["vaults"] / ["sharing"]) ──
  export const vaults: {
    list(): Promise<{ key: string; name: string; host: string; mine: boolean; home: boolean; level: "read" | "write" | null; connector: string; view: string | null; reach: "this-device" | "network" | "anyone" }[]>;
    hubs(): Promise<{ host: string; address: string | null; vaults: string[] }[]>;
    types(vault: string): Promise<{ name: string; kind: "type" | "tag"; count: number; description: string | null; fields: Record<string, { type?: string; enum?: unknown[]; description?: string }> }[]>;
    query(vault: string, q?: { type?: string; tag?: string; search?: string; path?: string; where?: { field: string; op: string; value: unknown }[]; sort?: { by: string; dir: "asc" | "desc" }; limit?: number; offset?: number }): Promise<{ records: VaultsRecord[]; more: boolean }>;
    get(vault: string, id: string): Promise<VaultsRecord>;
    /** A picture attached to that record, as its words link it (`/api/storage/…`): give it to the Note as fetchBlob. */
    file(vault: string, id: string, path: string): Promise<Blob>;
    history(vault: string, id: string): Promise<unknown[]>;
    version(vault: string, id: string, ix: number): Promise<unknown>;
    create(vault: string, rec: { path: string; body: string; types?: string[]; tags?: string[]; fields?: Record<string, unknown> }): Promise<VaultsRecord>;
    update(vault: string, id: string, change: { if_updated_at: string; body?: string; fields?: Record<string, unknown>; types?: { add?: string[]; remove?: string[] }; tags?: { add?: string[]; remove?: string[] } }): Promise<VaultsRecord>;
    watch(vault: string, type: string | null, cb: (ev: { upsert?: VaultsRecord } | { remove?: string }) => void): () => void;
    applets(vault: string): Promise<{ id: string; name: string; glyph: string; href: string; allowed: boolean }[]>;
    changes(vault: string, since: string, offset?: number): Promise<unknown>;
    compare(vault: string, id: string, before: number | null, after: number | null): Promise<unknown>;
    restore(vault: string, id: string, ix: number, ifUpdatedAt?: string): Promise<unknown>;
    remove(vault: string, id: string, ifUpdatedAt: string): Promise<unknown>;
    packs(vault: string): Promise<unknown>;
    addPack(vault: string, id: string): Promise<unknown>;
    importNotion(vault: string): Promise<unknown>;
    access(vault: string): Promise<unknown>;
    publish(vault: string, id: string, on?: boolean): Promise<unknown>;
    revoke(vault: string, noteId: string): Promise<unknown>;
    readOnly(vault: string): Promise<unknown>;
    people(vault: string): Promise<unknown>;
    invite(vault: string, name: string, from?: string): Promise<unknown>;
    takeBack(vault: string, id: string): Promise<unknown>;
    end(vault: string, key: string, name?: string): Promise<unknown>;
    reach(vault: string): Promise<unknown>;
    manage(vault: string): Promise<unknown>;
    giveKey(vault: string, k: { name: string; can: "read" | "write"; types?: string[] | null }): Promise<unknown>;
    endReach(vault: string, id: string): Promise<unknown>;
    stopManaging(vault: string): Promise<unknown>;
  };

  // ── App, saved state, storage, voice, services, theme ──
  export const app: {
    recent(opts?: { limit?: number }): Promise<{ vaultName: string; title: string; updatedAt: string | null; href: string }[]>;
    pins(): Promise<{ name: string; glyph: string; href: string; home: boolean }[]>;
    changes(): Promise<{ count: number; names: string[]; more: boolean; href: string | null }>;
    open(href: string): Promise<boolean>;
    copy(text: string): Promise<boolean>;
    links(links: string[], from?: string): Promise<Record<string, "note" | "away" | null>>;
    follow(link: string, opts?: { from?: string; choose?: boolean }): Promise<boolean>;
    address(noteId: string): Promise<string | null>;
    openLink(url: string): Promise<boolean>;
    save(name: string, bytes: ArrayBuffer | ArrayBufferView, type: string): Promise<{ saved: string }>;
    pick(opts?: { accept?: string; multiple?: boolean }): Promise<{ name: string; type: string; bytes: ArrayBuffer }[]>;
  };
  export const voice: { record(opts?: { max_s?: number }): Promise<{ bytes: ArrayBuffer; type: string; duration: number } | null> };
  export const saved: {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
    all(): Record<string, unknown>;
    flush(): Promise<null>;
  };
  export const storage: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<unknown>;
    keys(): Promise<string[]>;
  };
  export const services: {
    me(): Promise<{ pubkey: string }>;
    fetch(id: string, path: string, init?: { method?: string; headers?: Record<string, string>; body?: unknown; as?: "text" | "json" | "bytes" }): Promise<{ status: number; headers: Record<string, string>; body: unknown }>;
    relay(id: string): {
      subscribe(filters: Record<string, unknown>[], onEvents: (events: unknown[]) => void, onEose?: () => void): () => void;
      subscribeMany(filterSets: Record<string, unknown>[][], onEvents: (events: unknown[]) => void, onEose?: () => void): () => void;
      query(filters: Record<string, unknown>[]): Promise<unknown[]>;
      publish(ev: { kind: number; content: string; tags?: string[][] }): Promise<{ ok: boolean; id: string; message?: string; event?: unknown }>;
      loadPrivate(prefix: string): Promise<unknown[]>;
      savePrivate(d: string, text: string): Promise<unknown>;
      onStatus(cb: (s: unknown) => void): () => void;
    };
    upload(id: string, bytes: ArrayBuffer | ArrayBufferView, type: string): Promise<unknown>;
    media(id: string, sha256: string, ext: string): Promise<{ bytes: ArrayBuffer; type: string }>;
    card(id: string, event: unknown): Promise<unknown>;
    answer(id: string, event: unknown, decision: "approve" | "deny", rids?: string[]): Promise<unknown>;
    secret(id: string, event: unknown): Promise<unknown>;
    trust(id: string, event: unknown): Promise<unknown>;
    forgetSecret(id: string, event: unknown): Promise<unknown>;
  };
  export const theme: {
    get(): Promise<Record<string, string>>;
    now(): Record<string, string> | null;
    on(cb: (t: Record<string, string>) => void): () => void;
  };

  // ── Kit UI parts & helpers (matches PART_NAMES in src/applet/kits/modules.ts) ──
  export interface Row {
    key?: string;
    title: ReactNode;
    meta?: ReactNode;
    aside?: ReactNode;
    glyph?: string;
    check?: boolean;
    onPress?: () => void;
    badge?: ReactNode;
    strong?: boolean;
    current?: boolean;
    under?: ReactNode;
    label?: string;
    data?: Record<string, string>;
  }
  export function Page(props: { title?: ReactNode; kicker?: ReactNode; aside?: ReactNode; back?: { label: string; onPress: () => void }; onRefresh?: () => unknown; wide?: boolean; scroll?: boolean; start?: "first" | "last"; className?: string; children?: ReactNode }): ReactNode;
  export function Pages(props: { start?: "first" | "last"; name?: string; handle?: Ref<{ toElement(el: Element): void; toEnd(): void; toStart(): void } | null>; className?: string; children?: ReactNode }): ReactNode;
  export function List(props: { label?: ReactNode; hideLabel?: boolean; rows: readonly Row[]; more?: { label: string; onPress: () => void; busy?: boolean } }): ReactNode;
  export function Card(props: { title?: ReactNode; children?: ReactNode }): ReactNode;
  export function Days(props: { counts?: readonly number[]; times?: readonly (string | number | null | undefined)[]; days?: number; label?: string; inline?: boolean }): ReactNode;
  export function Field(props: { label: ReactNode; placeholder?: string; action?: string; onAction?: (text: string) => unknown; value?: string; onChange?: (text: string) => void; clearOnAction?: boolean }): ReactNode;
  export function Search(props: { label: string; placeholder?: string; value?: string; onChange?: (text: string) => void; onSearch: (text: string) => void; live?: number }): ReactNode;
  export function Write(props: { label: string; labelled?: boolean; value: string; onChange: (text: string) => void; onSend?: () => unknown; send?: ReactNode; sendLabel?: string; canSend?: boolean; busy?: boolean; enter?: "send" | "newline"; line?: boolean; dock?: boolean; maxLength?: number; placeholder?: string; inputRef?: Ref<HTMLTextAreaElement | null>; onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void; children?: ReactNode }): ReactNode;
  export function Button(props: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & { kind?: "primary" | "plain" | "quiet"; small?: boolean; busy?: boolean }): ReactNode;
  export function Tabs(props: { label: string; tabs: readonly { key: string; label: ReactNode; count?: number }[]; current: string; onChange: (key: string) => void }): ReactNode;
  export function Table(props: { label: string; columns: readonly { key: string; label: ReactNode; align?: "start" | "end"; width?: number; sortable?: boolean }[]; rows?: readonly { key: string; cells: Record<string, ReactNode>; onPress?: () => void; current?: boolean; label?: string }[]; groups?: readonly { key: string; label: ReactNode; count?: number; rows: readonly { key: string; cells: Record<string, ReactNode>; onPress?: () => void; current?: boolean; label?: string }[] }[]; sort?: { by: string; dir: "asc" | "desc" }; onSort?: (key: string) => void; more?: { label: string; onPress: () => void; busy?: boolean } }): ReactNode;
  export function Fields(props: { label?: string; fields: readonly { name: string; label?: ReactNode; kind?: "text" | "number" | "yesno" | "choice" | "date" | "list" | "long"; choices?: readonly string[]; value: unknown; readOnly?: boolean }[]; onSave?: (name: string, value: unknown) => Promise<unknown> | void }): ReactNode;
  export function Drawer(props: { open: boolean; onClose: () => void; title?: ReactNode; label?: string; children?: ReactNode }): ReactNode;
  export function Empty(props: { children?: ReactNode }): ReactNode;
  export function Loading(props: { children?: ReactNode }): ReactNode;
  export function Problem(props: { error?: unknown; onRetry?: () => unknown; children?: ReactNode }): ReactNode;
  export function Record(props: { onRecorded: (r: { bytes: ArrayBuffer; type: string; duration: number }) => unknown; label?: string; max_s?: number; disabled?: boolean; kind?: "primary" | "plain" | "quiet"; small?: boolean; children?: ReactNode }): ReactNode;
  /** `id`: the record's, in its own vault: the pictures attached to it are drawn. `fetchBlob`: a picture's bytes, in place
   *  of `id`'s (Vault's, for a record of any vault). */
  export function Note(props: { id?: string; body: string; path?: string; tags?: readonly string[]; fields?: Record<string, unknown>; onLink?: (target: string) => void; fetchBlob?: (src: string) => Promise<Blob> }): ReactNode;
  export function Link(props: { to: string; from?: string; children?: ReactNode }): ReactNode;
  export function Linked(props: { text: string; web?: boolean }): ReactNode;
  export const link: {
    /** a note's address on its hub; throws when it has none here (does the applet ask for open?) */
    to(record: string | { id: string }): Promise<string>;
    follow(target: string, opts?: { from?: string; choose?: boolean }): Promise<boolean>;
    open(record: string | { id: string }): Promise<boolean>;
    parse(text: string): unknown;
    find(text: string): unknown[];
  };
  export function toast(text: string, opts?: { error?: boolean }): void;
  export function still(): boolean;
  export function useSaved<T>(key: string, initial: T): [T, (next: T | ((prev: T) => T)) => void];
  export function useTheme(): Record<string, string> | null;
  export function voiceNote(recording: { bytes: ArrayBuffer; type: string; duration: number }, create: (body: string) => Promise<{ id: string; updatedAt?: string | null }>): Promise<unknown>;
  export function useTranscripts(bodies: readonly (string | null | undefined)[], reload: () => unknown): { say(body: string): string; strip(body: string): string; again(): void };
  export const when: {
    time(t: unknown): string;
    day(t: unknown, now?: Date): string;
    date(t: unknown, now?: Date): string;
    short(t: unknown, now?: Date): string;
    full(t: unknown, now?: Date): string;
    ago(t: unknown, now?: Date): string;
    stamp(t: unknown): string;
    path(t: unknown, seconds?: boolean): string;
    parse(t: unknown): Date | null;
  };
}

/** A component from a vault (`import Events from "component:events"`): a React component, its props its own. */
declare module "component:*" {
  const Component: (props: Record<string, unknown>) => import("react").ReactNode;
  export default Component;
}
