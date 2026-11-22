// The shell's own sheets over a running applet for what it asks of this device (docs/design/KEYRING.md "Voice, files,
// links, storage"): the recorder (`voice.record`) and the file picker (`app.pick`). Both run in the shell's document,
// never the frame: the microphone opens only when the person presses Record, and the applet gets the recording only
// on Send, or only the files the person chose. Beside useShellSheets (ShellSheets.tsx), which draws the approvals'.
// Every word is the app's. Nothing pulses or loops: the recorder says what it is doing in words and a running time.
import { useEffect, useRef, useState } from "react";
import { ContractError, ERROR_CODES } from "../applet/contract";
import { bareName, FILE_MAX, mediaType, PICK_MAX } from "../applet/files";
import type { PickedFile } from "../applet/modules/app";
import type { Recording } from "../applet/modules/voice";

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

type Phase = "ready" | "starting" | "recording" | "stopped" | "failed";

function RecorderSheet({ name, max, done }: { name: string; max: number; done: (r: Recording | null) => void }) {
  const [phase, setPhase] = useState<Phase>(canRecord() ? "ready" : "failed");
  const [why, setWhy] = useState(canRecord() ? "" : "This device can't record here: the microphone isn't open to Parachute on it.");
  const [secs, setSecs] = useState(0);
  const rec = useRef<{ stream: MediaStream; recorder: MediaRecorder; started: number; stoppedAt: number | null } | null>(null);
  const result = useRef<{ blob: Blob; type: string; duration: number } | null>(null);
  const over = useRef(false);
  const release = () => {
    const r = rec.current;
    if (!r) return;
    try { if (r.recorder.state !== "inactive") r.recorder.stop(); } catch { /* already stopped */ }
    r.stream.getTracks().forEach((t) => t.stop());
  };
  // the microphone is let go whenever the sheet goes (Send, Cancel, the applet's screen closing)
  useEffect(() => () => { over.current = true; release(); }, []);

  const start = async () => {
    setPhase("starting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      if (over.current) return;
      setWhy((e as { name?: string })?.name === "NotAllowedError" ? "Parachute isn't allowed to use the microphone. Allow it in this device's settings, then try again." : "The microphone couldn't be opened.");
      setPhase("failed");
      return;
    }
    if (over.current) { stream.getTracks().forEach((t) => t.stop()); return; }
    const mime = recorderMime((t) => MediaRecorder.isTypeSupported(t));
    let recorder: MediaRecorder;
    try { recorder = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 32000 }); } catch {
      stream.getTracks().forEach((t) => t.stop());
      setWhy("This device can't record in a format Parachute sends."); setPhase("failed"); return;
    }
    const chunks: Blob[] = [];
    const r = { stream, recorder, started: performance.now(), stoppedAt: null as number | null };
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const type = mediaType(recorder.mimeType || mime) ?? "audio/webm";
      const duration = Math.min(max, ((r.stoppedAt ?? performance.now()) - r.started) / 1000);
      result.current = { blob: new Blob(chunks, { type }), type, duration };
      if (!over.current) setPhase("stopped");
    };
    rec.current = r;
    recorder.start(1000);
    setSecs(0);
    setPhase("recording");
  };
  const stop = () => {
    const r = rec.current;
    if (!r || r.recorder.state === "inactive") return;
    r.stoppedAt = performance.now();
    r.recorder.stop();
  };
  // the running time, and the stop at the most it may be
  useEffect(() => {
    if (phase !== "recording") return;
    const t = setInterval(() => {
      const r = rec.current;
      if (!r) return;
      const s = (performance.now() - r.started) / 1000;
      setSecs(Math.min(max, s));
      if (s >= max) stop();
    }, 250);
    return () => clearInterval(t);
  }, [phase, max]); // eslint-disable-line react-hooks/exhaustive-deps
  const cancel = () => { over.current = true; release(); done(null); };
  const send = async () => {
    const r = result.current;
    if (!r) return;
    over.current = true;
    done({ bytes: await r.blob.arrayBuffer(), type: r.type, duration: Math.round(r.duration * 10) / 10 });
  };
  const recorded = result.current ? result.current.duration : secs;
  // Record, Stop and Send sit in one place: each waits a moment after the one before, so taps in a row can't run
  // through all three
  const [armed, setArmed] = useState(false);
  useEffect(() => { setArmed(false); const t = setTimeout(() => setArmed(true), 600); return () => clearTimeout(t); }, [phase]);
  return (
    <div className="sheet-scrim sheet-over-frames" role="presentation">
      <section className="sheet device-sheet" role="dialog" aria-modal="true" aria-label={`${name} asks for a recording`}>
        <h2>{name} asks for a recording</h2>
        {phase === "ready" && <p className="quiet">Nothing is recorded until you press Record. {name} gets the recording only when you press Send.</p>}
        {phase === "starting" && <p className="quiet">Opening the microphone…</p>}
        {(phase === "recording" || phase === "stopped") && (
          <p className="record-time" role="timer" aria-label={phase === "recording" ? "Recording time" : "Recorded time"}>
            <strong>{phase === "recording" ? "Recording" : "Recorded"}</strong> {clock(recorded)} <span className="quiet">of {clock(max)}</span>
          </p>
        )}
        {phase === "stopped" && <p className="quiet">Send gives it to {name}. Cancel throws it away.</p>}
        {phase === "failed" && <p role="alert">{why}</p>}
        <div className="grant-actions">
          <button type="button" className="quiet-button" onClick={cancel}>{phase === "failed" ? "Close" : "Cancel"}</button>
          {phase === "ready" && <button type="button" className="primary" disabled={!armed} onClick={() => void start()}>Record</button>}
          {phase === "recording" && <button type="button" className="primary" disabled={!armed} onClick={stop}>Stop</button>}
          {phase === "stopped" && <button type="button" className="primary" disabled={!armed} onClick={() => void send()}>Send</button>}
        </div>
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
 *  session ended). `ui` goes over the frame. */
