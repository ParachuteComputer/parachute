// The device's user agent, as the places that name the device read it. An iPad's webview asks for desktop pages, so its
// user agent says "Macintosh" like a Mac's; but a Mac has no touch screen, so a "Macintosh" with touch points is an
// iPad, and is named so here. (An iPhone's says "like Mac OS X" too: the readers ask for iPhone and iPad first.)
export function deviceAgent(
  ua: string = typeof navigator === "undefined" ? "" : navigator.userAgent,
  touchPoints: number = typeof navigator === "undefined" ? 0 : navigator.maxTouchPoints ?? 0,
): string {
  return /Macintosh/.test(ua) && touchPoints > 1 ? ua.replace("Macintosh", "iPad") : ua;
}
