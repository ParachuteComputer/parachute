import { describe, expect, it } from "vitest";
import { limitedFetch, TooLargeError } from "./limited";

const serve = (body: string, headers: Record<string, string> = {}) => (async () => new Response(body, { headers })) as typeof fetch;

describe("a reply from someone else's hub", () => {
  it("is read whole when it is within the limit", async () => {
    const r = await limitedFetch(serve('{"ok":true}'), 100)("https://x/");
    expect(await r.json()).toEqual({ ok: true });
  });
  it("is refused past the limit, whether or not it says its length", async () => {
    await expect(limitedFetch(serve("x".repeat(101)), 100)("https://x/")).rejects.toBeInstanceOf(TooLargeError);
    await expect(limitedFetch(serve("x", { "content-length": "5000" }), 100)("https://x/")).rejects.toBeInstanceOf(TooLargeError);
  });
});
