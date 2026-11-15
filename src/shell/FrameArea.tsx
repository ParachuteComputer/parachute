// What shows on the frame's addresses: the frame this device runs now (frameSource.ts), or its card. The person's
// frame is read again each time the frame area is shown, so a change made by them or their agent is seen at the next
// return, not by polling.
import { useEffect, useState } from "react";
import { frameCode, frameFailed, readFrameRecord, useFrameSource } from "./frameSource";
import FrameHost from "./FrameHost";
import FrameCard from "./FrameCard";

type Code = { js: string; hash: string; from: "built-in" | "vault" };

export default function FrameArea() {
  const { choice } = useFrameSource();
  const [code, setCode] = useState<Code | null>(null);
  useEffect(() => { void readFrameRecord(); }, []);
  const want = choice.run === "vault" ? `vault:${choice.hash}` : "built-in";
  useEffect(() => {
    let on = true;
    void frameCode(choice).then((r) => {
      if (!on) return;
      if ("error" in r) { if (choice.run === "vault") frameFailed(choice.hash, r.error); return; }
      setCode(r);
    });
    return () => { on = false; };
  }, [want]); // eslint-disable-line react-hooks/exhaustive-deps
  if ("card" in choice) return <FrameCard {...choice.card} />;
  if (!code || (code.from === "vault" ? `vault:${code.hash}` : "built-in") !== want) return null;
  return <FrameHost key={code.hash} js={code.js} from={code.from} onFailed={(why) => { if (code.from === "vault") frameFailed(code.hash, why); }} />;
}
