// @vitest-environment node
// What applets saved on the phone (drafts), the sign-ins and the passcode's hash are this device's own, "never synced"
// (shell/saved.ts). Found in review (T-476): Android's defaults put the whole data folder into the Google backup and
// into a device-to-device transfer. The manifest in src-tauri/gen/android is kept by hand, so this says it stays off.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const main = new URL("../../src-tauri/gen/android/app/src/main/", import.meta.url);
const manifest = readFileSync(new URL("AndroidManifest.xml", main), "utf8");

describe("Android backup", () => {
  it("is off for the app, in the cloud and to a new phone", () => {
    const app = /<application\b[^>]*>/.exec(manifest)?.[0] ?? "";
    expect(app).toContain('android:allowBackup="false"');
    expect(app).toContain('android:fullBackupContent="false"');
    const rules = /android:dataExtractionRules="@xml\/([a-z_]+)"/.exec(app)?.[1];
    expect(rules).toBeTruthy();
    const xml = readFileSync(new URL(`res/xml/${rules}.xml`, main), "utf8");
    for (const part of ["cloud-backup", "device-transfer"]) {
      const body = new RegExp(`<${part}>([\\s\\S]*?)</${part}>`).exec(xml)?.[1] ?? "";
      expect(body).not.toContain("<include");
      for (const domain of ["root", "file", "database", "sharedpref", "external"]) expect(body).toContain(`<exclude domain="${domain}" path="." />`);
    }
  });
});
