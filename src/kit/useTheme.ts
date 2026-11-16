// useTheme(): the app's look in an applet, as the kit's theme events give it (every token, and `scheme`, `density`).
// null until the app has sent it. The same values are CSS variables, so most applets never need this.
import { useSyncExternalStore } from "react";

type Kit = { theme?: { now?: () => Record<string, string> | null; on?: (cb: (t: unknown) => void) => (() => void) | void } };
const kit = () => (globalThis as unknown as { parachute?: Kit }).parachute;
let latest: Record<string, string> | null = null;
const subscribe = (f: () => void) => {
  const off = kit()?.theme?.on?.((t) => { latest = t as Record<string, string>; f(); });
  return () => { if (typeof off === "function") off(); };
};
export function useTheme(): Record<string, string> | null {
  return useSyncExternalStore(subscribe, () => kit()?.theme?.now?.() ?? latest, () => null);
}
