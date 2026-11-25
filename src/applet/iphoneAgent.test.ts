// An iPhone's webview says "like Mac OS X" in its user agent, and an iPad's says "Macintosh" (it asks for desktop
// pages): each place that names the device must ask for the iPhone and iPad first (shell/agent.ts names the iPad), or
// the app calls itself a Mac on the approvals it signs, on Parachute Cloud's pages and in the self-test.
import { describe, expect, it } from "vitest";
import { deviceName } from "./approvalStore";
import { platformName } from "./selftest/gate";
import { cloudClientName } from "../vault/oauth";
import { deviceAgent } from "../shell/agent";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const IPAD = "Mozilla/5.0 (iPad; CPU OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
// an iPad app's webview asks for desktop pages: the same words as a Mac's, but with a touch screen
const IPAD_DESKTOP = deviceAgent(MAC, 5);
const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36";

describe("the iPhone app names itself an iPhone", () => {
  it("on the approvals it signs", () => {
    expect(deviceName(IPHONE)).toBe("iPhone");
    expect(deviceName(IPAD)).toBe("iPad");
    expect(deviceName(MAC)).toBe("Mac");
    expect(deviceName(IPAD_DESKTOP)).toBe("iPad");
    expect(deviceName(deviceAgent(MAC, 0))).toBe("Mac");
    expect(deviceName(ANDROID)).toBe("Android");
  });
  it("in the self-test, whose pass is kept per platform", () => {
    expect(platformName(IPHONE)).toBe("ios");
    expect(platformName(IPAD)).toBe("ios");
    expect(platformName(MAC)).toBe("mac");
    expect(platformName(IPAD_DESKTOP)).toBe("ios");
    expect(platformName(ANDROID)).toBe("android");
  });
  it("on Parachute Cloud's pages", () => {
    expect(cloudClientName(IPHONE)).toBe("Vault app on iPhone");
    expect(cloudClientName(MAC)).toBe("Vault app on a Mac");
    expect(cloudClientName(IPAD_DESKTOP)).toBe("Vault app on iPad");
  });
});
