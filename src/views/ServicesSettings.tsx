// Settings → Your servers: the servers the person's settings note lists (homeSettings.ts `services`: their relay, their
// mail gateway), each with the applets on this device that reach it. What an applet may do there is on its card.
import { useSettings } from "../shell/homeSettings";
import { appletsNow } from "../applet/useApplets";
import { hostWords, originOf } from "../applet/services";
import { useVaults } from "../vault/hooks";

export default function ServicesSettings() {
  const { settings } = useSettings();
  const vaults = useVaults();
  if (!settings.services.length) return null;
  const reaching = (url: string, kind: "nostr-relay" | "http") => {
    const origin = originOf({ kind, url });
    return vaults.flatMap((v) => { const a = appletsNow(v.key); return a?.state === "ok" ? a.found.entries.filter((e) => e.services.some((s) => originOf(s) === origin)).map((e) => e.manifest.name) : []; });
  };
  return <section className="card" aria-labelledby="s-services">
    <h3 id="s-services">Your servers</h3>
    <ul className="plain">{settings.services.map((s) => {
      const names = [...new Set(reaching(s.url, s.kind))];
      return <li key={`${s.kind}:${s.url}`} className="line">
        <span><strong>{s.name}</strong> <span className="quiet">{s.kind === "nostr-relay" ? "relay" : "server"} at {hostWords({ kind: s.kind, url: s.url })}{names.length ? ` · reached by ${names.join(", ")}` : " · no applet here reaches it yet"}</span></span>
      </li>;
    })}</ul>
  </section>;
}
