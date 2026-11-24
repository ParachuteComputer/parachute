import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { heldFor, useDeviceSheets } from "./DeviceSheets";

// One sheet at a time (T-476): a second ask while one is open is a tap on another mic or attach control, and it is
// ignored in plain terms (nothing chosen, nothing recorded), not answered with "the app is already asking you something".
describe("a tap on another control while the recorder is open", () => {
  it("a pick answers no files, a second record answers none, and the open recorder stays open", async () => {
    const { result } = renderHook(() => useDeviceSheets("Rooms", true, "k|n"));
    let first: Promise<unknown> = Promise.resolve();
    act(() => { first = result.current.record(60); });
    expect(result.current.ui).not.toBeNull();
    await expect(result.current.pick(["image/*"], false)).resolves.toEqual([]);
    await expect(result.current.record(60)).resolves.toBeNull();
    // still the first recorder, still waiting for its person
    expect(result.current.ui).not.toBeNull();
    let settled = false;
    void first.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    act(() => result.current.cancel());
    await expect(first).resolves.toBeNull();
  });
});

// A screen that goes (not hidden and kept: gone) while it records leaves the recording held for the way back: the frame
// that asked is gone, so it is saved or let go, never lost. The microphone and MediaRecorder are the device's: faked.
describe("a screen that goes while it records", () => {
  class FakeRecorder {
    static isTypeSupported = () => true;
    state: "inactive" | "recording" = "inactive";
    mimeType = "audio/webm";
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    start() { this.state = "recording"; }
    stop() { if (this.state === "inactive") return; this.state = "inactive"; queueMicrotask(() => { this.ondataavailable?.({ data: new Blob(["words"], { type: "audio/webm" }) }); this.onstop?.(); }); }
  }
  it("holds what was heard, and shows it on the same screen's way back", async () => {
    const { createElement } = await import("react");
    const { render, screen, waitFor, cleanup } = await import("@testing-library/react");
    const track = { stop() {}, addEventListener() {} };
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) } });
    (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeRecorder;
    const key = "kitchen|journal";
    function Screen() { const d = useDeviceSheets("Journal", true, key); return createElement("div", null, createElement("button", { onClick: () => void d.record(60) }, "Record"), d.ui); }
    const first = render(createElement(Screen));
    first.getByText("Record").click();
    await waitFor(() => expect(screen.getByRole("timer").textContent).toContain("Recording"));
    expect(heldFor(key)).toBeNull();
    first.unmount();
    await waitFor(() => expect(heldFor(key)?.blob.size).toBe(5));
    // the way back: the same screen again
    render(createElement(Screen));
    expect(screen.getByRole("dialog", { name: "Kept recording for Journal" }).textContent).toContain("Your recording is kept");
    screen.getByRole("button", { name: "Discard" }).click();
    await waitFor(() => expect(heldFor(key)).toBeNull());
    cleanup();
  });
});
