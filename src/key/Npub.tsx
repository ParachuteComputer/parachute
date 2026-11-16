import { useState } from "react";

/** A public key, whole and copyable: what a person sends to a hub's owner to be let in. */
export function Npub({ npub }: { npub: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <p className="npub">
      <code>{npub}</code>
      <button type="button" className="quiet-button" onClick={() => { void navigator.clipboard?.writeText(npub).then(() => setCopied(true), () => undefined); }}>{copied ? "Copied" : "Copy"}</button>
    </p>
  );
}
