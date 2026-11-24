// The shell's own sheets over a running applet for what it asks of this device (docs/design/KEYRING.md "Voice, files,
// links, storage"): the recorder (`voice.record`) and the file picker (`app.pick`). Both run in the shell's document,
// never the frame. The recorder opens only on the person's tap in the applet (AppletScreen's tappingIn: live user
// activation, the focus in that applet's frame) and starts recording at once, as the Uni app's microphone button does;
// the applet gets the recording only on Send. It rests at the foot of the applet's screen, never over it, so the applet
// can still be read and scrolled while it records. Beside useShellSheets (ShellSheets.tsx), which draws the approvals'.
// Every word is the app's. Nothing pulses or loops: the recorder says what it is doing in words, a running time, and
// the shape of what it has heard so far.
//
// Leaving the screen while it records never throws the recording away (T-476), however the person leaves (the top bar's
// Back, a tab on the bar, the phone's Back): the recorder's own screen going out of sight is the one place that says so.
// A screen kept running (shell/kept.tsx) only hides: the recorder stops there and waits, with Send, for the way back. A
// screen that goes (or whose frame is made again) leaves the recording in `held`, which this applet's screen shows on
// coming back: the frame that asked for it is gone, so it can't be sent, but it can be saved or let go.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { bareName, FILE_MAX, mediaType, PICK_MAX } from "../applet/files";
import type { PickedFile } from "../applet/modules/app";
import type { Recording } from "../applet/modules/voice";
import { saveFileOut } from "../shell/device";

type Asking =
  | { kind: "record"; id: number; max: number; done: (r: Recording | null) => void }
  | { kind: "pick"; id: number; accept: string[]; multiple: boolean; max: number; note?: string; done: (files: PickedFile[]) => void };
let asks = 0;

/** The recorder's format, as the Uni app picks it: WebM Opus where the webview has it (Chromium, Android). */
export function recorderMime(supported: (t: string) => boolean): string {
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"]) if (supported(t)) return t;
  return "";
}
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const canRecord = () => typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function" && typeof MediaRecorder !== "undefined";

type Phase = "starting" | "recording" | "stopped" | "failed";
/** Why a recording stopped before Send: the app went to the background (the screen locked, another app came to the
 *  front), it reached the most it may be, or the microphone went (a call took it, say). What was recorded is kept. */
type Stopped = "away" | "max" | "mic" | "left";
const STOPPED: Record<Stopped, string> = {
  away: "Stopped when Parachute went to the background.",
  max: "Stopped at the most it may be.",
  mic: "The microphone stopped.",
  // left for another screen: the recording waits here, as it was
  left: "Your recording is kept.",
};

/** What was recorded when its screen went, with no frame left to send it to: kept per applet's screen until it is saved
 *  or let go. In memory, like the recorder's own: it is for the way back, not for a restart. */
type Held = { blob: Blob; type: string; duration: number };
const held = new Map<string, Held[]>();
const NONE: Held[] = [];
const heldWatchers = new Set<() => void>();
/** Hold one for a screen, after any already held there (a second one never replaces the first); an empty one isn't worth holding. */
const hold = (key: string, h: Held) => { if (!h.blob.size) return; held.set(key, [...(held.get(key) ?? []), h]); heldWatchers.forEach((f) => f()); };
const release1 = (key: string) => { const [, ...rest] = held.get(key) ?? []; if (rest.length) held.set(key, rest); else held.delete(key); heldWatchers.forEach((f) => f()); };
const useHeld = (key: string): Held[] => useSyncExternalStore((f) => { heldWatchers.add(f); return () => { heldWatchers.delete(f); }; }, () => held.get(key) ?? NONE);
/** Test hook: what is held for a screen. */
export const heldFor = (key: string): Held[] => held.get(key) ?? NONE;
/** How long after the sheet opens Send waits: a quick second tap on the applet's button can't send a blink of sound. */
export const SEND_ARM_MS = 400;
/** The shape drawn while it records: one bar per tenth of a second, the newest at the right. */
const BARS = 48, BAR_MS = 100;

