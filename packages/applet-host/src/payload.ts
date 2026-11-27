// The applet a connector serves in this view: one JSON script in the page, `<script type="application/json"
// id="parachute-applet">`, put there by the connector (parachute-core packages/vault/src/mcp-app.ts) when it serves
// `ui://parachute/applet/<id>`. Version 1:
//   { v: 1, vault, record: {id, path, extension, tags, fields}, code, approval: {code, scope, subject, vaults?, at?, device?} }
// `approval.code` and `approval.scope` are the code and asks hashes the person's signed approval names (code.ts
// codeHash, approvals.ts asksOf), with its subject and pick: the view checks both hashes again.

export type Payload = {
  v: 1;
  vault: string;
  record: { id: string; path: string; extension: string; tags: string[]; fields: Record<string, unknown> };
  code: string;
  approval: { code: string; scope: string; subject: { hub: string; vault: string; record: string; applet: string }; vaults?: unknown; at?: string; device?: string };
};

const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export function parsePayload(raw: unknown): { ok: true; payload: Payload } | { ok: false; why: string } {
  if (!plain(raw) || raw.v !== 1) return { ok: false, why: "This view opens a Parachute applet; this one came without its applet." };
  const r = raw.record, a = raw.approval;
  if (!isStr(raw.vault) || !plain(r) || !isStr(r.id) || !isStr(r.path) || !isStr(r.extension) || !Array.isArray(r.tags) || !plain(r.fields) || typeof raw.code !== "string" || !plain(a) || !isStr(a.code) || !isStr(a.scope)
    || !plain(a.subject) || !isStr(a.subject.hub) || !isStr(a.subject.vault) || !isStr(a.subject.record) || !isStr(a.subject.applet)) {
    return { ok: false, why: "This applet came in a shape Parachute doesn't read. Update the connector or the view." };
  }
  return { ok: true, payload: raw as unknown as Payload };
}

export function readPayload(doc: Document): ReturnType<typeof parsePayload> {
  const el = doc.getElementById("parachute-applet");
  if (!el?.textContent) return parsePayload(null);
  try { return parsePayload(JSON.parse(el.textContent)); } catch { return parsePayload(null); }
}

/** The page with the applet in it, as a connector builds it (the JSON can't close its script: `<` is written `\u003c`). */
export function withPayload(html: string, payload: Payload): string {
  const tag = `<script type="application/json" id="parachute-applet">${JSON.stringify(payload).replace(/</g, "\\u003c")}</script>`;
  return html.replace("<head>", `<head>${tag}`);
}
