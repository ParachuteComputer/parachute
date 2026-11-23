import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { checkAppletRecord, type AppletRecordInput } from "./check";
import { PART_NAMES } from "./kits/modules";

const VALID: AppletRecordInput = {
  path: "Applets/Demo",
  extension: "tsx",
  tags: ["applet"],
  fields: {
    applet: {
      contract: 2,
      id: "demo",
      name: "Demo",
      access: [{ vault: "here", allow: [{ path: "Notes/", verbs: ["read"] }] }],
    },
  },
  body: `import { Page, Empty } from "parachute";\nexport default function Demo() { return <Page title="Demo"><Empty>Nothing yet.</Empty></Page>; }\n`,
};

describe("checkAppletRecord", () => {
  it("accepts a valid minimal applet and the shipped starter template", async () => {
    const res = await checkAppletRecord(VALID);
    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
    expect(res.conformance).toEqual([]);

    const starterMeta = JSON.parse(readFileSync(join(process.cwd(), "applets", "starter.json"), "utf8")) as Omit<AppletRecordInput, "body">;
    const starter: AppletRecordInput = { ...starterMeta, body: readFileSync(join(process.cwd(), "applets", "starter.tsx"), "utf8") };
    const starterRes = await checkAppletRecord(starter);
    expect(starterRes.ok).toBe(true);
    expect(starterRes.errors).toEqual([]);
    expect(starterRes.warnings).toEqual([]);
    expect(starterRes.conformance).toEqual([]);
  });

  it("rejects npm / relative imports that the sealed frame does not provide", async () => {
    const bad: AppletRecordInput = {
      ...VALID,
      body: `import { BrowserRouter } from "react-router";\nimport { VaultClient } from "@openparachute/surface-client";\nimport { helper } from "./helper";\nexport default function Demo() { return <BrowserRouter>{String(VaultClient)}{helper()}</BrowserRouter>; }\n`,
    };
    const res = await checkAppletRecord(bad);
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.includes('"react-router"'))).toBe(true);
    expect(res.errors.some((e) => e.includes('"@openparachute/surface-client"'))).toBe(true);
    expect(res.errors.some((e) => e.includes('"./helper"'))).toBe(true);
  });

  it("allows valid component:<id> imports and rejects invalid ones", async () => {
    const good = await checkAppletRecord({
      ...VALID,
      body: `import CardItem from "component:card-item";\nexport default function Demo() { return <CardItem />; }\n`,
    });
    expect(good.ok).toBe(true);

    const bad = await checkAppletRecord({
      ...VALID,
      body: `import Bad from "component:Not Valid!";\nexport default function Demo() { return <Bad />; }\n`,
    });
    expect(bad.ok).toBe(false);
    expect(bad.errors.some((e) => e.includes("invalid component import"))).toBe(true);
  });

  it("refuses component imports the compiler drops but the frame still reads from the source", async () => {
    const unused = await checkAppletRecord({ ...VALID, body: `import Bad from "component:Not_Valid";\nexport default function Demo() { return <div />; }\n` });
    expect(unused.errors.some((e) => e.includes("invalid component import"))).toBe(true);

    const nine = Array.from({ length: 9 }, (_, i) => `import C${i} from "component:c${i}";`).join("\n");
    const tooMany = await checkAppletRecord({ ...VALID, body: `${nine}\nexport default function Demo() { return <div />; }\n` });
    expect(tooMany.errors.some((e) => e.includes("imports 9 components"))).toBe(true);

    const typeOnly = await checkAppletRecord({ ...VALID, body: `import type X from "component:foo";\nexport default function Demo(): X | null { return null; }\n` });
    expect(typeOnly.imports).not.toContain("component:foo");
    expect(typeOnly.ok).toBe(true);

    // a require the frame's importsOf doesn't list: the frame never loads that component
    const required = await checkAppletRecord({ ...VALID, body: `const C = require("component:foo");\nexport default function Demo() { return <C />; }\n` });
    expect(required.errors.some((e) => e.includes("required but not imported"))).toBe(true);
  });

  it("catches missing default exports, syntax errors, shadowed imports and invalid manifests", async () => {
    const noDefault = await checkAppletRecord({ ...VALID, body: `export function NamedOnly() { return <div />; }\n` });
    expect(noDefault.ok).toBe(false);
    expect(noDefault.errors.some((e) => e.includes("no default export"))).toBe(true);

    const badSyntax = await checkAppletRecord({ ...VALID, body: `export default function Broken( { return <div />; }` });
    expect(badSyntax.ok).toBe(false);
    expect(badSyntax.errors.some((e) => e.includes("does not compile"))).toBe(true);

    const shadowed = await checkAppletRecord({ ...VALID, body: `import { shown } from "parachute";\nconst shown = true;\nexport default function Demo() { return <div />; }\n` });
    expect(shadowed.ok).toBe(false);
    expect(shadowed.errors.some((e) => e.includes('shadows an imported name'))).toBe(true);

    const badManifest = await checkAppletRecord({ ...VALID, fields: { applet: { contract: 2, id: "BAD ID", name: "x" } } });
    expect(badManifest.ok).toBe(false);
    expect(badManifest.errors.some((e) => e.includes("kebab-case"))).toBe(true);
  });

  it("warns when a part requires a higher app level than fields.needs", async () => {
    const res = await checkAppletRecord({
      ...VALID,
      body: `import { Page, Drawer } from "parachute";\nexport default function Demo() { return <Page title="Demo"><Drawer open={false} onClose={() => {}} /></Page>; }\n`,
    });
    expect(res.ok).toBe(true);
    expect(res.warnings.some((w) => w.includes('"Drawer"') && w.includes("level 4"))).toBe(true);
  });
});

