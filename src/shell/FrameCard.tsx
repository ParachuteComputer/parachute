// The frame's card: shown in place of the frame when the home vault holds a frame of its own (or its code changed) and
// this device hasn't allowed that code. Every sentence is the app's. Nothing of the record runs until Use it, and only a
// real tap counts.
import { useState, type MouseEvent } from "react";
import { Bar } from "../ui/Bar";
import { fingerprint } from "../applet/grant";
import { APPROVED_CODE_LINE } from "../applet/GrantCard";
import { useGate } from "../applet/selftest/run";
import { allowFrame, declineFrame } from "./frameSource";

export const FRAME_LINES = [
  "Show your vaults and their notes: it can read every vault this device holds",
  "Keep which applet opens which kind of note, when you choose",
  "Send you to an applet (the applet still asks for itself)",
  "Ask to open an address outside the app when you tap a link (the app shows you the whole address first)",
];

export default function FrameCard({ vault, noteId, path, hash, changed }: { vault: string; noteId: string; path: string; hash: string; changed: "code" | "mode" | null }) {
  const mode = useGate();
  const [error, setError] = useState<string | null>(null);
  const tap = (f: () => void) => (e: MouseEvent) => { if (e.isTrusted) f(); };
  const short = hash.replace(/^[a-z]+:/, "");
  return (
    <main className="screen">
      <Bar title="Your frame" />
      <section className="card grant-card" role="region" aria-label="Your home vault's frame asks to run">
        <header className="grant-head"><span className="grant-glyph" aria-hidden="true">◠</span><h2>{changed ? "Your frame changed" : "Your home vault has its own frame"}</h2></header>
        {changed === "code" && <p className="grant-changed" role="status"><strong>Its code changed since you allowed it. Only the version you allow runs.</strong></p>}
        {changed === "mode" && <p className="grant-changed" role="status"><strong>You allowed it when frames here were sealed. This device now runs approved code only, so it asks again.</strong></p>}
        <p>The note <q data-untrusted="true">{path}</q> in the <strong>{vault}</strong> vault is a frame: the screens around your notes. In place of the built-in one it would:</p>
        <ul className="grant-lines">{FRAME_LINES.map((l) => <li key={l}>{l}</li>)}</ul>
        <p className="grant-rest">{mode === "approved-code"
          ? <><strong>{APPROVED_CODE_LINE}</strong> It never holds your sign-ins and can't allow an applet.</>
          : <><strong>Nothing else.</strong> It never holds your sign-ins, can't allow an applet, and can't reach the internet.</>}</p>
        <p className="grant-meta quiet">Code <code>{fingerprint(short)}</code></p>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="grant-actions">
          <button type="button" className="quiet-button" onClick={tap(() => declineFrame(vault, noteId, hash))}>Use the built-in frame</button>
          <button type="button" className="primary" onClick={tap(() => { void allowFrame(vault, noteId, hash).then((r) => { if (!r.ok) setError(r.error); }); })}>{changed ? "Use this version" : "Use it"}</button>
        </div>
      </section>
    </main>
  );
}
