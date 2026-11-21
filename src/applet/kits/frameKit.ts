// The code injected into every sealed frame, after the CSP meta: `window.uni`, also named `window.parachute`.
// Copied from the Uni app (src/interface/kits/frameKit.ts) so one applet note runs in both apps; chat and note.open are
// left out (this app has no rooms), and `open` is new. It runs inside the frame, so it is a string. Kept free of
// backticks and `${`.
//   uni.ready()                      → Promise of the host's context: {contract, applet: {id, name}, access, services, theme, open?, launch?}
//                                      `open`: {note: {id, path}, screen} when the app opened a note in this applet.
//                                      The Uni app never sends it: an applet must work without it.
//   uni.onOpen(cb)                   → cb({note, screen}) now (if the app opened a note) and whenever it opens another.
//   uni.shown() / uni.onShown(cb)    → whether it is on screen; cb(true|false) when that changes. The app keeps an applet
//                                      running while the person is elsewhere (shell/kept.tsx); hidden, it gets no tap,
//                                      and what only a person looking should do (mark a message read) waits.
//   uni.frameFetch(url, init)        → fetch over the frame (pfr envelope), what VaultClient uses
//   uni.onFresh(cb)                  → cb() when the vault's answer to a read differs from what it was answered with:
//                                      while one is listening, the shell may answer a read at once from what it read
//                                      before, and ask the hub behind it (T-476). The React kit's Page listens with its
//                                      onRefresh, so a page drawn from that copy is drawn again from the hub's answer.
//   uni.VaultClient / uni.vault      → surface-client's VaultClient on frameFetch, with the record-worded calls
//                                      queryRecords/getRecord/createRecord/updateRecord (body, fields) beside its own
//   uni.theme.get() / .on(cb)        → the app's look (src/theme): every token is also a CSS var --<key> on <html>
//   uni.signal(id, count)            → its own number for a signal its record declares: the bar's count (modules/signals.ts)
//   uni.app.recent/pins/open         → what it may ask of the app (modules/app.ts), new here: the Uni app has none
//   uni.app.links(links, from)       → (open) what each note link leads to: "note", "away" or null (links/resolve.ts);
//                                      the React kit's Link, Linked, Note and `link` use it: an applet needn't
//   uni.app.follow(link, {from, choose}) → (open) open what a note link leads to, during a tap: whether it went
//   uni.app.address(noteId)          → (open) the note's address in the applet's own vault: how a link to it is written
//   uni.app.openLink(url)            → (links) an http/https/mailto address in the browser, during a tap: whether it went
//   uni.app.save(name, bytes, type)  → (save) a file into Downloads, during a tap: {saved: name}
//   uni.app.pick({accept, multiple}) → (attach) the shell's own picker, during a tap: [{name, type, bytes}], [] for none
//   uni.voice.record({max_s})        → (reach: [voice]) the shell's recorder sheet, during a tap: {bytes, type, duration}
//                                      on Send, null on Cancel (docs/design/KEYRING.md "Voice, files, links, storage")
//   uni.storage.get/set/keys         → (storage) a little JSON kept by the shell on this device for it, 256 KB in all (a
//                                      value of any size within it: set sends it as bytes)
//   uni.saved.get(key) / .set(key, value) / .all() / .flush() → what it saves on this device as the person goes (drafts,
//                                      the screen it was on): handed back in ready, so get() answers at once after it;
//                                      set() reaches the shell 250 ms after the last change (a second at most while
//                                      typing; at once when the applet is hidden), which writes it to disk. A null value
//                                      removes the key; keys are 1 to 100 plain characters. Where the page was scrolled
//                                      is kept by itself. The React kit's useSaved is built on it.
//   uni.vault.attach(noteId, bytes, type, {transcribe}) → a file onto a note it may change, through the hub
//   uni.services.*                   → the servers it declared (docs/design/SERVICES.md); card/answer/secret: Uni's
//                                      approvals, with the approval key (docs/design/KEYRING.md)
//   uni.props() / uni.onProps(cb)    → a component's props (plain data from the page's record), and later changes
// On a page with embeds (docs/design/EMBED.md), `ready` says `page: {embeds: [names]}`, and in an embedded component's
// frame `page: {sized: true}`: the kit then reports the frame's content height (`page.layout`), and nothing else. The
// shell sets the frame's height from it; the embeds sit under the host's content.
// In-page #anchor links scroll in place.
// Calls and frame-fetches wait in one line, 8 out at once (the shell's limit); a busy refusal is tried again, unseen.

