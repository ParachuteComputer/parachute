// What a web host must send with the app's page when it serves the web build (docs/HOSTING.md): the content policy.
// It is the app's own policy (src-tauri/tauri.conf.json, which the phone and computer builds run under) without the
// sources only the shell has (its IPC, this machine's loopback), plus what only a response header can say. Applets run
// in srcdoc frames that inherit the page's policy and then narrow it (shell/frameDoc.ts), so `script-src` must keep
// 'unsafe-inline' and `frame-src about:` is what stops a frame from being sent anywhere. The build writes it into
// dist/hosted.json, so a host takes the policy from the build it serves instead of keeping a copy. Pure.

/** Sources that mean something only inside the shell. */
const SHELL_ONLY = /^(?:tauri:|ipc:|http:\/\/ipc\.localhost|(?:http|ws):\/\/(?:localhost|127\.0\.0\.1):\*)$/;
/** What a header adds: no page may frame the app, no base or form may point elsewhere, no plugins. */
const HEADER_ONLY: Record<string, string> = { "frame-ancestors": "'none'", "base-uri": "'self'", "form-action": "'self'", "object-src": "'none'" };

export function hostedCsp(app: Record<string, string>): string {
  const own = Object.entries(app).map(([k, v]) => [k, v.split(/\s+/).filter((s) => s && !SHELL_ONLY.test(s)).join(" ")] as const);
  return [...own, ...Object.entries(HEADER_ONLY).filter(([k]) => !(k in app))].map(([k, v]) => `${k} ${v}`).join("; ");
}

/** dist/hosted.json: what the build asks of a host. `spa`: the addresses that are the app's own screens, which a host
 *  answers with the app's page (index.html); every other address the host doesn't keep for itself gets the page too
 *  (a note's, an applet's). `/vault` is an older way in to Vault that a host keeping vaults at `/vault` takes for
 *  itself: nothing in the app leads there by a page load. */
export function hostedManifest(app: Record<string, string>) {
  return { contract: 1, csp: hostedCsp(app), spa: ["/", "/add", "/accept", "/oauth/callback", "/settings", "/open-link", "/key", "/key/pair", "/connect", "/capture", "/journal", "/v/*"] };
}