describe("checkAppletRecord reads code the way the frame runs it", () => {
  it("accepts a default export written as `export default App;` (sucrase emits `exports. default`)", async () => {
    for (const body of [`const App = () => <div />;\nexport default App;\n`, `function A() { return <div />; }\nexport { A as default };\n`]) {
      const res = await checkAppletRecord({ ...VALID, body });
      expect(res.errors, body).toEqual([]);
    }
  });

  it("refuses a package reached through a re-export or an import with no space, as the frame's loader would", async () => {
    for (const body of [`export * from "lodash";\nexport default function A() { return <div />; }\n`, `import{ chunk } from "lodash";\nexport default function A() { return <div>{String(chunk)}</div>; }\n`]) {
      const res = await checkAppletRecord({ ...VALID, body });
      expect(res.errors.some((e) => e.includes('"lodash"')), body).toBe(true);
    }
  });

  it("reports the fields the app would leave out (services, signals), not only the manifest", async () => {
    const res = await checkAppletRecord({ ...VALID, fields: { ...VALID.fields, services: "nope", signals: 5 } });
    expect(res.errors.some((e) => e.startsWith("fields.services"))).toBe(true);
    expect(res.errors.some((e) => e.startsWith("fields.signals"))).toBe(true);
  });

  it("sees a `??` fallback behind an alias with $ in it, and says a too-new needs once", async () => {
    const aliased = await checkAppletRecord({ ...VALID, body: `import { Page, Drawer as $D } from "parachute";\nconst X = $D ?? null;\nexport default function Demo() { return <Page title="Demo">{String(X)}</Page>; }\n` });
    expect(aliased.warnings).toEqual([]);
    const newer = await checkAppletRecord({ ...VALID, fields: { ...VALID.fields, needs: 99 } });
    expect(newer.errors).toHaveLength(1);
    expect(newer.warnings).toEqual([]);
  });
});

describe("checkAppletRecord, second review", () => {
  it("refuses a manifest the app would list but never run (a misspelled key, a newer contract)", async () => {
    const applet = (VALID.fields.applet as Record<string, unknown>);
    const { access, ...rest } = applet;
    for (const bad of [{ ...rest, acess: access }, { ...applet, contract: 3 }]) {
      const res = await checkAppletRecord({ ...VALID, fields: { applet: bad } });
      expect(res.ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("reads no import from require(...) written in a comment or a string", async () => {
    const res = await checkAppletRecord({ ...VALID, body: `// see require("lodash") for details\nconst hint = "require('fs')";\nexport default function A() { return <div>{hint}</div>; }\n` });
    expect(res.errors).toEqual([]);
  });

  it("sees a part imported beside a default import or through a namespace", async () => {
    const fallback = await checkAppletRecord({ ...VALID, body: `import * as P from "parachute";\nconst D = P.Drawer ?? P.Page;\nexport default function A() { return <D title="x" />; }\n` });
    expect(fallback.warnings).toEqual([]);
    for (const body of [`import Kit, * as P from "parachute";\nexport default function A() { return <P.Drawer open={false} onClose={() => {}}>{String(Kit)}</P.Drawer>; }\n`, `import Kit, { Drawer } from "parachute";\nexport default function A() { return <Drawer open={false} onClose={() => {}}>{String(Kit)}</Drawer>; }\n`,
      `import * as P from "parachute";\nexport default function A() { return <P.Drawer open={false} onClose={() => {}} />; }\n`]) {
      const res = await checkAppletRecord({ ...VALID, body });
      expect(res.warnings.some((w) => w.includes('"Drawer"')), body).toBe(true);
    }
  });
});

describe("applets/parachute.d.ts", () => {
  it("declares every kit part in PART_NAMES", () => {
    const dts = readFileSync(join(process.cwd(), "applets", "parachute.d.ts"), "utf8");
    for (const part of PART_NAMES) {
      expect(dts, `applets/parachute.d.ts is missing "${part}"`).toMatch(new RegExp(`export\\s+(?:function|const)\\s+${part}\\b`));
    }
  });

  it("types the starter as written: an editor shows no errors on the file people copy", () => {
    const root = process.cwd();
    // and the folder door's words as WRITE-AN-APPLET.md gives them: an applet using them shows no error either
    const probe = join(mkdtempSync(join(tmpdir(), "dts-")), "words.tsx");
    writeFileSync(probe, `import { vault } from "parachute";
export async function words() {
  const rows = await vault.queryRecords({ pathPrefix: "Books/", orderBy: "rating", sort: "desc", offset: 50, fields: { rating: { gte: 4 }, genre: "sf" }, includeLinks: true });
  const one = await vault.getRecord(rows[0]!.id, { includeLinks: true });
  const tags = await vault.listTags();
  return [one?.links?.[0]?.targetNote?.path, one?.links?.[0]?.fields, tags[0]?.count];
}
`);
    const files = [join(root, "applets", "parachute.d.ts"), join(root, "applets", "starter.tsx"), probe];
    const program = ts.createProgram(files, {
      strict: true, noEmit: true, skipLibCheck: true, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
      types: [], typeRoots: [join(root, "node_modules", "@types")],
    });
    const said = ts.getPreEmitDiagnostics(program).map((d) => `${d.file?.fileName.replace(root, "") ?? ""}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`);
    expect(said).toEqual([]);
  }, 30_000);
});
