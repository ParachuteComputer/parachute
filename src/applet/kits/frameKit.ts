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
//   uni.app.openLink(url)            → (links) an http/https/mailto address in the browser, during a tap: whether it went
//   uni.app.save(name, bytes, type)  → (save) a file into Downloads, during a tap: {saved: name}
//   uni.app.pick({accept, multiple}) → (attach) the shell's own picker, during a tap: [{name, type, bytes}], [] for none
//   uni.voice.record({max_s})        → (reach: [voice]) the shell's recorder sheet, during a tap: {bytes, type, duration}
//                                      on Send, null on Cancel (docs/design/KEYRING.md "Voice, files, links, storage")
//   uni.storage.get/set/keys         → (storage) a little JSON kept by the shell on this device for it, 256 KB in all
//   uni.vault.attach(noteId, bytes, type, {transcribe}) → a file onto a note it may change, through the hub
//   uni.services.*                   → the servers it declared (docs/design/SERVICES.md); card/answer/secret: Uni's
//                                      approvals, with the approval key (docs/design/KEYRING.md)
//   uni.props() / uni.onProps(cb)    → a component's props (plain data from the page's record), and later changes
// On a page with embeds (docs/design/EMBED.md), `ready` says `page: {embeds: [names]}`, and in an embedded component's
// frame `page: {sized: true}`: the kit then reports the frame's content height (`page.layout`), and nothing else. The
// shell sets the frame's height from it; the embeds sit under the host's content.
// In-page #anchor links scroll in place.

