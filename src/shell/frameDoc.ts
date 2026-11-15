// The frame's document: the CSP first (no network, no frames, no forms), WebRTC removed from its own realm, its styles,
// a line for a failure, the runtime (React, react-router, "@parachute/frame"), then the frame's code: one module
// (transpiled by the shell) whose default export is the frame, run with only the runtime's modules as its imports. It
// runs in a srcdoc iframe with sandbox="allow-scripts": an opaque origin, so no storage of its own, nothing of the
// shell's, no popups and no way to move the shell. (WebRTC ignores CSP; removing it here is not a seal: the self-test is
// what proves a frame sealed on this device.) Pure.
import { inlineScript, NO_RTC } from "../applet/srcdoc";

export const FRAME_DOC_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";
/** What a frame's code may import. */
export const FRAME_IMPORTS = ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "react-router", "@parachute/frame"] as const;

// Kept free of backticks and `${`. A failure shows one line and tells the shell, which then shows the built-in frame.
const FAILURE = String.raw`(function () {
  window.__parachuteFail = function (e) {
    var m = e && e.message ? e.message : String(e), root = document.getElementById("root");
    if (root) { root.textContent = ""; var p = document.createElement("p"); p.className = "parachute-error"; p.textContent = "This frame stopped: " + m; root.appendChild(p); }
    parent.postMessage({ pf: 1, failed: String(m).slice(0, 300) }, "*");
  };
  addEventListener("error", function (e) { var root = document.getElementById("root"); if (root && !root.firstChild) window.__parachuteFail(e.error || e.message); });
})();`;
const LOADER_HEAD = String.raw`(function () {
  var F = window.__ParachuteFrame, fail = window.__parachuteFail;
  function require(name) {
    if (Object.prototype.hasOwnProperty.call(F.modules, name)) return F.modules[name];
    throw new Error("it imports " + name + ", and a frame can import only " + Object.keys(F.modules).join(", "));
  }
  var module = { exports: {} };
  (async function (require, module, exports) {
`;
const LOADER_TAIL = String.raw`
  })(require, module, module.exports).then(function () {
    var C = module.exports && module.exports.default;
    if (typeof C !== "function" && !(C && typeof C === "object" && C.$$typeof)) throw new Error("its module has no default export to show (export default function Frame() …)");
    F.mount(C);
  }).catch(fail);
})();`;

export const frameDocument = (runtime: string, css: string, frameJs: string): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${FRAME_DOC_CSP}">${NO_RTC}<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><style>${css.replace(/<\/(style)/gi, "<\\/$1")}</style></head><body><div id="root"></div>${inlineScript(FAILURE)}${inlineScript(runtime)}${inlineScript(`${LOADER_HEAD}${frameJs}${LOADER_TAIL}`)}</body></html>`;