/** How loud a moment is, 0 to 1, from a frame of samples: its RMS on a gentle curve, so speech fills the bar. */
export function levelOf(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / Math.max(1, samples.length));
  return Math.min(1, Math.sqrt(rms * 4));
}

function RecorderSheet({ name, max, away: left, keep, done }: { name: string; max: number; away: boolean; keep: (h: Held) => void; done: (r: Recording | null) => void }) {
  const [phase, setPhase] = useState<Phase>(canRecord() ? "starting" : "failed");
  const [why, setWhy] = useState(canRecord() ? "" : "This device can't record here: the microphone isn't open to Parachute on it.");
  const [stopped, setStopped] = useState<Stopped | null>(null);
  const [secs, setSecs] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const rec = useRef<{ stream: MediaStream; recorder: MediaRecorder; started: number; stoppedAt: number | null; audio: AudioContext | null } | null>(null);
  const result = useRef<{ blob: Blob; type: string; duration: number } | null>(null);
  // Send pressed while it records: it sends the moment the recorder has handed over its last part
  const sendOnStop = useRef(false);
  const over = useRef(false);
  // the person answered it (Send, Cancel): what is left of it is theirs to have thrown away. Else its screen went
  const answered = useRef(false);
  const rescue = useRef(false);
  const release = () => {
    const r = rec.current;
    if (!r) return;
    try { if (r.recorder.state !== "inactive") r.recorder.stop(); } catch { /* already stopped */ }
    r.stream.getTracks().forEach((t) => t.stop());
    void r.audio?.close().catch(() => {});
  };
  const hand = async () => {
    const r = result.current;
    if (!r || over.current) return;
    over.current = true;
    answered.current = true;
    done({ bytes: await r.blob.arrayBuffer(), type: r.type, duration: Math.round(r.duration * 10) / 10 });
  };
  const stop = (reason: Stopped | null) => {
    const r = rec.current;
    if (!r || r.recorder.state === "inactive") return;
    r.stoppedAt = performance.now();
    if (reason) setStopped(reason);
    r.recorder.stop();
  };

  // it records from the moment the sheet opens: the tap that opened it was the person's, in the applet (tappingIn)
  useEffect(() => {
    if (!canRecord()) return;
    over.current = false;
    rescue.current = false;
    let live = true;
    void (async () => {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      } catch (e) {
        if (!live) return;
        setWhy((e as { name?: string })?.name === "NotAllowedError" ? "Parachute isn't allowed to use the microphone. Allow it in this device's settings, then try again." : "The microphone couldn't be opened.");
        setPhase("failed");
        return;
      }
      if (!live) { stream.getTracks().forEach((t) => t.stop()); return; }
      const mime = recorderMime((t) => MediaRecorder.isTypeSupported(t));
      let recorder: MediaRecorder;
      try { recorder = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 32000 }); } catch {
        stream.getTracks().forEach((t) => t.stop());
        setWhy("This device can't record in a format Parachute sends."); setPhase("failed"); return;
      }
      const chunks: Blob[] = [];
      const r = { stream, recorder, started: performance.now(), stoppedAt: null as number | null, audio: null as AudioContext | null };
      recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        void r.audio?.close().catch(() => {});
        const type = mediaType(recorder.mimeType || mime) ?? "audio/webm";
        const duration = Math.min(max, ((r.stoppedAt ?? performance.now()) - r.started) / 1000);
        result.current = { blob: new Blob(chunks, { type }), type, duration };
        // its screen went while it recorded: what was heard goes to `held`
        if (rescue.current) { keep(result.current); return; }
        if (over.current) return;
        setSecs(duration);
        setPhase("stopped");
        if (sendOnStop.current) void hand();
      };
      // the microphone taken away (a call, another app): stop, and keep what was heard
      for (const t of stream.getAudioTracks()) t.addEventListener("ended", () => stop("mic"));
      // the shape of what it hears: an analyser beside the recorder, on the same stream (nothing more is opened)
      try {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AC) {
          const audio = new AC();
          r.audio = audio;
          const analyser = audio.createAnalyser();
          analyser.fftSize = 1024;
          audio.createMediaStreamSource(stream).connect(analyser);
          (r as typeof r & { analyser?: AnalyserNode }).analyser = analyser;
          if (audio.state === "suspended") void audio.resume().catch(() => {});
        }
      } catch { /* no shape, only the time */ }
      rec.current = r;
      recorder.start(1000);
      setSecs(0);
      setPhase("recording");
    })();
    // the microphone is let go whenever the sheet goes (Send, Cancel, the applet's screen closing)
    return () => {
      live = false; over.current = true; release();
      // its screen went (not answered): keep what was heard, now or as the recorder hands over its last part
      if (!answered.current) { if (result.current) keep(result.current); else rescue.current = true; }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // away from the app (the screen locked, another app in front): stop and keep it, for Send or Cancel on coming back
  useEffect(() => {
    if (phase !== "recording") return;
    const away = () => { if (document.visibilityState === "hidden") stop("away"); };
    away(); // gone already while the microphone opened
    const gone = () => stop("away");
    document.addEventListener("visibilitychange", away);
    addEventListener("pagehide", gone);
    return () => { document.removeEventListener("visibilitychange", away); removeEventListener("pagehide", gone); };
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // its screen out of sight (the person went to another: Back, a tab): stop and keep it, for Send on coming back
  useEffect(() => {
    if (!left) return;
    if (phase === "recording") stop("left"); else if (phase === "stopped") setStopped("left");
  }, [left, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // the running time and the shape, a bar each tenth of a second; and the stop at the most it may be
  useEffect(() => {
    if (phase !== "recording") return;
    const r = rec.current as (typeof rec.current & { analyser?: AnalyserNode }) | null;
    const frame = r?.analyser ? new Float32Array(r.analyser.fftSize) : null;
    const t = setInterval(() => {
      if (!r) return;
      const s = (performance.now() - r.started) / 1000;
      setSecs(Math.min(max, s));
      if (r.analyser && frame) { r.analyser.getFloatTimeDomainData(frame); const l = levelOf(frame); setLevels((ls) => [...ls.slice(1 - BARS), l]); }
      if (s >= max) stop("max");
    }, BAR_MS);
    return () => clearInterval(t);
  }, [phase, max]); // eslint-disable-line react-hooks/exhaustive-deps

  const cancel = () => { over.current = true; answered.current = true; release(); done(null); };
  const [sending, setSending] = useState(false);
  const send = () => {
    setSending(true);
    // stopped already (its handler may have run a moment before this draws): hand it over now
    if (result.current) { void hand(); return; }
    sendOnStop.current = true;
    stop(null);
  };
  const [armed, setArmed] = useState(false);
  useEffect(() => { const t = setTimeout(() => setArmed(true), SEND_ARM_MS); return () => clearTimeout(t); }, []);
  const live = phase === "recording";
  return (
    // not over the applet but at the foot of its screen, beside it: what it shows (the message being answered) still
    // scrolls under a finger while it records, and the frame above is shortened so its foot stays in sight (T-476)
    <div className="recorder-dock">
      <section className="sheet device-sheet recorder" role="dialog" aria-modal="false" aria-label={`Recording for ${name}`}>
        {/* one row: what it is doing and its time, then Cancel and Send; the talk above keeps the most of the screen.
            Its name ("Recording for Rooms") is the dialog's label, not a heading that says "Recording" twice */}
        <div className="record-head">
          {phase === "starting" && <p className="quiet" role="status">Opening the microphone…</p>}
          {(phase === "recording" || phase === "stopped") && (
            <p className="record-time" role="timer" aria-label={live ? "Recording time" : "Recorded time"}>
              <strong>{live ? "Recording" : "Recorded"}</strong> {clock(secs)} <span className="quiet">of {clock(max)}</span>
            </p>
          )}
          {phase === "failed" && <p role="alert">{why}</p>}
          <div className="grant-actions">
            <button type="button" className="quiet-button" onClick={cancel}>{phase === "failed" ? "Close" : "Cancel"}</button>
            {phase !== "failed" && <button type="button" className="primary" disabled={!armed || phase === "starting" || sending} onClick={send}>Send</button>}
          </div>
        </div>
        {(phase === "recording" || phase === "stopped") && levels.length > 0 && (
          <svg className="record-shape" viewBox={`0 0 ${BARS * 3} 24`} preserveAspectRatio="none" aria-hidden="true">
            {levels.map((l, i) => { const h = Math.max(1.5, l * 24); return <rect key={i} x={(BARS - levels.length + i) * 3} y={(24 - h) / 2} width="2" height={h} rx="1" />; })}
          </svg>
        )}
        {phase === "stopped" && stopped && <p className="quiet small" role="status">{stopped === "left" ? STOPPED.left : `${STOPPED[stopped]} What was recorded is here.`}</p>}
        {phase !== "failed" && <p className="quiet small">{name} gets it only when you press Send.</p>}
      </section>
    </div>
  );
}

/** A recording whose screen went before it was sent: the applet that asked for it isn't waiting any more, so it can be
 *  kept as a file or let go, not sent. At the foot of the applet's screen, as the recorder is. */
function HeldSheet({ name, held: h, more, onGone }: { name: string; held: Held; more: number; onGone: () => void }) {
  const [saved, setSaved] = useState<string | null>(null);
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const save = () => {
    setBusy(true); setWhy("");
    const file = `Recording for ${name} ${new Date().toISOString().slice(0, 16).replace("T", " ")}.${/ogg/.test(h.type) ? "ogg" : /mp4/.test(h.type) ? "m4a" : "webm"}`;
    void h.blob.arrayBuffer().then((b) => saveFileOut(file, b, h.type)).then(setSaved, () => setWhy("It couldn't be saved. It is still kept here.")).finally(() => setBusy(false));
  };
  return (
    <div className="recorder-dock">
      <section className="sheet device-sheet recorder" role="dialog" aria-modal="false" aria-label={`Kept recording for ${name}`}>
        <div className="record-head">
          <p className="record-time" role="timer" aria-label="Recorded time"><strong>Recorded</strong> {clock(h.duration)}</p>
          <div className="grant-actions">
            {saved === null ? <>
              <button type="button" className="quiet-button" onClick={onGone}>Discard</button>
              <button type="button" className="primary" disabled={busy} onClick={save}>Save a copy</button>
            </> : <button type="button" className="primary" onClick={onGone}>Done</button>}
          </div>
        </div>
        {why && <p role="alert">{why}</p>}
        <p className="quiet small" role="status">{saved === null
          ? `Your recording is kept. ${name} had closed before you sent it, so save a copy, or discard it.${more ? ` ${more} more kept after it.` : ""}`
          : `Saved as ${saved}.`}</p>
      </section>
    </div>
  );
}

function PickSheet({ name, accept, multiple, max, note, done }: { name: string; accept: string[]; multiple: boolean; max: number; note?: string; done: (files: PickedFile[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const what = multiple ? "files" : "a file";
  const chosen = async (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    if (files.length > PICK_MAX) { setWhy(`Choose at most ${PICK_MAX} files.`); return; }
    const big = files.find((f) => f.size > max);
    if (big) { setWhy(`${big.name} is over ${Math.round(max / 1024 / 1024)} MB. Choose a smaller one.`); return; }
    setBusy(true);
    try {
      done(await Promise.all(files.map(async (f) => ({ name: bareName(f.name), type: mediaType(f.type) ?? "application/octet-stream", bytes: await f.arrayBuffer() }))));
    } catch { setBusy(false); setWhy("That file couldn't be read. Choose it again."); }
  };
  return (
    <div className="sheet-scrim sheet-over-frames" role="presentation">
      <section className="sheet device-sheet" role="dialog" aria-modal="true" aria-label={`${name} asks for ${what}`}>
        <h2>{name} asks for {what}</h2>
        <p className="quiet">{note ? `${note} At most ${Math.round(max / 1024 / 1024)} MB.` : `It gets only what you choose here${multiple ? `, up to ${PICK_MAX} files` : ""}, each at most ${Math.round(max / 1024 / 1024)} MB.`}</p>
        {why && <p role="alert">{why}</p>}
        <input ref={input} type="file" hidden data-shell-pick="" aria-label={`Choose ${what} for ${name}`} accept={accept.join(",") || undefined} multiple={multiple}
          onChange={(e) => { void chosen(e.target.files); e.target.value = ""; }} />
        <div className="grant-actions">
          <button type="button" className="quiet-button" onClick={() => done([])}>Cancel</button>
          <button type="button" className="primary" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Reading…" : multiple ? "Choose files" : "Choose a file"}</button>
        </div>
      </section>
    </div>
  );
}

/** The shell's recorder and picker for one applet's screen. `record` and `pick` are stable (the frame's router keeps
 *  them); one sheet at a time, and an open one answers "none" when the screen goes or `cancel` is called (its frame's
 *  session ended). `ui` goes last in the applet's screen: the recorder rests at its foot, the picker over the frame. */
export function useDeviceSheets(name: string, shown = true, screen: string | null = null) {
  const key = screen ?? name;
  const [asking, setAsking] = useState<Asking | null>(null);
  const keptHere = useHeld(key);
  const open = useRef<Asking | null>(null);
  useEffect(() => () => api.current?.cancel(), []);
  const api = useRef<{ record(max: number): Promise<Recording | null>; pick(accept: string[], multiple: boolean, max?: number, note?: string): Promise<PickedFile[]>; cancel(): void; leave(): void } | null>(null);
  if (!api.current) {
    // one sheet at a time. A tap on another mic or attach control while one is open changes nothing: it answers "none"
    // (no recording, no files) and the open one stays as it is
    const ask = <T,>(none: T, make: (done: (x: T) => void) => Asking) => new Promise<T>((resolve) => {
      if (open.current) { resolve(none); return; }
      const a = make((x) => { if (open.current !== a) return; open.current = null; setAsking(null); resolve(x); });
      open.current = a;
      setAsking(a);
    });
    api.current = {
      record: (max) => ask<Recording | null>(null, (done) => ({ kind: "record", id: ++asks, max, done })),
      pick: (accept, multiple, max = FILE_MAX, note?: string) => ask<PickedFile[]>([], (done) => ({ kind: "pick", id: ++asks, accept, multiple, max, ...(note ? { note } : {}), done })),
      cancel: () => { const a = open.current; if (a?.kind === "record") a.done(null); else if (a?.kind === "pick") a.done([]); },
      // its screen is out of sight but kept: an open picker closes (nothing chosen); a recorder stops and waits, for Send
      leave: () => { if (open.current?.kind === "pick") api.current?.cancel(); },
    };
  }
  const keep = (h: Held) => hold(key, h);
  const ui = asking?.kind === "record" ? <RecorderSheet key={asking.id} name={name} max={asking.max} away={!shown} keep={keep} done={asking.done} />
    : asking?.kind === "pick" ? <PickSheet key={asking.id} name={name} accept={asking.accept} multiple={asking.multiple} max={asking.max} note={asking.note} done={asking.done} />
    : keptHere.length ? <HeldSheet key={`${keptHere[0].duration}|${keptHere[0].blob.size}|${keptHere.length}`} name={name} held={keptHere[0]} more={keptHere.length - 1} onGone={() => release1(key)} /> : null;
  return { record: api.current.record, pick: api.current.pick, cancel: api.current.cancel, leave: api.current.leave, ui };
}
