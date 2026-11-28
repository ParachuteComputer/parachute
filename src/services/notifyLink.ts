// The link a notification opens (src-tauri gen/android NotifyService.kt): parachute://notify?subject=<the applet's
// address in the app>&room=<room id>&event=<event id>. The applet's screen hands room and event to the applet as its
// launch (`uni.launch()`), and the applet opens there. Pure; only the app's own applet addresses pass.

/** An applet's address in the app, read back exactly as written (as applet/modules/app.ts `appHref`, kept here so the
 *  link handler at the root imports nothing of the applet runtime). */
function appletHref(href: string): boolean {
  if (!/^\/v\/[^/?#\\]+\/a\/[^/?#\\]+$/.test(href) || /[\u0000-\u0020\u007f]/.test(href)) return false;
  try { return new URL(href, "http://app.invalid").pathname === href; } catch { return false; }
}

const ROOM = /^[A-Za-z0-9_-]{1,64}$/;
const EVENT = /^[0-9a-f]{64}$/;

/** The app path for a notification's link, or null when it isn't one. */
export function notifyPath(raw: string): string | null {
  const m = typeof raw === "string" && raw.length <= 2000 ? raw.match(/^parachute:\/\/notify\/?\?([^#]*)$/i) : null;
  if (!m) return null;
  const q = new URLSearchParams(m[1]);
  const subject = q.get("subject") ?? "", room = q.get("room") ?? "", event = q.get("event") ?? "";
  if (!appletHref(subject)) return "/";
  const at = new URLSearchParams();
  if (ROOM.test(room)) at.set("room", room);
  if (EVENT.test(event)) at.set("event", event);
  const query = at.toString();
  return query ? `${subject}?${query}` : subject;
}

/** What an applet is told it was opened for (from its address's query): a room and a message. */
/** A vault and a record in it, for an applet that reaches every vault (`app: [vaults]`): Vault opens there. */
export function vaultLaunchOf(params: URLSearchParams): { vault: string; record?: string; show?: "changes" | "sharing" | "tables" | "new" } | null {
  const vault = params.get("vault"), record = params.get("record");
  if (!vault || vault.length > 200 || /[\u0000-\u001f]/.test(vault)) return null;
  // `show=changes`: the vault's Changes (Home's line, T-476); `show=sharing`: its Sharing (back from the hub's yes to
  // manage who reaches it)
  const show = params.get("show");
  // `show=tables`: its types and tables, one step from its notes (a new vault's "Bring in what you have", Parachute
  // Cloud's import step); `show=new`: a new note there, ready to type in (Cloud's "Write a note": signInFlow startAdded)
  return { vault, ...(record && ROOM.test(record) ? { record } : {}), ...(show === "changes" || show === "sharing" || show === "tables" || show === "new" ? { show } : {}) };
}

export function launchOf(params: URLSearchParams): { room: string; event?: string } | null {
  const room = params.get("room"), event = params.get("event");
  if (!room || !ROOM.test(room)) return null;
  return { room, ...(event && EVENT.test(event) ? { event } : {}) };
}
