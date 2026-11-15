// The frame's bundle: built once to a script string (the `virtual:frame-kit` Vite plugin) that the shell runs in a
// sealed frame (src/shell/FrameHost.tsx). It reaches the shell only through bridge.ts.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@openparachute/surface-render/styles.css";
import "../styles.css";
import FrameRouter from "./FrameRouter";
import Frame from "./Frame";

createRoot(document.getElementById("root")!).render(<StrictMode><FrameRouter><Frame /></FrameRouter></StrictMode>);
