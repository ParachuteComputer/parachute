// The frame's document: the CSP first (no network, no frames, no forms), WebRTC removed from its own realm, its styles,
// then its script. It runs in a srcdoc iframe with sandbox="allow-scripts": an opaque origin, so no storage of its
// own, nothing of the shell's, no popups and no way to move the shell. (WebRTC ignores CSP; removing it here is not a
// seal: the self-test is what proves a frame sealed on this device.) Pure.
import { inlineScript, NO_RTC } from "../applet/srcdoc";

export const FRAME_DOC_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";

export const frameDocument = (js: string, css: string): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${FRAME_DOC_CSP}">${NO_RTC}<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><style>${css.replace(/<\/(style)/gi, "<\\/$1")}</style></head><body><div id="root"></div>${inlineScript(js)}</body></html>`;
