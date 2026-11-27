// The kit's Note draws text a vault holds, inside frames that run with no card (Parachute's own Vault and Journal:
// docs/design/PARACHUTE-SOURCE.md). Raw HTML and script links in a note must stay text (security review, T-476).
import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Note } from "./parts-note";

describe("Note draws a vault's text as text", () => {
  it("no script, no inline handler, no javascript: link, no iframe", () => {
    const body = [
      "# Hello",
      "<script>window.__hit = 1</script>",
      "<img src=x onerror=\"window.__hit = 2\">",
      "<iframe src=\"https://evil.example\"></iframe>",
      "[click](javascript:window.__hit=3)",
      "<a href=\"javascript:window.__hit=4\">raw</a>",
    ].join("\n\n");
    const { container } = render(<Note body={body} path="Notes/Hello" />);
    expect(container.querySelector("script, iframe, [onerror]")).toBeNull();
    for (const a of container.querySelectorAll("a")) expect((a.getAttribute("href") ?? "").toLowerCase()).not.toMatch(/^\s*javascript:/);
    expect((window as unknown as { __hit?: number }).__hit).toBeUndefined();
    expect(container.textContent).toContain("Hello");
  });
});

describe("Note draws the pictures attached to its record (docs/design/PICTURES.md)", () => {
  const body = "Before.\n\n![owl sketch](/api/storage/2026-11-23/1763-owl.png)\n\n![web](https://elsewhere.example/x.png)\n\nAfter.";
  const withFile = async (run: (asked: [string, string][]) => Promise<void>) => {
    const asked: [string, string][] = [];
    const g = globalThis as unknown as { parachute?: unknown };
    const make = URL.createObjectURL;
    URL.createObjectURL = () => "blob:owl";
    g.parachute = { vault: { file: async (id: string, src: string) => { asked.push([id, src]); return new Blob([new Uint8Array(4)], { type: "image/png" }); } } };
    try { await run(asked); } finally { delete g.parachute; URL.createObjectURL = make; }
  };
  for (const tags of [undefined, ["recipe"]]) {
    it(`given the record's id, asks vault.file for a storage picture and draws it; never a web one (${tags ? "a rich note" : "plain words"})`, () => withFile(async (asked) => {
      const { findByRole, container } = render(<Note id="r1" body={body} path="Notes/Owl" tags={tags} />);
      expect((await findByRole("img", { name: "owl sketch" })).getAttribute("src")).toBe("blob:owl");
      expect(asked).toEqual([["r1", "/api/storage/2026-11-23/1763-owl.png"]]);
      expect(container.querySelector('img[src^="https:"]')).toBeNull();
    }));
  }
  it("without an id (or in an app with no vault.file) shows the picture's name, and asks for nothing", () => withFile(async (asked) => {
    const { container } = render(<Note body={body} path="Notes/Owl" />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("owl sketch");
    expect(asked).toEqual([]);
  }));
});

describe("Note and the links Uni writes", () => {
  const ID = "01KA3Z9V6B2W8XQJ4M7N5P0R1S";
  const g = globalThis as unknown as { parachute?: unknown };
  afterEach(() => { delete g.parachute; });
  it("a web app's path alone in the words becomes a link; as a markdown link's own target it stands as written (T-476)", async () => {
    g.parachute = { app: { links: async (links: string[]) => links.map(() => "note") } };
    const path = `/surface/parachute/v/uni/n/${ID}`;
    const { container } = render(<Note body={`Filed at ${path} today.\n\nOr [the note](${path}).`} />);
    await act(() => new Promise((r) => setTimeout(r, 30)));
    const links = [...container.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links.map((l) => l[0])).toEqual([path, "the note"]);
    // the labelled one keeps its target: not wrapped a second time into a dead address
    expect(links[1][1]).toBe(path);
  });
});
