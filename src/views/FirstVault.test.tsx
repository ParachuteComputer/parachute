// The first-vault step holds a sign-in token that can make vaults (T-476): it is ended however the person leaves.
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import FirstVault from "./FirstVault";
import type { FirstVault as First } from "../vault/signInFlow";

afterEach(cleanup);
const step = (): First & { end: ReturnType<typeof vi.fn> } => ({ hub: "https://cloud.example", make: vi.fn(async () => "https://cloud.example/oauth/authorize"), end: vi.fn(async () => undefined) });
const tick = () => act(() => new Promise((r) => setTimeout(r, 5)));

describe("the first-vault screen ends its token when the person leaves", () => {
  it("leaving the screen (the bar's back) ends it once; StrictMode's second effect in development doesn't end it early", async () => {
    const f = step();
    const view = render(<StrictMode><FirstVault first={f} onError={() => {}} onCancel={() => {}} /></StrictMode>);
    await tick();
    expect(f.end).not.toHaveBeenCalled();
    view.unmount();
    await tick();
    expect(f.end).toHaveBeenCalled();
  });
  it("closing the app (the page hides) ends it", async () => {
    const f = step();
    render(<FirstVault first={f} onError={() => {}} onCancel={() => {}} />);
    window.dispatchEvent(new Event("pagehide"));
    expect(f.end).toHaveBeenCalledTimes(1);
  });
});
