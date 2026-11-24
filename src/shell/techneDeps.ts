// The shell's half of an applet's Techne (docs/design/TECHNE.md): what it holds (signed approvals on a device with the
// person's key, this device's own store without), the sheet that asks for a write the first time, and one signed
// request to the AppView through a broker of its own (an http service with NIP-98 that the applet's `services` never
// reach). The check itself is the module's (applet/modules/techne.ts).
import type { TechneDeps } from "../applet/modules/techne";
import { askOf, capRecord, capScope, isWrite, techneService, TECHNE_SERVICE_ID, WHO_AM_I, type Techne, type TechneCap } from "../applet/techne";
import { deviceTechne, type Signed } from "../applet/techneGrants";
import { approvalFor, signApproval, signsHere } from "../applet/approvalStore";
import type { Subject } from "../applet/approvals";
import { createBroker, withPasscode, type Broker, type Shell } from "../services/broker";
import { nativeNow } from "../services/native";
import { knownHubs } from "../services/hubs";

export type TechneShell = {
  techne: Techne;
  name: string;
  /** this device's grants subject for the applet (grants.ts subjectOf) */
  subject: string;
  /** the grant's key and code now, and the applet's approval subject and asks' hash (for its capabilities' approvals) */
  now: () => { grantKey: string; code: string; asks: string; approval: Subject; under: number | null } | null;
  confirm: (q: { title: string; body: string; act: string }) => Promise<"yes" | "no" | "untapped">;
  shell: () => Shell;
};

/** The signed side for this applet, on a device with the person's key; null elsewhere. */
async function signedFor(o: TechneShell): Promise<Signed | null> {
  const n = o.now();
  if (!n || !(await signsHere())) return null;
  const sub = (cap: TechneCap): Subject => ({ ...n.approval, record: capRecord(n.approval.record, cap) });
  // under the applet's own approval as this device read it; not read yet, nothing is held (it asks)
  const under = n.under;
  return {
    holds: async (cap) => under !== null && (await approvalFor(sub(cap), n.code, capScope(n.asks, cap, under)))?.run === true,
    sign: async (cap, approved) => {
      // this device's level for approving (the unlock, or the passcode first when set), asked on the shell's own sheet
      await withPasscode(o.shell(), `Let «${o.name}» ${cap === "post" ? "post" : "follow people"} as you on Techne`,
        async (passcode) => {
          if (approved && under === null) throw new Error("its approval isn't read yet: try again in a moment");
          return signApproval({ subject: sub(cap), name: o.name, approved, code: approved ? n.code : "", scope: approved ? capScope(n.asks, cap, under ?? 0) : "", passcode });
        });
    },
  };
}

/** What Settings uses to take one capability back (the applet needn't be running): the unlock alone, as any taking back
 *  (approve.rs), never the passcode. */
export async function takeBackTechne(o: Pick<TechneShell, "subject" | "name"> & { approval: Subject }, cap: TechneCap): Promise<void> {
  const signed: Signed | null = (await signsHere()) ? {
    holds: async () => false,
    sign: async (c, approved) => { await signApproval({ subject: { ...o.approval, record: capRecord(o.approval.record, c) }, name: o.name, approved, code: "", scope: "" }); },
  } : null;
  await deviceTechne().takeBack(o.subject, cap, signed);
}

export function techneDeps(o: TechneShell): TechneDeps & { close(): void } {
  const writes = o.techne.can.filter(isWrite);
  let broker: Promise<Broker | null> | null = null;
  const open = () => (broker ??= nativeNow().then((native) => native
    ? createBroker({ native, session: `t${Math.random().toString(36).slice(2)}`, applet: { name: o.name, subject: o.subject }, services: [techneService(o.techne)], hubs: knownHubs(), emit: () => {}, shell: o.shell() })
    : null));
  const send = async (http: "GET" | "POST", nsid: string, params: Record<string, string>, input: unknown) => {
    const b = await open();
    if (!b) throw new Error("Techne needs the Parachute app on a device, which holds your key");
    const q = new URLSearchParams(params).toString();
    const r = await b.fetch({ service: TECHNE_SERVICE_ID, path: `${nsid}${q ? `?${q}` : ""}`, method: http, as: "json",
      ...(http === "POST" ? { headers: { "content-type": "application/json" }, body: JSON.stringify(input ?? {}) } : {}) });
    return { status: r.status, body: r.body };
  };
  return {
    held: async () => { const n = o.now(); return n ? deviceTechne().held(o.subject, n.grantKey, writes, await signedFor(o)) : new Set(); },
    ask: (cap) => o.confirm(askOf(o.name, o.techne, cap)),
    grant: async (cap) => { const n = o.now(); if (!n) throw new Error("it isn't allowed"); await deviceTechne().grant(o.subject, n.grantKey, cap, await signedFor(o)); },
    send,
    me: async () => {
      const r = await send("GET", WHO_AM_I, {}, undefined);
      const b = (r.body ?? {}) as { did?: unknown; handle?: unknown };
      if (r.status !== 200 || typeof b.did !== "string") throw new Error(`Techne doesn't know this key (${r.status}): add it to your account, with programs allowed to sign in`);
      return { did: b.did, ...(typeof b.handle === "string" ? { handle: b.handle } : {}) };
    },
    close: () => { void broker?.then((b) => b?.close()); broker = null; },
  };
}
