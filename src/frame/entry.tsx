// The frame's runtime: built once to a script string (the `virtual:frame-kit` Vite plugin). It carries React,
// react-router and the frame's parts ("@parachute/frame", lib.ts), and mounts the frame's code: a module whose default
// export is the frame. That code is the built-in default-frame.tsx or a record in the home vault, transpiled by the
// shell; the loader (src/shell/frameDoc.ts) runs it with only these imports and calls `mount`. It reaches the shell
// only through bridge.ts.
import React, { StrictMode, type ComponentType } from "react";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import * as JSXRuntime from "react/jsx-runtime";
import * as ReactRouter from "react-router";
import "@openparachute/surface-render/styles.css";
import "@openparachute/surface-render/rich-notes-kit.css";
import "../styles.css";
import FrameRouter from "./FrameRouter";
import * as lib from "./lib";
import { on } from "./bridge";

// the look changed (the person's theme record, or light/dark): every token is a CSS variable on <html>
on("theme", (t) => {
  const s = document.documentElement.style;
  for (const [k, v] of Object.entries(t ?? {})) if (/^[a-z]+$/.test(k) && k !== "scheme" && k !== "density" && typeof v === "string") s.setProperty(`--${k}`, v);
  if (t?.scheme === "light" || t?.scheme === "dark") s.setProperty("color-scheme", t.scheme);
});

function mount(Frame: ComponentType) {
  ReactDOMClient.createRoot(document.getElementById("root")!).render(<StrictMode><FrameRouter><Frame /></FrameRouter></StrictMode>);
}

(window as unknown as { __ParachuteFrame: unknown }).__ParachuteFrame = Object.freeze({
  modules: Object.freeze({ react: React, "react-dom": ReactDOM, "react-dom/client": ReactDOMClient, "react/jsx-runtime": JSXRuntime, "react-router": ReactRouter, "@parachute/frame": lib }),
  mount,
});
