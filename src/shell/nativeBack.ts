// Android's Back, taken while something on screen holds it (an applet's own screen: views/AppletScreen.tsx). Tauri's app
// plugin calls the listener instead of going back in the webview while one is registered, and goes back as before when
// none is. Elsewhere (a browser, a Mac) there is no such Back, and this does nothing.
import { inShell } from "../vault/oauth";

/** Take Android's Back until the returned function is called. */
export function holdNativeBack(onPress: () => void): () => void {
  if (!inShell()) return () => {};
  let done = false, off: (() => void) | null = null;
  void import("@tauri-apps/api/app")
    .then(({ onBackButtonPress }) => onBackButtonPress(() => onPress()))
    .then((l) => { if (done) void l.unregister(); else off = () => void l.unregister(); })
    .catch(() => {});
  return () => { done = true; off?.(); };
}
