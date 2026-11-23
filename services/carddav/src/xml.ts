// Just enough XML for WebDAV request bodies (PROPFIND, REPORT): elements with their namespaces resolved, and text.
// DAV bodies are small; no DTDs, no processing beyond `<?xml?>`, comments and CDATA.

export const DAV = "DAV:";
export const CARDDAV = "urn:ietf:params:xml:ns:carddav";
export const CS = "http://calendarserver.org/ns/";

export type El = { ns: string; name: string; attrs: Record<string, string>; children: El[]; text: string };

const ENT: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
  e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e] ?? m);

/** Parse an XML document into its root element. Throws on text that isn't well-formed enough to read. */
export function parseXml(xml: string): El {
  let i = 0;
  const stack: { el: El; scope: Record<string, string> }[] = [];
  let root: El | null = null;
  const resolve = (qname: string, scope: Record<string, string>, attr = false) => {
    const c = qname.indexOf(":");
    const prefix = c < 0 ? "" : qname.slice(0, c);
    const local = c < 0 ? qname : qname.slice(c + 1);
    if (attr && !prefix) return { ns: "", name: local };
    const ns = scope[prefix];
    if (ns === undefined && prefix) throw new Error(`unbound prefix ${prefix}`);
    return { ns: ns ?? "", name: local };
  };
  while (i < xml.length) {
    const lt = xml.indexOf("<", i);
    const text = lt < 0 ? xml.slice(i) : xml.slice(i, lt);
    if (stack.length && text) stack[stack.length - 1].el.text += decode(text);
    if (lt < 0) break;
    if (xml.startsWith("<?", lt)) { i = xml.indexOf("?>", lt) + 2; if (i < 2) throw new Error("unclosed <?"); continue; }
    if (xml.startsWith("<!--", lt)) { i = xml.indexOf("-->", lt) + 3; if (i < 3) throw new Error("unclosed comment"); continue; }
    if (xml.startsWith("<![CDATA[", lt)) {
      const end = xml.indexOf("]]>", lt);
      if (end < 0) throw new Error("unclosed CDATA");
      if (stack.length) stack[stack.length - 1].el.text += xml.slice(lt + 9, end);
      i = end + 3;
      continue;
    }
    if (xml.startsWith("<!", lt)) { i = xml.indexOf(">", lt) + 1; if (i < 1) throw new Error("unclosed <!"); continue; }
    const gt = (() => { let q = ""; for (let j = lt + 1; j < xml.length; j++) { const ch = xml[j]; if (q) { if (ch === q) q = ""; } else if (ch === '"' || ch === "'") q = ch; else if (ch === ">") return j; } return -1; })();
    if (gt < 0) throw new Error("unclosed tag");
    const tag = xml.slice(lt + 1, gt);
    i = gt + 1;
    if (tag.startsWith("/")) {
      const top = stack.pop();
      if (!top) throw new Error("stray end tag");
      continue;
    }
    const selfClosing = tag.endsWith("/");
    const body = selfClosing ? tag.slice(0, -1) : tag;
    const m = /^([^\s/>]+)/.exec(body);
    if (!m) throw new Error("bad tag");
    const rawAttrs: [string, string][] = [];
    const re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let a: RegExpExecArray | null;
    while ((a = re.exec(body.slice(m[1].length)))) rawAttrs.push([a[1], decode(a[3] ?? a[4] ?? "")]);
    const scope = { ...(stack.length ? stack[stack.length - 1].scope : { xml: "http://www.w3.org/XML/1998/namespace" }) };
    for (const [k, v] of rawAttrs) {
      if (k === "xmlns") scope[""] = v;
      else if (k.startsWith("xmlns:")) scope[k.slice(6)] = v;
    }
    const { ns, name } = resolve(m[1], scope);
    const attrs: Record<string, string> = {};
    for (const [k, v] of rawAttrs) if (k !== "xmlns" && !k.startsWith("xmlns:")) attrs[resolve(k, scope, true).name] = v;
    const el: El = { ns, name, attrs, children: [], text: "" };
    if (stack.length) stack[stack.length - 1].el.children.push(el);
    else if (!root) root = el;
    if (!selfClosing) stack.push({ el, scope });
  }
  if (!root) throw new Error("no element");
  if (stack.length) throw new Error("unclosed element");
  return root;
}

export const child = (el: El | undefined, ns: string, name: string) => el?.children.find((c) => c.ns === ns && c.name === name);
export const children = (el: El | undefined, ns: string, name: string) => el?.children.filter((c) => c.ns === ns && c.name === name) ?? [];

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
