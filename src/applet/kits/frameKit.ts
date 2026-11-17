// The code injected into every sealed frame, after the CSP meta: `window.uni`, also named `window.parachute`.
// Copied from the Uni app (src/interface/kits/frameKit.ts) so one applet note runs in both apps; chat and note.open are
// left out (this app has no rooms), and `open` is new. It runs inside the frame, so it is a string. Kept free of
// backticks and `${`.
//   uni.ready()                      → Promise of the host's context: {contract, applet: {id, name}, theme, open?}
//                                      `open`: {note: {id, path}, screen} when the app opened a note in this applet.
//                                      The Uni app never sends it: an applet must work without it.
//   uni.onOpen(cb)                   → cb({note, screen}) now (if the app opened a note) and whenever it opens another.
//   uni.frameFetch(url, init)        → fetch over the frame (pfr envelope), what VaultClient uses
//   uni.VaultClient / uni.vault      → surface-client's VaultClient on frameFetch, with the record-worded calls
//                                      queryRecords/getRecord/createRecord/updateRecord (body, fields) beside its own
//   uni.theme.get() / .on(cb)        → the app's look (src/theme): every token is also a CSS var --<key> on <html>
//   uni.app.recent/pins/open         → what it may ask of the app (modules/app.ts), new here: the Uni app has none
//   uni.props() / uni.onProps(cb)    → a component's props (plain data from the page's record), and later changes
// On a page with embeds (docs/design/EMBED.md), `ready` says `page: {embeds: [names]}`, and in an embedded component's
// frame `page: {sized: true}`: the kit then reports the frame's content height (`page.layout`), and nothing else. The
// shell sets the frame's height from it; the embeds sit under the host's content.
// In-page #anchor links scroll in place.

