// A folder-scoped applet speaks the hub's own query words (T-476, docs/WRITE-AN-APPLET.md "Reading"): order, page and
// filter by a field, its folders' tags, a note's links, and a long note's write, through the real frame against a real
// hub. What stays out: a note in another folder (by its links, or by a tag only it carries).
import { expect, test, type Page } from "./test";
import { api, hubState, record, VAULT } from "./hub";
import { ui } from "./helpers";

test.use({ storageState: "e2e/.signed-in.json" });
const frame = (page: Page) => page.frameLocator("iframe.applet-frame:visible");

const CODE = `import { useEffect, useState } from "react";
import { vault } from "parachute";
export default function Parity() {
  const [said, setSaid] = useState("Asking…");
  useEffect(() => {
    (async () => {
      const paths = (rows) => rows.map((r) => r.path.replace("Parity/", "")).join(",");
      const asc = await vault.queryRecords({ pathPrefix: "Parity/", orderBy: "updated_at", sort: "asc", limit: 50 });
      const page2 = await vault.queryRecords({ pathPrefix: "Parity/", orderBy: "updated_at", sort: "asc", offset: 1, limit: 2 });
      const soups = await vault.queryRecords({ pathPrefix: "Parity/", fields: { course: "soup" }, orderBy: "updated_at", sort: "asc", limit: 50 });
      const tags = (await vault.listTags()).map((t) => t.name + ":" + t.count).sort().join(",");
      const first = asc.find((r) => r.path === "Parity/Alpha");
      const one = await vault.getRecord(first.id, { includeLinks: true });
      const links = (one.links || []).map((l) => (l.targetNote ? l.targetNote.path : "?")).join(",");
      const long = "A long stew. ".repeat(2500);
      const made = await vault.createRecord({ path: "Parity/Stew", body: long });
      const back = await vault.getRecord(made.id);
      setSaid(["asc=" + paths(asc), "page2=" + paths(page2), "soups=" + paths(soups), "tags=" + tags, "links=" + links, "long=" + back.body.length].join(" | "));
    })().catch((e) => setSaid("failed: " + (e && (e.code || e.message))));
  }, []);
  return <main><h1>Parity</h1><p id="said">{said}</p></main>;
}
`;
const ARGS = { path: "Applets/Parity", extension: "tsx", tags: ["applet"], body: CODE,
  fields: { applet: { contract: 2, id: "parity", name: "Parity", glyph: "◇", note: "a test applet", access: [{ vault: "here", allow: [{ path: "Parity/", verbs: ["read", "create"] }] }] } } };

test("a folder applet orders, pages, filters by a field, reads its tags and links, and writes a long note: only its folder", async ({ page }) => {
  test.setTimeout(90_000);
  const made: string[] = [];
  const add = async (path: string, content: string, tags: string[], metadata: Record<string, unknown> = {}) => {
    const n = await api(hubState(), "POST", "notes", { path, content, tags, metadata });
    made.push(n.id);
    // a later note is changed later: updated_at orders them
    await new Promise((r) => setTimeout(r, 1100));
    return n;
  };
  try {
    await add("Elsewhere/Secret", "kept out", ["only-elsewhere"]);
    await add("Parity/Beta", "beta", ["parity-tag"], { course: "soup" });
    await add("Parity/Gamma", "gamma", ["parity-tag"], { course: "bread" });
    await add("Parity/Alpha", "See [[Parity/Beta]] and [[Elsewhere/Secret]].", ["parity-tag", "first"], { course: "soup" });
    const applet = await record(hubState(), "create", ARGS) as { id: string };
    made.push(applet.id);
    await page.goto(`/v/${VAULT}?with=vault`);
    await ui(page).getByRole("list", { name: "Applets" }).getByRole("link", { name: /Parity/ }).click();
    await page.getByRole("button", { name: "Allow" }).click();
    const said = frame(page).locator("#said");
    await expect(said).not.toHaveText("Asking…", { timeout: 30_000 });
    await expect(said).toHaveText("asc=Beta,Gamma,Alpha | page2=Gamma,Alpha | soups=Beta,Alpha | tags=first:1,parity-tag:3 | links=Parity/Beta | long=32500");
    // the long note is in the hub, whole
    const stew = await api(hubState(), "GET", `notes?id=${encodeURIComponent("Parity/Stew")}&include_content=true`);
    made.push((Array.isArray(stew) ? stew[0] : stew).id);
    expect((Array.isArray(stew) ? stew[0] : stew).content).toHaveLength(32500);
  } finally {
    for (const id of made) await api(hubState(), "DELETE", `notes/${id}`).catch(() => {});
  }
});
