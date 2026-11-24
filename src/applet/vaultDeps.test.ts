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

describe("attach", () => {
  // the hub types storage by the file's name (core attachment/policy.ts): .m4a and .mp3 are sounds, .mp4 a video
  it.each([["audio/mp4", "voice.m4a"], ["audio/mpeg", "voice.mp3"], ["audio/webm;codecs=opus", "voice.webm"], ["audio/ogg", "voice.ogg"], ["image/png", "file.png"]])("names a %s upload %s", async (type, name) => {
    const names: string[] = [];
    // the upload goes over XMLHttpRequest (for its progress): the client's two calls, as the hub answers them
    const c = { uploadStorageFile: async (f: File) => { names.push(f.name); return { path: `2026-11-23/1-${f.name}` }; },
      addAttachment: async (_id: string, a: { path: string; mimeType: string }) => ({ id: "a1", ...a }) } as unknown as VaultClient;
    await vaultDeps(c).attach!("r1", new Uint8Array([1, 2, 3, 4]).buffer, type, false);
    expect(names).toEqual([name]);
  });
});
