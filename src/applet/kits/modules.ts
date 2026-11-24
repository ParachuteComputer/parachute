// What both React kits set: React, ReactDOM and the JSX runtime as imports, and the parts that join `parachute`.
import React from "react";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import * as JSXRuntime from "react/jsx-runtime";

/** The parts an applet can import from "parachute", beside the kit's calls (docs/WRITE-AN-APPLET.md), each with the
 *  level of the app it came in (level.ts). A new part takes the next level, and APP_LEVEL rises to it; an applet that
 *  uses a part above its record's `needs` falls back for it (src/kit/olderApp.test.ts). */
export const PART_LEVEL = {
  Button: 1, Card: 1, Days: 1, Empty: 1, Field: 1, Link: 1, Linked: 1, List: 1, Loading: 1, Note: 1, Page: 1, Problem: 1, Record: 1, Search: 1, Tabs: 1, Write: 1,
  link: 1, toast: 1, useSaved: 1, useTheme: 1, useTranscripts: 1, voiceNote: 1, when: 1,
  // Vault's (T-476, docs/VAULT.md): records as a table, and a record's fields changed where they stand
  Table: 3, Fields: 3,
  // the feel (T-476, docs/DESIGN-RULES.md): a panel from the foot of the screen
  Drawer: 4,
  // the look (T-476, docs/LOOK.md): whether nothing should move now
  still: 7, Pages: 7,
  // reading mail (T-476): a message's body, its HTML drawn safely in a shadow root of its own
  MailBody: 9,
} as const;
export type PartName = keyof typeof PART_LEVEL;
export const PART_NAMES = Object.keys(PART_LEVEL) as PartName[];

export function setModules(parts: Record<PartName, unknown>) {
  (window as unknown as { __ParachuteModules: unknown }).__ParachuteModules = Object.freeze({
    react: React, "react-dom": ReactDOM, "react-dom/client": ReactDOMClient, "react/jsx-runtime": JSXRuntime, parts: Object.freeze({ ...parts }),
  });
}
