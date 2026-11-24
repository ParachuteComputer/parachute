// MailBody (parts-mail.tsx) in a document: every web picture comes once shown, under React's StrictMode too (its
// effects run twice); one the shell's limit refused is asked again; a tap on a link opens its own address.
import { act, render, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MailBody } from "./parts-mail";

const g = globalThis as unknown as { parachute?: unknown };
const make = URL.createObjectURL;
afterEach(() => { delete g.parachute; URL.createObjectURL = make; vi.useRealTimers(); });
/** The pictures drawn in the mail's inner shadow root. */
const drawn = (container: HTMLElement) => {
  const outer = container.querySelector("[data-pa-mail]")?.shadowRoot;
  const inner = outer?.querySelector(".pa-mail-box")?.shadowRoot;
  return { inner, srcs: Array.from(inner?.querySelectorAll("img") ?? [], (i) => i.getAttribute("src")) };
};
const html = Array.from({ length: 10 }, (_, i) => `<p><img src="https://cdn.example.org/${i}.png" alt="p${i}" width="40" height="40"></p>`).join("") + '<p><a href="https://example.org/go">Go</a></p>';

describe("MailBody", () => {
  it("draws every web picture once shown, in StrictMode", async () => {
    let n = 0;
    URL.createObjectURL = () => `blob:${n++}`;
    const asked: string[] = [];
    g.parachute = { app: { picture: async (url: string) => { asked.push(url); return { type: "image/png", bytes: new ArrayBuffer(8) }; } } };
    const { container } = render(<StrictMode><MailBody html={html} pictures /></StrictMode>);
    await waitFor(() => expect(drawn(container).srcs.filter((s) => s?.startsWith("blob:"))).toHaveLength(10));
    expect(new Set(asked).size).toBe(10);
  });

  it("asks again for a picture the shell's limit refused", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    URL.createObjectURL = () => "blob:x";
    let refused = 0;
    g.parachute = { app: { picture: async (url: string) => {
      if (url.endsWith("/3.png") && refused++ === 0) throw Object.assign(new Error("pictures: too many at once"), { code: "rate_limited" });
      return { type: "image/png", bytes: new ArrayBuffer(8) };
    } } };
    const { container, queryByText } = render(<MailBody html={html} pictures />);
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    await waitFor(() => expect(drawn(container).srcs.filter(Boolean)).toHaveLength(10));
    expect(refused).toBe(2);
    expect(queryByText(/couldn't load/)).toBeNull();
  });

  it("a tap on a link asks the shell to open its own address", async () => {
    const opened: string[] = [];
    g.parachute = { app: { openLink: async (url: string) => { opened.push(url); return true; } } };
    const { container } = render(<MailBody html={html} />);
    const a = drawn(container).inner!.querySelector("a")!;
    a.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true, cancelable: true }));
    await waitFor(() => expect(opened).toEqual(["https://example.org/go"]));
  });
});
