// The kit's Note draws text a vault holds, inside frames that run with no card (Parachute's own Vault and Journal:
// docs/design/PARACHUTE-SOURCE.md). Raw HTML and script links in a note must stay text (security review, T-476).
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
