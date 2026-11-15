// The two facts a self-test pass is keyed on besides the platform and user agent: the app's version and the webview
// runtime. In the shell they come from native code (src-tauri/src/lib.rs); in a plain browser, from the build, and the
// runtime is "browser". Unknown (the shell didn't answer) is null, which keeps the gate closed.
import { invoke } from "@tauri-apps/api/core";
import { inShell } from "../../vault/oauth";

let facts: Promise<{ version: string | null; runtime: string | null }> | null = null;

export function runtimeFacts(): Promise<{ version: string | null; runtime: string | null }> {
  if (facts) return facts;
  facts = inShell()
    ? Promise.all([invoke<string>("app_version").catch(() => null), invoke<string>("webview_runtime").catch(() => null)])
        .then(([version, runtime]) => ({ version: version || null, runtime: runtime || null }))
    : Promise.resolve({ version: __APP_VERSION__, runtime: "browser" });
  return facts;
}
