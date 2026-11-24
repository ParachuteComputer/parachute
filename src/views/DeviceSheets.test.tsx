import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  const track = { stop() {}, addEventListener() {} };
  beforeEach(() => {
    // jsdom's Blob can't hand over its bytes
    if (!Blob.prototype.arrayBuffer) Blob.prototype.arrayBuffer = async function () { return new TextEncoder().encode("words").buffer as ArrayBuffer; };
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) } });
    (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeRecorder;
  });
  afterEach(() => cleanup());
  const asked: unknown[] = [];
  function Screen({ id }: { id: string }) { const d = useDeviceSheets("Journal", true, id); return createElement("div", null, createElement("button", { onClick: () => void d.record(60).then((r) => asked.push(r)) }, "Record"), d.ui); }
  const recording = async (id: string) => {
    const r = render(createElement(Screen, { id }));
    screen.getByText("Record").click();
    await waitFor(() => expect(screen.getByRole("timer").textContent).toContain("Recording"));
    return r;
  };

  it("holds what was heard, and shows it on the same screen's way back", async () => {
    const id = "kitchen|journal-1";
    const first = await recording(id);
    expect(heldFor(id)).toHaveLength(0);
    first.unmount();
    await waitFor(() => expect(heldFor(id)[0]?.blob.size).toBe(5));
    render(createElement(Screen, { id }));
    expect(screen.getByRole("dialog", { name: "Kept recording for Journal" }).textContent).toContain("Your recording is kept");
    screen.getByRole("button", { name: "Discard" }).click();
    await waitFor(() => expect(heldFor(id)).toHaveLength(0));
  });

  it("holds nothing of a recording that was sent or cancelled before the screen went", async () => {
    for (const [id, button] of [["kitchen|journal-2", "Cancel"], ["kitchen|journal-3", "Send"]] as const) {
      const r = await recording(id);
      if (button === "Send") await new Promise((res) => setTimeout(res, 450)); // Send waits a moment after it opens (SEND_ARM_MS)
      await act(async () => { screen.getByRole("button", { name: button }).click(); await new Promise((res) => setTimeout(res, 20)); });
      r.unmount();
      await new Promise((res) => setTimeout(res, 20));
      expect(heldFor(id), button).toHaveLength(0);
      cleanup();
    }
  });

  it("a second recording lost on the same screen does not replace the first", async () => {
    const id = "kitchen|journal-4";
    (await recording(id)).unmount();
    await waitFor(() => expect(heldFor(id)).toHaveLength(1));
    const again = await recording(id);
    again.unmount();
    await waitFor(() => expect(heldFor(id)).toHaveLength(2));
    render(createElement(Screen, { id }));
    expect(screen.getByRole("status").textContent).toContain("1 more kept");
    screen.getByRole("button", { name: "Discard" }).click();
    await waitFor(() => expect(heldFor(id)).toHaveLength(1));
    screen.getByRole("button", { name: "Discard" }).click();
    await waitFor(() => expect(heldFor(id)).toHaveLength(0));
  });

  it("Save a copy saves it as a file named for the applet, and Done lets it go", async () => {
    const id = "kitchen|journal-5";
    (await recording(id)).unmount();
    await waitFor(() => expect(heldFor(id)).toHaveLength(1));
    const downloads: string[] = [];
    URL.createObjectURL = () => "blob:test"; URL.revokeObjectURL = () => {};
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { downloads.push(this.download); });
    render(createElement(Screen, { id }));
    screen.getByRole("button", { name: "Save a copy" }).click();
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/^Saved as Recording for Journal .*\.webm\.$/));
    expect(downloads).toHaveLength(1);
    screen.getByRole("button", { name: "Done" }).click();
    await waitFor(() => expect(heldFor(id)).toHaveLength(0));
    vi.restoreAllMocks();
  });
});
