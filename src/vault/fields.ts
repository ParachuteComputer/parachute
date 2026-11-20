// A typed record's fields, shown and changed plainly, for any type (T-476): the note view lists what the record
// holds, name and value; the app's editor gives each field an input, shaped by the type's own definition (a choice for
// an enum, a box for a yes/no, a number box for a number). No per-type code: everything comes from the record and its
// types as the vault describes them.

export type FieldSpec = { type?: string; enum?: unknown[]; description?: string };
/** One field as the editor shows it. `kind` picks the input. */
export type FieldInput = { name: string; label: string; kind: "text" | "number" | "yesno" | "choice" | "list"; choices?: string[]; value: string; set: boolean };

const plain = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

/** A field's name as a person reads it: `book_status` is "book status". */
export const fieldLabel = (name: string) => name.replace(/_/g, " ");

/** A value as one line of text. */
export function fieldText(v: unknown): string {
  if (v === null || v === undefined || v === "") return "–";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (Array.isArray(v)) return v.map((x) => (plain(x) || Array.isArray(x) ? JSON.stringify(x) : String(x))).join(", ") || "–";
  if (plain(v)) return JSON.stringify(v);
  return String(v);
}

/** The fields a record holds, in its own order, for the note view. */
export function fieldRows(metadata: unknown): { name: string; label: string; value: string }[] {
  if (!plain(metadata)) return [];
  return Object.entries(metadata).map(([name, v]) => ({ name, label: fieldLabel(name), value: fieldText(v) }));
}

/** The editor's inputs: each field its types declare (in their order), then any other field the record holds. A field
 *  holding a nested object is left out: it isn't one a person types. */
export function fieldInputs(metadata: unknown, declared: Record<string, FieldSpec>): FieldInput[] {
  const held = plain(metadata) ? metadata : {};
  const names = [...new Set([...Object.keys(declared), ...Object.keys(held)])];
  const out: FieldInput[] = [];
  for (const name of names) {
    const v = held[name];
    if (plain(v)) continue;
    const spec = declared[name] ?? {};
    const choices = Array.isArray(spec.enum) ? spec.enum.filter((c): c is string => typeof c === "string") : [];
    const type = spec.type ?? (typeof v === "number" ? "number" : typeof v === "boolean" ? "boolean" : Array.isArray(v) ? "array" : "string");
    const kind: FieldInput["kind"] = choices.length ? "choice" : type === "boolean" ? "yesno" : type === "integer" || type === "number" ? "number" : Array.isArray(v) || type === "array" ? "list" : "text";
    const value = v === undefined || v === null ? "" : Array.isArray(v) ? v.map(String).join(", ") : String(v);
    out.push({ name, label: fieldLabel(name), kind, ...(choices.length ? { choices } : {}), value, set: v !== undefined && v !== null });
  }
  return out;
}

/** What the editor's inputs change, as a `metadata` merge: a field emptied is removed (null); a field left as it was is
 *  not sent. Values are typed back by the input's kind. */
export function fieldChanges(inputs: FieldInput[], values: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of inputs) {
    const now = values[f.name] ?? f.value;
    if (now === f.value) continue;
    if (now.trim() === "") { if (f.set) out[f.name] = null; continue; }
    if (f.kind === "number") { const n = Number(now); out[f.name] = Number.isFinite(n) ? n : now; continue; }
    if (f.kind === "yesno") { out[f.name] = now === "true"; continue; }
    if (f.kind === "list") { out[f.name] = now.split(",").map((s) => s.trim()).filter(Boolean); continue; }
    out[f.name] = now;
  }
  return out;
}