export const FRAME_KIT = String.raw`(function () {
  var pending = {}, fetches = {}, n = 0, themeCbs = [], openCbs = [], propsCbs = [], theme = null, opened = null, props = {}, readyRes;
  var svcSubs = {}, svcStatus = [], launchCbs = [];
  var measuring = false, lastHeight = -1, queued = false;
  var readyP = new Promise(function (r) { readyRes = r; });
  // the person may take a while: a recording of up to 10 minutes and then Send, a file being chosen
  var WAITS = { "voice.record": 3600000, "app.pick": 3600000, "app.save": 120000, "vault.attach": 120000 };
  // bytes as an ArrayBuffer (what the shell takes), from an ArrayBuffer or a view of one
  function buf(b) { return b instanceof ArrayBuffer ? b : b && ArrayBuffer.isView(b) ? b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) : null; }
  function post(m) { parent.postMessage(m, "*"); }
  function timeout(table, id, rej, ms) { setTimeout(function () { if (table[id]) { delete table[id]; rej(new Error("timeout")); } }, ms || 20000); }
  function call(ns, method, params) {
    return new Promise(function (res, rej) {
      var id = "k" + (++n); pending[id] = { res: res, rej: rej };
      post({ uni: 1, id: id, ns: ns, method: method, params: params || {} });
      // a server can take a while (an upload, a relay's history): services calls wait longer; so do the person (a
      // recording of up to 10 minutes, a file being chosen) and a file going out
      timeout(pending, id, rej, ns === "services" ? 120000 : WAITS[ns + "." + method] || 20000);
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
    if (m.event === "launch") { launchCbs.slice().forEach(function (f) { try { f(m.data); } catch (e) {} }); return; }
    if (m.event === "services.events") {
      var d = m.data || {}, h = svcSubs[d.service + "|" + d.sub];
      if (h) { if (d.events && d.events.length) { h.tries = 0; try { h.onEvents(d.events); } catch (e) {} } if (d.eose && h.onEose) { try { h.onEose(); } catch (e) {} } }
      return;
    }
    if (m.event === "services.status") {
      // a subscription the relay or the shell closed is made again (the kit holds its filters); the applet hears it too
      var st = m.data || {};
      // made again only when it is worth it: the shell let it go (too many at once), or the relay asks a sign-in or had
      // an error; a relay's other refusal (not a member, say) stands
      if (st.sub && st.status === "closed" && st.retry === true && svcSubs[st.service + "|" + st.sub]) again(st.service, st.sub, st.after);
      svcStatus.slice().forEach(function (f) { try { f(st); } catch (e) {} });
      return;
    }
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
  // subscriptions, sent a few dozen to a request (a rooms applet holds one a room), each made again after a refusal
  // (a rate limit, a relay's CLOSED) with a growing wait while its handler is still there
  function sendSubs(service, list) {
    for (var i = 0; i < list.length; i += 25) (function (part) {
      call("services", "subscribe", { service: service, subs: part.map(function (x) { return { sub: x, filters: svcSubs[service + "|" + x].filters }; }) })
        .catch(function (e) {
          // a wait (a rate limit, a busy frame, a timeout) is tried again; a refusal is the applet's to hear
          var transient = e && (e.code === "rate_limited" || e.code === "too_many_pending" || e.message === "timeout");
          part.forEach(function (x) {
            if (transient) { again(service, x); return; }
            delete svcSubs[service + "|" + x];
            svcStatus.slice().forEach(function (f) { try { f({ service: service, sub: x, status: "closed", why: (e && (e.code || e.message)) || "refused" }); } catch (y) {} });
          });
        });
    })(list.slice(i, i + 25));
  }
  function again(service, sub, after) {
    var h = svcSubs[service + "|" + sub]; if (!h || h.waiting) return;
    h.waiting = true; h.tries = (h.tries || 0) + 1;
    // the longer of a growing wait and the one the relay named
    var wait = Math.max(Math.min(30000, 2000 * h.tries), typeof after === "number" ? after * 1000 + 250 : 0);
    setTimeout(function () { if (svcSubs[service + "|" + sub] !== h) return; h.waiting = false; sendSubs(service, [sub]); }, wait);
  }
  var uni = {
    contract: 1,
    ready: function () { return readyP; },
    // what the app opened it for, from a notification's tap: {room, event?}, or null; and each later one
    launch: function () { return readyP.then(function (d) { return (d && d.launch) || null; }); },
    onLaunch: function (cb) {
      launchCbs.push(cb);
      readyP.then(function (d) { if (d && d.launch) { try { cb(d.launch); } catch (e) {} } });
      return function () { var i = launchCbs.indexOf(cb); if (i >= 0) launchCbs.splice(i, 1); };
    },
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
      open: function (href) { return call("app", "open", { href: href }); },
      openLink: function (url) { return call("app", "openLink", { url: url }); },
      save: function (name, bytes, type) {
        var b = buf(bytes);
        if (!b) return Promise.reject(new TypeError("save takes bytes (an ArrayBuffer)"));
        return call("app", "save", { name: name, bytes: b, type: type });
      },
      pick: function (o) { return call("app", "pick", o || {}); }
    }),
    voice: Object.freeze({
      record: function (o) { return call("voice", "record", o || {}); }
    }),
    storage: Object.freeze({
      get: function (key) { return call("storage", "get", { key: key }); },
      set: function (key, value) { return call("storage", "set", { key: key, value: value === undefined ? null : value }); },
      keys: function () { return call("storage", "keys", {}); }
    }),
    // the servers it declared (docs/design/SERVICES.md): the shell talks to them for it, and signs as the person
    services: Object.freeze({
      me: function () { return call("services", "me", {}); },
      fetch: function (service, path, init) {
        init = init || {};
        var p = { service: service, path: path };
        if (init.method) p.method = String(init.method);
        if (init.headers) p.headers = init.headers;
        if (init.as) p.as = init.as;
        var b = init.body;
        if (b instanceof ArrayBuffer) p.bytes = b;
        else if (b && ArrayBuffer.isView(b)) p.bytes = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
        // text goes as bytes too: a long mail or a big JSON body rides outside the request's 8 KB
        else if (typeof b === "string") p.bytes = new TextEncoder().encode(b).buffer;
        else if (b !== undefined && b !== null) p.bytes = new TextEncoder().encode(JSON.stringify(b)).buffer;
        return call("services", "fetch", p);
      },
      relay: function (service) {
        // several subscriptions (one a room, say), the same handlers; returns a function that stops them all
        function many(filterSets, onEvents, onEose) {
            if (typeof onEvents !== "function") throw new TypeError("subscribe needs a function for the events");
            var subs = filterSets.map(function (filters) { var sub = "s" + (++n); svcSubs[service + "|" + sub] = { onEvents: onEvents, onEose: onEose, filters: filters }; return sub; }), on = true;
            sendSubs(service, subs);
            return function () {
              if (!on) return; on = false;
              subs.forEach(function (sub) { delete svcSubs[service + "|" + sub]; });
              // stopped in a few requests, not one each (the frame's rate limit would drop most of them)
              for (var i = 0; i < subs.length; i += 100) call("services", "unsubscribe", { service: service, subs: subs.slice(i, i + 100) }).catch(function () {});
            };
        }
        return Object.freeze({
          subscribe: function (filters, onEvents, onEose) { return many([filters], onEvents, onEose); },
          subscribeMany: many,
          query: function (filters) { return call("services", "query", { service: service, filters: filters }); },
          publish: function (ev) { return call("services", "publish", { service: service, event: ev }); },
          loadPrivate: function (d) { return call("services", "loadPrivate", { service: service, d: d }); },
          savePrivate: function (d, text) { return call("services", "savePrivate", { service: service, d: d, text: text }); },
          onStatus: function (cb) { var f = function (s) { if (s && s.service === service) cb(s); }; svcStatus.push(f); return function () { var i = svcStatus.indexOf(f); if (i >= 0) svcStatus.splice(i, 1); }; }
        });
      },
      upload: function (service, bytes, type) {
        var b = buf(bytes);
        if (!b) return Promise.reject(new TypeError("upload takes bytes (an ArrayBuffer)"));
        return call("services", "upload", { service: service, bytes: b, type: type });
      },
      media: function (service, sha256, ext) { return call("services", "media", { service: service, sha256: sha256, ext: ext }); },
      // Uni's cards and secret requests (docs/design/KEYRING.md): hand the signed message over; the shell checks it,
      // asks for the device unlock when it must, seals the answer with the approval key and sends it
      card: function (service, event) { return call("services", "card", { service: service, event: event }); },
      answer: function (service, event, decision, rids) { return call("services", "answer", { service: service, event: event, decision: decision, rids: rids }); },
      secret: function (service, event) { return call("services", "secret", { service: service, event: event }); },
      forgetSecret: function (service, event) { return call("services", "forgetSecret", { service: service, event: event }); }
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
    // a file onto a note it may change (the hub's upload and attach routes, through the shell); transcribe asks the
    // hub to transcribe audio
    vc.attach = function (noteId, bytes, type, o) {
      var b = buf(bytes);
      if (!b) return Promise.reject(new TypeError("attach takes bytes (an ArrayBuffer)"));
      var p = { noteId: noteId, bytes: b, type: type };
      if (o && o.transcribe !== undefined) p.transcribe = o.transcribe === true;
      return call("vault", "attach", p);
    };
    uni.vault = vc;
  }
  Object.freeze(uni.theme);
  var kit = Object.freeze(uni);
  Object.defineProperty(window, "uni", { value: kit, writable: false, configurable: false });
  // configurable, so an applet written for the Uni app that declares its own top-level "parachute" still loads
  Object.defineProperty(window, "parachute", { value: kit, writable: false, configurable: true });
})();`;
