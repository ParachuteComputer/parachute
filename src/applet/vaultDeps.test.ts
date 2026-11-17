// The asks the vault module's deps make, on surface-client's real VaultClient: what goes over the wire.
import { describe, expect, it } from "vitest";
import { VaultClient } from "@openparachute/surface-client";
import { vaultDeps } from "./vaultDeps";

describe("fields on a list", () => {
  it("asks for that folder, with fields, newest first, within the limit", async () => {
    const asked: string[] = [];
    const c = new VaultClient({ vaultUrl: "https://hub.example/vault/techne", accessToken: "t",
      fetchImpl: (async (u: string | URL | Request) => { asked.push(String(u)); return new Response("[]", { headers: { "content-type": "application/json" } }); }) as typeof fetch });
    await vaultDeps(c).listFields!("Events/", 50);
    const q = new URL(asked[0]).searchParams;
    expect(q.get("path_prefix")).toBe("Events/");
    expect(q.get("include_metadata")).toBe("true");
    expect(q.get("limit")).toBe("50");
    expect(q.get("include_content")).not.toBe("true");
  });
});
