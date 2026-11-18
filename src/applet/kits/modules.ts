// What both React kits set: React, ReactDOM and the JSX runtime as imports, and the parts that join `parachute`.
import React from "react";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import * as JSXRuntime from "react/jsx-runtime";

/** The parts an applet can import from "parachute", beside the kit's calls (docs/WRITE-AN-APPLET.md). */
export const PART_NAMES = ["Card", "Days", "Empty", "Field", "Link", "Linked", "List", "Note", "link", "useTheme"] as const;

export function setModules(parts: Record<(typeof PART_NAMES)[number], unknown>) {
  (window as unknown as { __ParachuteModules: unknown }).__ParachuteModules = Object.freeze({
    react: React, "react-dom": ReactDOM, "react-dom/client": ReactDOMClient, "react/jsx-runtime": JSXRuntime, parts: Object.freeze({ ...parts }),
  });
}