export const FRAME_KIT = String.raw`(function () {
  var pending = {}, fetches = {}, n = 0, themeCbs = [], openCbs = [], propsCbs = [], theme = null, opened = null, props = {}, readyRes;
  var svcSubs = {}, vaultWatches = {}, svcStatus = [], launchCbs = [], shownNow = true, shownCbs = [], freshCbs = [];
  // saved state (docs/WRITE-AN-APPLET.md "Saved state"): what the shell handed back, and what changed since it was sent
  // savedOn: the app hands saved state to this frame (an applet's own screen; an embed's has none)
  var savedVals = {}, savedDirty = null, savedTimer = null, savedFirst = 0, savedOn = false, SAVE_MS = 250, SAVE_MAX_MS = 1000, SCROLL = "parachute:scroll";
  var measuring = false, lastHeight = -1, queued = false;
  var readyP = new Promise(function (r) { readyRes = r; });
  // the person may take a while: a recording of up to 10 minutes and then Send, a file being chosen
  var WAITS = { "voice.record": 3600000, "app.pick": 3600000, "app.save": 120000, "vault.attach": 120000 };
  // bytes as an ArrayBuffer (what the shell takes), from an ArrayBuffer or a view of one
  function buf(b) { return b instanceof ArrayBuffer ? b : b && ArrayBuffer.isView(b) ? b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) : null; }
  function post(m) { parent.postMessage(m, "*"); }
  // The shell holds 8 of a frame's calls waiting at once (src/applet/contract.ts LIMITS.maxPending) and refuses the
  // rest. So the kit sends at most 8 and keeps the others in line; a refusal for being busy (too many waiting, too many
  // in ten seconds) goes back in line after a short wait, within the call's own time. An applet never sees one.
  var MAX_OUT = 8, line = [], out = 0, seq = 0, paused = false, pauseTimer = null;
  // what the person is waiting on goes ahead of the line: a tap's call (it needs the tap still fresh: a link, a file,
  // an answer to Uni's card, trusting its key, a secret), a post, the frame's height. One of the 8 places is kept for
  // these, so a tap is sent at once however many pictures and card checks are out.
  var FIRST = { "app.openLink": 1, "app.follow": 1, "app.save": 1, "app.pick": 1, "app.open": 1, "voice.record": 1, "services.publish": 1, "page.layout": 1,
    "services.answer": 1, "services.trust": 1, "services.secret": 1, "services.forgetSecret": 1 };
  // what must land in the order it was asked goes one at a time, each kind in a lane of its own: what the applet keeps
  // on the device (one store: a read is in the lane too, so it sees the writes asked before it), the frame's height
  // (the last one sent is the one that counts) and its private notes on a relay. A later one is never out while an
  // earlier one may still be refused for being busy and sent again. Posts keep no lane: one waiting on a slow relay
  // would hold a tap's post (an approval) past its tap.
  var LANE = { "storage.set": "kept", "storage.get": "kept", "storage.keys": "kept", "saved.put": "kept", "saved.all": "kept", "page.layout": "layout", "services.savePrivate": "private" }, lanes = {};
  function free(j) { if (j.lane && lanes[j.lane] === j) delete lanes[j.lane]; }
  function pump() {
    for (var i = 0; i < line.length;) {
      var j = line[i];
      if (j.table[j.id] !== j) { line.splice(i, 1); continue; }
      // a tap's call goes whenever a place is free; the rest leave one place free and wait out a pause (a tap's call the
      // shell already refused for being busy waits it out too)
      var tap = j.first && !j.tries;
      if (tap ? out >= MAX_OUT : paused || out >= MAX_OUT - 1) { if (!j.first) break; i++; continue; }
      if (j.lane && lanes[j.lane] && lanes[j.lane] !== j) { i++; continue; }
      line.splice(i, 1);
      if (j.lane) lanes[j.lane] = j;
      j.out = true; out++;
      if (!j.timed) { j.timed = true; timeout(j.table, j.id, j.rej, j.ms); }
      // what can't be sent (a parameter that can't be copied to the shell) fails at once, and frees its place
      try { post(j.msg); } catch (err) { j.out = false; out--; free(j); delete j.table[j.id]; j.rej(err); }
    }
  }
  // the line in the order things were asked, what the person waits on first (its own order kept too)
  function place(j) { var k = line.length; while (k > 0 && line[k - 1].seq > j.seq) k--; line.splice(k, 0, j); }
  function send(table, id, msg, ms, res, rej, first, lane) {
    var j = { table: table, id: id, msg: msg, ms: ms, res: res, rej: rej, tries: 0, out: false, timed: false, first: !!first, lane: lane || null, seq: (first ? -1e12 : 0) + (++seq) };
    table[id] = j;
    place(j);
    pump();
  }
  // its answer came: its place is free. A busy refusal goes back in line where it was (in the order it was asked; a
  // write keeps its lane, so no later write of its kind goes before it) and the whole line waits a little, growing
  // with its tries; else the call is settled.
  function answered(j, busy) {
    if (j.out) { j.out = false; out--; }
    if (busy) {
      j.tries++;
      place(j);
      paused = true; clearTimeout(pauseTimer);
      pauseTimer = setTimeout(function () { paused = false; pump(); }, Math.min(2000, 100 * Math.pow(2, j.tries)));
      return true;
    }
    free(j);
    delete j.table[j.id];
    return false;
  }
  function timeout(table, id, rej, ms) {
    setTimeout(function () {
      var j = table[id]; if (!j) return;
      delete table[id]; free(j);
      var was = j.out;
      if (was) { j.out = false; out--; }
      rej(new Error("timeout"));
      pump();
    }, ms || 20000);
  }
  // loose: outside its lane (the last save as the frame goes: nothing of this frame comes after it)
  function call(ns, method, params, loose) {
    return new Promise(function (res, rej) {
      var id = "k" + (++n);
      // a server can take a while (an upload, a relay's history): services calls wait longer; so do the person (a
      // recording of up to 10 minutes, a file being chosen) and a file going out
      send(pending, id, { uni: 1, id: id, ns: ns, method: method, params: params || {} }, ns === "services" ? 120000 : WAITS[ns + "." + method] || 20000, res, rej, FIRST[ns + "." + method] === 1, loose ? null : LANE[ns + "." + method]);
    });
  }
  function applyTheme(t) {
    theme = t; var r = document.documentElement.style;
    if (t && typeof t === "object") Object.keys(t).forEach(function (k) { if (/^[a-z]+$/.test(k) && k !== "scheme" && k !== "density" && k !== "motion" && typeof t[k] === "string") r.setProperty("--" + k, t[k]); });
    if (t && (t.scheme === "light" || t.scheme === "dark")) r.setProperty("color-scheme", t.scheme);
    // still: nothing in the kit moves (theme.ts MOTION_CSS reads this mark)
    if (t && (t.motion === "flowing" || t.motion === "still")) document.documentElement.setAttribute("data-motion", t.motion);
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
    // the page is drawn at its content's height: the kit's parts read this (a Drawer opens in place)
    document.documentElement.setAttribute("data-sized", "");
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
  // what changed goes in batches of at most 64 keys; the keys of a batch that failed to be written go back in line, each
  // with the value it holds now (never the one the failed batch carried: a newer one may have been kept since), so a
  // draft is never dropped by one failed write and never put back by one
  // leaving: the frame is going (pagehide): what changed is sent now, not behind a save still out, since a frame
  // that is gone sends nothing later
  function savedFlush(leaving) {
    if (savedTimer) { clearTimeout(savedTimer); savedTimer = null; }
    savedFirst = 0;
    if (!savedDirty || !savedOn) return Promise.resolve(null);
    var all = savedDirty, keys = Object.keys(all); savedDirty = null;
    var sends = [];
    for (var i = 0; i < keys.length; i += 64) {
      var part = {}; keys.slice(i, i + 64).forEach(function (k) { part[k] = all[k]; });
      sends.push(call("saved", "put", { bytes: new TextEncoder().encode(JSON.stringify(part)).buffer }, leaving === true).then(null, (function (part) { return function (e) {
        try { console.warn("saved: " + (e && e.message)); } catch (x) {}
        // only what may pass next time goes back in line (the disk, a busy shell, no answer); a refusal for what it is
        // (a bad key or value, a full store) would block every later save, so it is dropped, said once in the console
        var code = e && e.code;
        if (code && code !== "failed" && code !== "rate_limited" && code !== "too_many_pending") return null;
        savedDirty = savedDirty || {};
        Object.keys(part).forEach(function (k) { if (!Object.prototype.hasOwnProperty.call(savedDirty, k)) savedDirty[k] = Object.prototype.hasOwnProperty.call(savedVals, k) ? savedVals[k] : null; });
        if (!savedTimer) savedTimer = setTimeout(savedFlush, SAVE_MAX_MS);
        return null;
      }; })(part)));
    }
    return Promise.all(sends).then(function () { return null; });
  }
  function savedSet(key, value) {
    if (typeof key !== "string" || !key || key.length > 100 || /[\u0000-\u001f\u007f\u2028\u2029]/.test(key)) throw new TypeError("saved needs a key of 1 to 100 plain characters");
    // the kit holds what is saved in plain objects, where this one name would be the object's own workings, not a key
    if (key === "__proto__") throw new TypeError("saved can't keep a key named __proto__");
    var v = value === undefined ? null : value;
    if (v !== null) { var text = JSON.stringify(v); if (text === undefined) throw new TypeError("saved keeps JSON"); v = JSON.parse(text); }
    if (v === null) delete savedVals[key]; else savedVals[key] = v;
    (savedDirty = savedDirty || {})[key] = v;
    // 250 ms after the last change, and never more than a second after the first: one call while typing, not four
    var now = Date.now(); if (!savedFirst) savedFirst = now;
    if (savedTimer) clearTimeout(savedTimer);
    savedTimer = setTimeout(savedFlush, Math.max(0, Math.min(SAVE_MS, savedFirst + SAVE_MAX_MS - now)));
  }
  // where the page was scrolled: kept as the person scrolls, put back once when the page is tall enough again
  var scrollBack = null;
  function restoreScroll() {
    var want = savedVals[SCROLL]; if (typeof want !== "number" || want <= 0) return;
    var until = Date.now() + 4000, done = false;
    function tryIt() {
      if (done || Date.now() > until) return;
      if (document.documentElement.scrollHeight - innerHeight >= want) { scrollTo(0, want); done = true; return; }
      setTimeout(tryIt, 100);
    }
    scrollBack = function () { done = true; };
    tryIt();
  }
  addEventListener("scroll", function () { if (savedOn) savedSet(SCROLL, Math.round(scrollY) || null); }, { passive: true });
  // the person scrolling first wins over putting the old place back
  addEventListener("wheel", function () { if (scrollBack) scrollBack(); }, { passive: true });
  addEventListener("touchstart", function () { if (scrollBack) scrollBack(); }, { passive: true });
  // nothing waits on a way out, but where there is a moment, what changed goes now
  addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") savedFlush(); });
  addEventListener("pagehide", function () { savedFlush(true); });
  addEventListener("message", function (e) {
    if (e.source !== parent) return;
    var m = e.data; if (!m || typeof m !== "object") return;
    if (m.pfr === 1) {
      var f = fetches[m.id]; if (!f) return;
      if (!answered(f, m.status === 429 && (m.statusText === "too_many_pending" || m.statusText === "rate_limited"))) {
        try { f.res(new Response(m.body, { status: m.status, statusText: m.statusText, headers: m.headers })); } catch (err) { f.rej(err); }
      }
      pump();
      return;
    }
    if (m.uni !== 1) return;
    if (m.event === "ready") {
      if (m.data && m.data.saved && typeof m.data.saved === "object") { savedOn = true; savedVals = m.data.saved; restoreScroll(); }
      if (m.data && m.data.theme) applyTheme(m.data.theme);
      if (m.data && m.data.props) applyProps(m.data.props);
      // booted while hidden: what read shown() before ready (a component's first render) hears the change
      if (m.data && typeof m.data.shown === "boolean" && m.data.shown !== shownNow) { shownNow = m.data.shown; shownCbs.slice().forEach(function (f) { try { f(shownNow); } catch (e) {} }); }
      readyRes(m.data);
      if (m.data && m.data.open) applyOpen(m.data.open);
      if (m.data && m.data.page && (m.data.page.sized || m.data.page.embeds)) startMeasuring();
      return;
    }
    if (m.event === "props") { applyProps(m.data); return; }
    if (m.event === "theme") { applyTheme(m.data); return; }
    if (m.event === "open") { applyOpen(m.data); return; }
    if (m.event === "vault.fresh") { freshCbs.slice().forEach(function (f) { try { f(); } catch (e) {} }); return; }
    if (m.event === "launch") { launchCbs.slice().forEach(function (f) { try { f(m.data); } catch (e) {} }); return; }
    if (m.event === "shown") { shownNow = !!(m.data && m.data.shown); if (!shownNow) savedFlush(); shownCbs.slice().forEach(function (f) { try { f(shownNow); } catch (e) {} }); return; }
    if (m.event === "services.events") {
      var d = m.data || {}, h = svcSubs[d.service + "|" + d.sub];
      if (h) { if (d.events && d.events.length) { h.tries = 0; try { h.onEvents(d.events); } catch (e) {} } if (d.eose && h.onEose) { try { h.onEose(); } catch (e) {} } }
      return;
    }
    if (m.event === "vaults.events") {
      var vd = m.data || {}, vw = vaultWatches[vd.id];
      if (vw) { try { vw(vd.upsert ? { upsert: vd.upsert } : { remove: vd.remove }); } catch (e) {} }
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
    var p = pending[m.id]; if (!p) return;
    // the shell's own refusals carry only their code; a module's (one file a second) carries its words and stands
    if (!answered(p, !!m.error && (m.error.code === "too_many_pending" || (m.error.code === "rate_limited" && (m.error.message || "rate_limited") === "rate_limited")))) {
      if (m.error) { var er = new Error(m.error.message || m.error.code); er.code = m.error.code; p.rej(er); } else p.res(m.result);
    }
    pump();
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
      // a read while something draws again on onFresh may be answered from what the shell read before
      if (freshCbs.length && String(init.method || "GET").toUpperCase() === "GET") headers["x-parachute-redraws"] = "1";
      var id = "f" + (++n);
      send(fetches, id, { pfr: 1, channel: "vault", id: id, method: String(init.method || "GET"), path: u.pathname + u.search, headers: headers, body: typeof init.body === "string" ? init.body : null }, 20000, res, rej, false);
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
  // A sealed frame has no allow-forms, so the browser drops a form's submit before any handler hears it. A form written
  // the plain way (a submit button, Enter in a field) still reaches its onSubmit: the kit sends the submit event itself,
  // as a browser would: after the applet's own handlers (bubbling, on window, so their preventDefault still stops it),
  // and only when the form's fields are valid (required, pattern, type=email, unless noValidate).
  // (Found on the cold walk, T-476: an AI's reading tracker added nothing on its Add button.)
  function submitForm(form, by) {
    if (!form.noValidate && !(by && by.formNoValidate) && typeof form.reportValidity === "function" && !form.reportValidity()) return;
    var ev;
    try { ev = new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter: by || null }); } catch (err) { ev = new Event("submit", { bubbles: true, cancelable: true }); }
    form.dispatchEvent(ev);
  }
  /** A submit button (or input), disabled or not; null for anything else. */
  function submitControl(el) {
    if (!el || !el.form || (el.tagName !== "BUTTON" && el.tagName !== "INPUT")) return null;
    var kind = (el.getAttribute("type") || (el.tagName === "BUTTON" ? "submit" : "")).toLowerCase();
    return kind === "submit" || kind === "image" ? el : null;
  }
  var TEXTLIKE = /^(|text|search|email|url|tel|password|number|date|time|datetime-local|month|week)$/i;
  addEventListener("click", function (e) {
    if (e.defaultPrevented) return;
    var b = submitControl(e.target && e.target.closest ? e.target.closest("button, input") : null);
    if (!b || b.disabled) return;
    e.preventDefault();
    submitForm(b.form, b);
  });
  addEventListener("keydown", function (e) {
    var f = e.target;
    if (e.key !== "Enter" || e.isComposing || e.defaultPrevented || !f || f.tagName !== "INPUT" || !f.form || !TEXTLIKE.test(f.getAttribute("type") || "")) return;
    var form = f.form, by = null, fields = 0, i, el;
    for (i = 0; i < form.elements.length; i++) {
      el = form.elements[i];
      if (!by && submitControl(el)) by = el;
      if (el.tagName === "INPUT" && TEXTLIKE.test(el.getAttribute("type") || "")) fields++;
    }
    // as a browser does: Enter submits through the form's first submit control (nothing when that one is disabled), or
    // a form with one text field and none
    if (by ? by.disabled : fields !== 1) return;
    e.preventDefault();
    submitForm(form, by);
  });
  // subscriptions, sent a few dozen to a request (a rooms applet holds one a room), each made again after a timeout or
  // a relay's CLOSED with a growing wait while its handler is still there
  function sendSubs(service, list) {
    for (var i = 0; i < list.length; i += 25) (function (part) {
      call("services", "subscribe", { service: service, subs: part.map(function (x) { return { sub: x, filters: svcSubs[service + "|" + x].filters }; }) })
        .catch(function (e) {
          // a timeout is tried again (the kit already waits out a busy shell); a refusal is the applet's to hear
          var transient = e && e.message === "timeout";
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
    shown: function () { return shownNow; },
    onShown: function (cb) {
      if (typeof cb !== "function") throw new TypeError("onShown needs a function");
      shownCbs.push(cb);
      return function () { var i = shownCbs.indexOf(cb); if (i >= 0) shownCbs.splice(i, 1); };
    },
    onFresh: function (cb) {
      if (typeof cb !== "function") throw new TypeError("onFresh needs a function");
      freshCbs.push(cb);
      return function () { var i = freshCbs.indexOf(cb); if (i >= 0) freshCbs.splice(i, 1); };
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
      // with app: [changes] (level 5): what others changed today, how many and by whom; {count, names, more, href}
      changes: function () { return call("app", "changes", {}); },
      open: function (href) { return call("app", "open", { href: href }); },
      copy: function (text) { return call("app", "copy", { text: text }); },
      links: function (links, from) { var p = { links: links }; if (typeof from === "string") p.from = from; return call("app", "links", p); },
      follow: function (link, o) {
        var p = { link: link };
        if (o && typeof o.from === "string") p.from = o.from;
        if (o && o.choose === true) p.choose = true;
        return call("app", "follow", p);
      },
      address: function (note) { return call("app", "address", { note: note }); },
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
    saved: Object.freeze({
      get: function (key) { return Object.prototype.hasOwnProperty.call(savedVals, key) ? savedVals[key] : null; },
      set: savedSet,
      all: function () { return JSON.parse(JSON.stringify(savedVals)); },
      flush: function () { return savedFlush(); }
    }),
    storage: Object.freeze({
      get: function (key) { return call("storage", "get", { key: key }); },
      // a value goes as JSON text in bytes, so it may be any size within its 256 KB (a call's parameters are 8 KB at most)
      set: function (key, value) {
        if (value === undefined || value === null) return call("storage", "set", { key: key, value: null });
        var text;
        try { text = JSON.stringify(value); } catch (e) { return Promise.reject(e); }
        if (text === undefined) return Promise.reject(new TypeError("storage keeps JSON"));
        return call("storage", "set", { key: key, bytes: new TextEncoder().encode(text).buffer });
      },
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
      // a card from a key the grant names that this device doesn't trust yet: the shell asks the person (its own sheet,
      // the name theirs), then the device unlock; the card as it now reads
      trust: function (service, event) { return call("services", "trust", { service: service, event: event }); },
      forgetSecret: function (service, event) { return call("services", "forgetSecret", { service: service, event: event }); }
    }),
    // its own number for a signal its record declares (docs/design/APP-RECORD.md "Signals"): the bar's count
    signal: function (id, count) { return call("signals", "set", { id: id, count: count }); },
    // with app: [vaults] (the Vault applet's): every vault this device holds; a change goes as JSON text in bytes
    vaults: Object.freeze({
      list: function () { return call("vaults", "list", {}); },
      // T-476: each hub the vaults are on and its one address for an AI (an older app has no hubs: a caller checks)
      hubs: function () { return call("vaults", "hubs", {}); },
      types: function (vault) { return call("vaults", "types", { vault: vault }); },
      query: function (vault, q) { var p = { vault: vault }; Object.keys(q || {}).forEach(function (k) { if (q[k] !== undefined) p[k] = q[k]; }); return call("vaults", "query", p); },
      get: function (vault, id) { return call("vaults", "get", { vault: vault, id: id }); },
      history: function (vault, id) { return call("vaults", "history", { vault: vault, id: id }); },
      version: function (vault, id, ix) { return call("vaults", "version", { vault: vault, id: id, ix: ix }); },
      // what changed since an ISO time, by whom (newest first); a change's two sides; putting one back (level 5)
      changes: function (vault, since, offset) { return call("vaults", "changes", offset ? { vault: vault, since: since, offset: offset } : { vault: vault, since: since }); },
      compare: function (vault, id, before, after) { return call("vaults", "compare", { vault: vault, id: id, before: before === undefined ? null : before, after: after === undefined ? null : after }); },
      restore: function (vault, id, ix, ifUpdatedAt) { return call("vaults", "restore", ifUpdatedAt ? { vault: vault, id: id, ix: ix, if_updated_at: ifUpdatedAt } : { vault: vault, id: id, ix: ix }); },
      remove: function (vault, id, ifUpdatedAt) { return call("vaults", "remove", { vault: vault, id: id, if_updated_at: ifUpdatedAt }); },
      update: function (vault, id, change) { return call("vaults", "update", { vault: vault, id: id, bytes: new TextEncoder().encode(JSON.stringify(change)).buffer }); },
      create: function (vault, rec) { return call("vaults", "create", { vault: vault, bytes: new TextEncoder().encode(JSON.stringify(rec)).buffer }); },
      // cb({upsert: record} | {remove: id}) as changes land; returns a function that stops it
      watch: function (vault, type, cb) {
        if (typeof cb !== "function") throw new TypeError("watch needs a function");
        var id = null, stopped = false;
        call("vaults", "watch", type ? { vault: vault, type: type } : { vault: vault }).then(function (r) {
          if (stopped) { call("vaults", "unwatch", { id: r.id }).catch(function () {}); return; }
          id = r.id; vaultWatches[id] = cb;
        }, function () {});
        return function () { stopped = true; if (id) { delete vaultWatches[id]; call("vaults", "unwatch", { id: id }).catch(function () {}); } };
      },
      applets: function (vault) { return call("vaults", "applets", { vault: vault }); },
      packs: function (vault) { return call("vaults", "packs", { vault: vault }); },
      addPack: function (vault, id) { return call("vaults", "addPack", { vault: vault, id: id }); },
      // with app: [sharing]
      access: function (vault) { return call("vaults", "access", { vault: vault }); },
      publish: function (vault, id, on) { return call("vaults", "publish", { vault: vault, id: id, on: on !== false }); },
      revoke: function (vault, noteId) { return call("vaults", "revoke", { vault: vault, noteId: noteId }); },
      readOnly: function (vault) { return call("vaults", "readOnly", { vault: vault }); },
      people: function (vault) { return call("vaults", "people", { vault: vault }); },
      invite: function (vault, name, from) { return call("vaults", "invite", { vault: vault, name: name, from: from || null }); },
      takeBack: function (vault, id) { return call("vaults", "takeBack", { vault: vault, id: id }); },
      end: function (vault, key, name) { return call("vaults", "end", { vault: vault, key: key, name: name || "" }); }
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
