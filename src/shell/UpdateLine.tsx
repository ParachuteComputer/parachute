// A newer build, said once above the bar (shell/updates.ts): Download, or Later (until a later build). Settings → Updates
// says the same, and what this build is.
import { openLinkOut } from "./device";
import { builtOn, laterAt, putOff, useUpdate, useUpdateChecks } from "./updates";

export default function UpdateLine() {
  useUpdateChecks();
  const s = useUpdate();
  if (s.kind !== "offer" || laterAt() >= s.offer.at) return null;
  return (
    <aside className="update-line" aria-label="A newer Parachute">
      <span>A newer Parachute is ready <span className="quiet">(built {builtOn(s.offer.at)})</span></span>
      <button type="button" className="quiet-button" onClick={() => void openLinkOut(s.offer.url).catch(() => undefined)}>Download</button>
      <button type="button" className="quiet-button" onClick={() => putOff(s.offer.at)}>Later</button>
    </aside>
  );
}
