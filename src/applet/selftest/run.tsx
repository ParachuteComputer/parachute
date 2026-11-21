// The self-test runs by itself: at launch, when no stored result fits this platform, app version, webview and runtime
// (a first launch, an update, a webview upgrade). It takes a few seconds in hidden frames. Settings shows the result and
// "Run again". A pass (or a failure of only the WebRTC checks) is stored with its mode; any other result clears it, so
// applets are off and every note opens in the vault view.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createRouter } from "../router";
import { createThemeModule } from "../modules/theme";
import { clearSelfTest, currentUserAgent, gateMode, parseSelfTest, platformName, readSelfTestRaw, storeSelfTest, subscribeSelfTest, type GateMode } from "./gate";
import { evaluateProbe, navProbeHtml, navVerdict, NAV_STAGES, PROBE_HTML, type ProbeResult } from "./probe";
import ProbeFrame, { type ProbeOutcome } from "./ProbeFrame";
import { runtimeFacts } from "./runtime";

const TIMEOUT_MS = 40000;
const STUB_ROUTER = createRouter([createThemeModule({ theme: () => ({ accent: "selftest" }) })]);
const STAGES = [{ id: "main", html: PROBE_HTML, nav: false }, ...NAV_STAGES.map((s) => ({ id: s.id, html: navProbeHtml(s.vector), nav: true }))];
export const PLATFORM = platformName(currentUserAgent());

type RunState = { running: boolean; last: ProbeResult | null; timedOut: boolean; requested: number; version: string | null; runtime: string | null; known: boolean };
let state: RunState = { running: false, last: null, timedOut: false, requested: 0, version: null, runtime: null, known: false };
const listeners = new Set<() => void>();
const set = (patch: Partial<RunState>) => { state = { ...state, ...patch }; listeners.forEach((f) => f()); };
const subscribe = (cb: () => void) => { listeners.add(cb); return () => listeners.delete(cb); };

/** Ask for a run (Settings' "Run again"). */
export const runSelfTest = () => set({ requested: state.requested + 1 });
export const useSelfTestRun = () => useSyncExternalStore(subscribe, () => state, () => state);

/** The gate now, outside React: "closed" until the facts are known and a stored pass fits them. */
export function gateNow(): GateMode | "closed" {
  if (!state.version || !state.runtime) return "closed";
  return gateMode(PLATFORM, state.version, parseSelfTest(readSelfTestRaw()), currentUserAgent(), undefined, state.runtime);
}
/** Are the facts the gate is judged on known yet? */
export const gateKnown = () => state.known;
/** Is the self-test running now? */
export const selfTestRunning = () => state.running;
/** Resolves once the facts the gate is judged on are known (the self-test itself may still be running). */
export const whenGateKnown = (): Promise<void> => (state.known ? Promise.resolve() : new Promise((res) => { const off = subscribe(() => { if (state.known) { off(); res(); } }); }));
/** Any change to the gate: the run's state or the stored pass. */
export function subscribeGate(cb: () => void): () => void { const a = subscribe(cb); const b = subscribeSelfTest(cb); return () => { a(); b(); }; }

/** The gate as it stands now, live: "closed" until the facts are known and a stored pass fits them. */
export function useGate(): GateMode | "closed" {
  const raw = useSyncExternalStore(subscribeSelfTest, readSelfTestRaw, () => null);
  const run = useSelfTestRun();
  if (!run.version || !run.runtime) return "closed";
  return gateMode(PLATFORM, run.version, parseSelfTest(raw), currentUserAgent(), undefined, run.runtime);
}

/** Mounted once at the app's root: decides whether to run, and runs. Renders hidden frames only while running. */
export function SelfTestRunner() {
  const run = useSelfTestRun();
  const [stage, setStage] = useState<number | null>(null);
  const report = useRef<Record<string, unknown>>({});
  const token = useRef(0);

  useEffect(() => {
    let on = true;
    void runtimeFacts().then(({ version, runtime }) => {
      if (!on) return;
      set({ version, runtime, known: true });
      const stored = parseSelfTest(readSelfTestRaw());
      // nothing stored fits this build and webview: run now, by itself
      if (version && runtime && gateMode(PLATFORM, version, stored, currentUserAgent(), undefined, runtime) === "closed") runSelfTest();
    });
    return () => { on = false; };
  }, []);

  useEffect(() => {
    if (!run.requested || !run.version || !run.runtime) return;
    report.current = {};
    set({ running: true, timedOut: false });
    setStage(0);
  }, [run.requested, run.version, run.runtime]);

  const finish = (r: Record<string, unknown> | null, timedOut = false) => {
    token.current++;
    const res = evaluateProbe(r);
    setStage(null);
    if (res.mode !== "failed" && state.version && state.runtime) storeSelfTest({ platform: PLATFORM, passedAt: new Date().toISOString(), appVersion: state.version, userAgent: currentUserAgent(), mode: res.mode, runtime: state.runtime });
    else clearSelfTest();
    set({ running: false, last: res, timedOut });
  };
  const onStage = (i: number, o: ProbeOutcome) => {
    const s = STAGES[i];
    if (s.nav) report.current[s.id] = navVerdict(o);
    else if (o.report && typeof o.report === "object") Object.assign(report.current, o.report as Record<string, unknown>);
    if (i + 1 < STAGES.length) setStage(i + 1); else finish(report.current);
  };
  useEffect(() => {
    if (stage === null) return;
    const id = token.current;
    const t = window.setTimeout(() => { if (token.current === id) finish(report.current, true); }, TIMEOUT_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage === null]);

  if (stage === null) return null;
  return (
    <div className="selftest-frames" aria-hidden="true">
      <ProbeFrame key={STAGES[stage].id} html={STAGES[stage].html} nav={STAGES[stage].nav} router={STUB_ROUTER} onDone={(o) => onStage(stage, o)} />
    </div>
  );
}
