// An iPhone's webview says "like Mac OS X" in its user agent: each place that names the device must ask for the iPhone
// first, or the iPhone app calls itself a Mac (on the approvals it signs, on Parachute Cloud's pages, in the self-test).
import { describe, expect, it } from "vitest";
import { deviceName } from "./approvalStore";
import { platformName } from "./selftest/gate";
import { cloudClientName } from "../vault/oauth";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const IPAD = "Mozilla/5.0 (iPad; CPU OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36";

describe("the iPhone app names itself an iPhone", () => {
  it("on the approvals it signs", () => {
    expect(deviceName(IPHONE)).toBe("iPhone");
    expect(deviceName(IPAD)).toBe("iPad");
    expect(deviceName(MAC)).toBe("Mac");
    expect(deviceName(ANDROID)).toBe("Android");
  });
  it("in the self-test, whose pass is kept per platform", () => {
    expect(platformName(IPHONE)).toBe("ios");
    expect(platformName(IPAD)).toBe("ios");
    expect(platformName(MAC)).toBe("mac");
    expect(platformName(ANDROID)).toBe("android");
  });
  it("on Parachute Cloud's pages", () => {
    expect(cloudClientName(IPHONE)).toBe("Vault app on iPhone");
    expect(cloudClientName(MAC)).toBe("Vault app on a Mac");
  });
});
