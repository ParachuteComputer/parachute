// Pin to the bar, one tap, the same everywhere an applet is (T-476, Aaron 11-24: "I dont see a way to pin applets so I
// can get to them easily"): on its row in the list (the frame) and in its own top bar (the shell). It shows "Pin" when it
// is off the bar and "Pinned" when it is on; a tap toggles. A toggle button: one name whatever its state ("Pin <name> to
// the bar"), and the state in aria-pressed. Only how it looks and what it says lives here: the caller writes the open
// bundle's record (shell/homeSettings.ts pinApplet), as Settings → On the bar does.

export function PinButton({ name, pinned, busy, onToggle }: { name: string; pinned: boolean; busy?: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="pin-toggle" aria-pressed={pinned} disabled={busy}
      aria-label={`Pin ${name} to the bar`} onClick={onToggle}>
      <span className="pin-mark" aria-hidden="true">{pinned ? "●" : "○"}</span>{pinned ? "Pinned" : "Pin"}
    </button>
  );
}
