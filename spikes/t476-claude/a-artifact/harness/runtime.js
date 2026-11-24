// Injected into the artifact page by the harness, before the page's own scripts: window.claude.use("mcp") as
// contract 0.2.96 (mcp.d.ts) describes it. Every call goes to the host page over postMessage; the page holds no
// token and reaches no network itself (the CSP forbids it), as on claude.ai.
(function () {
  var seq = 0, pending = {}, watches = {};
  addEventListener("message", function (e) {
    if (e.source !== parent) return;
    var m = e.data;
    if (!m || m.t476 !== 1) return;
    if (m.watch && watches[m.watch]) { watches[m.watch](m.ev); return; }
    var p = pending[m.id];
    if (!p) return;
    delete pending[m.id];
    if (m.error) p.reject(Object.assign(new Error(m.error.message), m.error)); else p.resolve(m.result);
  });
  function ask(op, args) {
    return new Promise(function (resolve, reject) {
      var id = "c" + (++seq);
      pending[id] = { resolve: resolve, reject: reject };
      parent.postMessage({ t476: 1, id: id, op: op, args: args }, "*");
    });
  }
  function plain(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  var mcp = Object.freeze({
    callTool: function (server, tool, input, options) {
      var opts = options || {};
      if (opts.signal && opts.signal.aborted) return Promise.reject(Object.assign(new Error("cancelled"), { code: "cancelled" }));
      return ask("callTool", { server: server, tool: tool, input: plain(input), cache: opts.cache });
    },
    watchTool: function (server, tool, input, handler, options) {
      var id = "w" + (++seq);
      watches[id] = handler;
      parent.postMessage({ t476: 1, id: id, op: "watchTool", args: { server: server, tool: tool, input: plain(input), refetchInterval: (options || {}).refetchInterval } }, "*");
      return function () { delete watches[id]; parent.postMessage({ t476: 1, id: id, op: "unwatch" }, "*"); };
    },
    invalidate: function (server, tool, input) { return ask("invalidate", { server: server, tool: tool, input: plain(input) }); },
    listTools: function (server) { return ask("listTools", { server: server }); },
    describeTool: function (server, tool) { return ask("describeTool", { server: server, tool: tool }); },
    server: function (name) {
      return mcp.listTools(name).then(function (l) {
        var h = {};
        ((l.servers[0] || {}).tools || []).forEach(function (t) { h[t.name] = function (input, o) { return mcp.callTool(name, t.name, input, o).then(function (r) { return r.payload; }); }; });
        return Object.freeze(h);
      });
    },
  });
  // use() never resolves during the script's first synchronous run (claude.d.ts)
  window.claude = Object.freeze({ use: function (name) { return new Promise(function (r) { setTimeout(function () { r(name === "mcp" ? mcp : null); }, 0); }); } });
})();
