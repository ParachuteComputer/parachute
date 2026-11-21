// An invite link, as the hub makes it (core share-invites.ts): `<hub>/invite#<code>`. The app takes the hub and the code
// from it and nothing else; anything else isn't an invite.
import { describe, expect, it } from "vitest";
import { parseInviteLink } from "./sharing";

const code = "A".repeat(43);
describe("an invite link", () => {
  it("gives the hub and the code", () => {
    expect(parseInviteLink(`https://hub.example/invite#${code}`)).toEqual({ hub: "https://hub.example", code });
    expect(parseInviteLink(`  https://hub.example:8443/invite/#${code}\n`)).toEqual({ hub: "https://hub.example:8443", code });
    expect(parseInviteLink(`http://127.0.0.1:1939/invite#${code}`)).toEqual({ hub: "http://127.0.0.1:1939", code });
  });
  it("refuses another path, plain http off this machine, a short or odd code, or no link at all", () => {
    for (const bad of [`https://hub.example/account/setup#${code}`, `http://hub.example/invite#${code}`, "https://hub.example/invite#short",
      `https://hub.example/invite#${code}/x`, `https://hub.example/invite?code=${code}`, `javascript:alert(1)//invite#${code}`, "Bo", ""]) {
      expect(parseInviteLink(bad), bad).toBeNull();
    }
  });
});