export function useDeviceSheets(name: string) {
  const [asking, setAsking] = useState<Asking | null>(null);
  const open = useRef<Asking | null>(null);
  useEffect(() => () => api.current?.cancel(), []);
  const api = useRef<{ record(max: number): Promise<Recording | null>; pick(accept: string[], multiple: boolean, max?: number, note?: string): Promise<PickedFile[]>; cancel(): void } | null>(null);
  if (!api.current) {
    const ask = <T,>(make: (done: (x: T) => void) => Asking) => new Promise<T>((resolve, reject) => {
      if (open.current) { reject(new ContractError(ERROR_CODES.failed, "the app is already asking you something")); return; }
      const a = make((x) => { if (open.current !== a) return; open.current = null; setAsking(null); resolve(x); });
      open.current = a;
      setAsking(a);
    });
    api.current = {
      record: (max) => ask<Recording | null>((done) => ({ kind: "record", id: ++asks, max, done })),
      pick: (accept, multiple, max = FILE_MAX, note?: string) => ask<PickedFile[]>((done) => ({ kind: "pick", id: ++asks, accept, multiple, max, ...(note ? { note } : {}), done })),
      cancel: () => { const a = open.current; if (a?.kind === "record") a.done(null); else if (a?.kind === "pick") a.done([]); },
    };
  }
  const ui = asking?.kind === "record" ? <RecorderSheet key={asking.id} name={name} max={asking.max} done={asking.done} />
    : asking?.kind === "pick" ? <PickSheet key={asking.id} name={name} accept={asking.accept} multiple={asking.multiple} max={asking.max} note={asking.note} done={asking.done} /> : null;
  return { record: api.current.record, pick: api.current.pick, cancel: api.current.cancel, ui };
}