export const FRAME_KIT = String.raw`(function () {
  var pending = {}, fetches = {}, n = 0, themeCbs = [], openCbs = [], propsCbs = [], theme = null, opened = null, props = {}, readyRes;
  var measuring = false, lastHeight = -1, queued = false;
  var readyP = new Promise(function (r) { readyRes = r; });
  function post(m) { parent.postMessage(m, "*"); }
  function timeout(table, id, rej) { setTimeout(function () { if (table[id]) { delete table[id]; rej(new Error("timeout")); } }, 20000); }
  function call(ns, method, params) {
    return new Promise(function (res, rej) {
      var id = "k" + (++n); pending[id] = { res: res, rej: rej };
      post({ uni: 1, id: id, ns: ns, method: method, params: params || {} });
      timeout(pending, id, rej);
    });
  }
  function applyTheme(t) {
    theme = t; var r = document.documentElement.style;
    if (t && typeof t === "object") Object.keys(t).forEach(function (k) { if (/^[a-z]+$/.test(k) && k !== "scheme" && k !== "density" && typeof t[k] === "string") r.setProperty("--" + k, t[k]); });
    if (t && (t.scheme === "light" || t.scheme === "dark")) r.setProperty("color-scheme", t.scheme);
    themeCbs.forEach(function (f) { try { f(t); } catch (e) {} });
  }
  function applyOpen(o) {
    if (!o || !o.note) return;
    opened = o;
    openCbs.slice().forEach(function (f) { try { f(o); } catch (e) {} });
  }
  function applyProps(p) {
    props = p && typeof p === "object" ? p : {};
    propsCbs.slice().forEach(function (f) { try { f(props); } catch (e) {} });
  }
  // the frame's content height, sent when it changes (at most once a frame)
  function measure() {
    queued = false;
    var b = document.body; if (!b) return;
    var cs = getComputedStyle(b);
    var height = Math.ceil(Math.max(b.scrollHeight, b.getBoundingClientRect().height) + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0));
    if (height === lastHeight) return;
    lastHeight = height;
    call("page", "layout", { height: height }).catch(function () {});
  }
  function queue() { if (!queued) { queued = true; requestAnimationFrame(measure); } }
  function startMeasuring() {
    if (measuring) return; measuring = true;
    var st = document.createElement("style");
    st.textContent = "html,body{height:auto!important;min-height:0!important;overflow:hidden!important}";
    document.head.appendChild(st);
    var go = function () {
      if (!document.body) { setTimeout(go, 20); return; }
      try { new ResizeObserver(queue).observe(document.body); } catch (e) {}
      try { new MutationObserver(queue).observe(document.body, { childList: true, subtree: true, attributes: true }); } catch (e) {}
      addEventListener("load", queue, true);
      queue();
    };
    go();
  }
  addEventListener("message", function (e) {
    if (e.source !== parent) return;
    var m = e.data; if (!m || typeof m !== "object") return;
    if (m.pfr === 1) {
      var f = fetches[m.id]; if (!f) return; delete fetches[m.id];
      try { f.res(new Response(m.body, { status: m.status, statusText: m.statusText, headers: m.headers })); } catch (err) { f.rej(err); }
      return;
    }
    if (m.uni !== 1) return;
    if (m.event === "ready") {
      if (m.data && m.data.theme) applyTheme(m.data.theme);
      if (m.data && m.data.props) applyProps(m.data.props);
      readyRes(m.data);
      if (m.data && m.data.open) applyOpen(m.data.open);
      if (m.data && m.data.page && (m.data.page.sized || m.data.page.embeds)) startMeasuring();
      return;
    }
    if (m.event === "props") { applyProps(m.data); return; }
    if (m.event === "theme") { applyTheme(m.data); return; }
    if (m.event === "open") { applyOpen(m.data); return; }
    var p = pending[m.id]; if (!p) return; delete pending[m.id];
    if (m.error) { var er = new Error(m.error.message || m.error.code); er.code = m.error.code; p.rej(er); } else p.res(m.result);
  });
  function frameFetch(input, init) {
    init = init || {};
    return new Promise(function (res, rej) {
      var url = typeof input === "string" ? input : String(input && input.url ? input.url : input);
      var u; try { u = new URL(url); } catch (e) { rej(new TypeError("bad url")); return; }
      var headers = {};
      var h = init.headers;
      if (h && typeof h.forEach === "function") h.forEach(function (v, k) { headers[k] = String(v); });
      else if (h) Object.keys(h).forEach(function (k) { headers[k] = String(h[k]); });
      delete headers.Authorization; delete headers.authorization;
      var id = "f" + (++n); fetches[id] = { res: res, rej: rej };
      post({ pfr: 1, channel: "vault", id: id, method: String(init.method || "GET"), path: u.pathname + u.search, headers: headers, body: typeof init.body === "string" ? init.body : null });
      timeout(fetches, id, rej);
    });
  }
  // In a srcdoc frame a bare "#section" link resolves against the *host's* URL, so the browser would navigate the
  // frame away (the host CSP blocks it, and the host would stop the applet). Scroll in place instead.
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    var h = a && a.getAttribute("href");
    if (typeof h !== "string" || h.charAt(0) !== "#") return;
    e.preventDefault();
    var id = h.slice(1); try { id = decodeURIComponent(id); } catch (err) {}
    var t = id ? document.getElementById(id) || document.getElementsByName(id)[0] : null;
    if (t) t.scrollIntoView(); else if (!id) window.scrollTo(0, 0);
  }, true);
  var uni = {
    contract: 1,
    ready: function () { return readyP; },
    onOpen: function (cb) {
      if (typeof cb !== "function") throw new TypeError("onOpen needs a function");
      openCbs.push(cb); if (opened) { try { cb(opened); } catch (e) {} }
      return function () { var i = openCbs.indexOf(cb); if (i >= 0) openCbs.splice(i, 1); };
    },
    frameFetch: frameFetch,
    call: call,
    props: function () { return props; },
    onProps: function (cb) {
      if (typeof cb !== "function") throw new TypeError("onProps needs a function");
      propsCbs.push(cb);
      return function () { var i = propsCbs.indexOf(cb); if (i >= 0) propsCbs.splice(i, 1); };
    },
    app: Object.freeze({
      recent: function (o) { return call("app", "recent", o || {}); },
      pins: function () { return call("app", "pins", {}); },
      open: function (href) { return call("app", "open", { href: href }); }
    }),
    theme: {
      get: function () { return call("theme", "get", {}); },
      now: function () { return theme; },
      on: function (cb) { themeCbs.push(cb); if (theme) cb(theme); return function () { var i = themeCbs.indexOf(cb); if (i >= 0) themeCbs.splice(i, 1); }; }
    }
  };
  var VC = window.__UniVC && window.__UniVC.VaultClient;
  if (VC) {
    uni.VaultClient = VC;
    var vc = new VC({ vaultUrl: "https://vault.invalid", accessToken: "frame", fetchImpl: frameFetch });
    // The record words (core 0.9's record door): a record's text is its body and its data its fields. The note-named
    // calls stay, for applets written before (and for the Uni app, which has only those).
    var renamed = function (o, map) { if (!o || typeof o !== "object") return o; var r = {}; Object.keys(o).forEach(function (k) { r[map[k] || k] = o[k]; }); return r; };
    var IN = { body: "content", fields: "metadata", includeBody: "includeContent", includeFields: "includeMetadata" };
    var OUT = { content: "body", metadata: "fields" };
    var rec = function (n) { return renamed(n, OUT); };
    vc.queryRecords = function (o) { return vc.queryNotes(renamed(o || {}, IN)).then(function (rows) { return Array.isArray(rows) ? rows.map(rec) : rows; }); };
    vc.getRecord = function (id) { return vc.getNote(id).then(rec); };
    vc.createRecord = function (o) { return vc.createNote(renamed(o || {}, IN)).then(rec); };
    vc.updateRecord = function (id, o) { return vc.updateNote(id, renamed(o || {}, IN)).then(rec); };
    uni.vault = vc;
  }
  Object.freeze(uni.theme);
  var kit = Object.freeze(uni);
  Object.defineProperty(window, "uni", { value: kit, writable: false, configurable: false });
  // configurable, so an applet written for the Uni app that declares its own top-level "parachute" still loads
  Object.defineProperty(window, "parachute", { value: kit, writable: false, configurable: true });
})();`;
