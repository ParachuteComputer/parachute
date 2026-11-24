// The shell's half of an applet's Techne (docs/design/TECHNE.md): what it holds (signed approvals on a device with the
// person's key, this device's own store without), the sheet that asks for a write the first time, and one signed
// request to the AppView through a broker of its own (an http service with NIP-98 that the applet's `services` never
// reach). The check itself is the module's (applet/modules/techne.ts).
import type { TechneDeps } from "../applet/modules/techne";
import { askOf, capRecord, capScope, isWrite, techneService, TECHNE_SERVICE_ID, WHO_AM_I, type Techne, type TechneCap } from "../applet/techne";
import { deviceTechne, type Signed } from "../applet/techneGrants";
import { approvalFor, floorOf, raiseFloor, signApproval, signsHere } from "../applet/approvalStore";
import { revokeFloor, type Subject } from "../applet/approvals";
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

/** A taking back, whatever becomes of its signature: this device never takes an approval made before it again (as
 *  approvalStore.ts `takeBack` does for an applet), then the signed one tells every other device. */
async function takeBackSigned(approval: Subject, cap: TechneCap, name: string): Promise<boolean> {
  const s: Subject = { ...approval, record: capRecord(approval.record, cap) };
  raiseFloor(s, revokeFloor(Date.now(), null, floorOf(s)));
  return (await signApproval({ subject: s, name, approved: false, code: "", scope: "" })).written;
}

/** The signed side for this applet, on a device with the person's key; null elsewhere. Also null until the applet's own
 *  approval has been read here (`under`): it then runs by this device's Allow, and its capabilities are this device's. */
async function signedFor(o: TechneShell): Promise<Signed | null> {
  const n = o.now();
  if (!n || n.under === null || !(await signsHere())) return null;
  const under = n.under;
  const sub = (cap: TechneCap): Subject => ({ ...n.approval, record: capRecord(n.approval.record, cap) });
  return {
    holds: async (cap) => (await approvalFor(sub(cap), n.code, capScope(n.asks, cap, under)))?.run === true,
    sign: async (cap, approved) => {
      if (!approved) return takeBackSigned(n.approval, cap, o.name);
      // this device's level for approving (the unlock, or the passcode first when set), asked on the shell's own sheet
      const r = await withPasscode(o.shell(), `Let «${o.name}» ${cap === "post" ? "post" : "follow people"} as you on Techne`,
        (passcode) => signApproval({ subject: sub(cap), name: o.name, approved, code: n.code, scope: capScope(n.asks, cap, under), passcode }));
      return r.written;
    },
  };
}

/** What Settings uses to take one capability back (the applet needn't be running): the unlock alone, as any taking back
 *  (approve.rs), never the passcode. */
export async function takeBackTechne(o: Pick<TechneShell, "subject" | "name"> & { approval: Subject }, cap: TechneCap): Promise<void> {
  const signed: Signed | null = (await signsHere()) ? { holds: async () => false, sign: (c) => takeBackSigned(o.approval, c, o.name) } : null;
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
