// React for TSX/JSX applets, bundled once to an IIFE string (the `virtual:react-kit` Vite plugin) that the app puts in
// the frame of an applet written as a module. It sets `window.__ParachuteModules`, which the module loader (code.ts)
// serves as the module's imports.
import React from "react";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import * as JSXRuntime from "react/jsx-runtime";

(window as unknown as { __ParachuteModules: unknown }).__ParachuteModules = Object.freeze({
  react: React, "react-dom": ReactDOM, "react-dom/client": ReactDOMClient, "react/jsx-runtime": JSXRuntime,
});
