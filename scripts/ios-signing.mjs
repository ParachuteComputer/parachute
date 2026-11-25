#!/usr/bin/env node
// The iPhone app's signing, made through the App Store Connect API (docs/STORES.md "iPhone"), each step only if it
// isn't there yet: the bundle id computer.parachute.app, an Apple Distribution certificate for the private key in
// <dir> (from its CSR), the App Store provisioning profile ("Parachute App Store <date>"), and the three repository secrets
// ios.yml signs with (IOS_CERTIFICATE, IOS_CERTIFICATE_PASSWORD, IOS_MOBILE_PROVISION). Then it says whether the App
// Store Connect app record exists, and with --group, makes the internal TestFlight group "Parachute testers" in it.
//
// Apple lets only an Admin key (or the Account Holder) make identifiers, certificates and profiles; a Developer key
// reads them, and this stops at the first step it may not take, saying so. Nothing secret is printed.
//   ASC_KEY_ID=… ASC_ISSUER=… ASC_KEY_P8=<AuthKey .p8> node scripts/ios-signing.mjs [--dir <folder>] [--secrets] [--group]
// <folder> (default ~/.config/uni/apple-ios) holds dist.key and dist.csr (openssl, mode 600); the certificate, the
// .p12 with its password and the profile are written beside them, mode 600. The profile is named "Parachute App Store"
// and the day it was made.
import { createPrivateKey, createPublicKey, randomBytes, sign, X509Certificate } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const BUNDLE = "computer.parachute.app";
const PROFILE = "Parachute App Store";
const GROUP = "Parachute testers";
const REPO = "ParachuteComputer/parachute";
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const dir = args.includes("--dir") ? args[args.indexOf("--dir") + 1] : join(homedir(), ".config/uni/apple-ios");
if (!dir || dir.startsWith("--")) { console.error("--dir needs a folder."); process.exit(2); }
process.umask(0o077); // every file made here (the certificate, the .p12, the profile) is the owner's alone from the start
const { ASC_KEY_ID: kid, ASC_ISSUER: iss, ASC_KEY_P8: p8 } = process.env;
if (!kid || !iss || !p8) { console.error("Set ASC_KEY_ID, ASC_ISSUER and ASC_KEY_P8 (the .p8 file's path)."); process.exit(2); }

const b64url = (b) => Buffer.from(b).toString("base64url");
function token() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "ES256", kid, typ: "JWT" }));
  const body = b64url(JSON.stringify({ iss, iat: now, exp: now + 600, aud: "appstoreconnect-v1" }));
  const sig = sign("sha256", Buffer.from(`${head}.${body}`), { key: createPrivateKey(readFileSync(p8)), dsaEncoding: "ieee-p1363" });
  return `${head}.${body}.${b64url(sig)}`;
}

class Refused extends Error {}
async function asc(method, path, body) {
  const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    method, headers: { authorization: `Bearer ${token()}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (res.status === 403) throw new Refused(`${method} ${path.split("?")[0]}: Apple says this key may not (${json.errors?.[0]?.detail ?? 403}). It needs an Admin key or the Account Holder.`);
  if (!res.ok) throw new Error(`${method} ${path.split("?")[0]}: ${res.status} ${JSON.stringify(json.errors?.map((e) => e.detail ?? e.title) ?? json)}`);
  return json;
}
const say = (s) => console.log(s);
const keep = (name, data) => { writeFileSync(join(dir, name), data, { mode: 0o600 }); return join(dir, name); };

async function main() {
  const key = createPrivateKey(readFileSync(join(dir, "dist.key")));
  const ours = createPublicKey(key).export({ type: "spki", format: "der" }).toString("base64");

  // 1. the bundle id
  let bundle = (await asc("GET", `/v1/bundleIds?filter[identifier]=${BUNDLE}&limit=5`)).data.find((b) => b.attributes.identifier === BUNDLE);
  if (bundle && !["IOS", "UNIVERSAL"].includes(bundle.attributes.platform)) throw new Error(`bundle id: ${BUNDLE} is registered for ${bundle.attributes.platform}, not iOS: change it at developer.apple.com first`);
  if (bundle) say(`bundle id: ${BUNDLE} is registered (${bundle.attributes.platform})`);
  else {
    bundle = (await asc("POST", "/v1/bundleIds", { data: { type: "bundleIds", attributes: { identifier: BUNDLE, name: "Parachute", platform: "IOS" } } })).data;
    say(`bundle id: registered ${BUNDLE}`);
  }

  // 2. the Apple Distribution certificate whose key is ours (one made from dist.csr before is used again)
  const certs = (await asc("GET", "/v1/certificates?filter[certificateType]=DISTRIBUTION&limit=200")).data;
  let cert = certs.find((c) => new X509Certificate(Buffer.from(c.attributes.certificateContent, "base64")).publicKey.export({ type: "spki", format: "der" }).toString("base64") === ours);
  if (cert) say(`certificate: ${cert.attributes.name}, until ${cert.attributes.expirationDate.slice(0, 10)}`);
  else {
    const csr = readFileSync(join(dir, "dist.csr"), "utf8").replace(/-----[^-]+-----|\s/g, "");
    cert = (await asc("POST", "/v1/certificates", { data: { type: "certificates", attributes: { certificateType: "DISTRIBUTION", csrContent: csr } } })).data;
    say(`certificate: made ${cert.attributes.name}, until ${cert.attributes.expirationDate.slice(0, 10)}`);
  }
  const der = Buffer.from(cert.attributes.certificateContent, "base64");
  keep("dist.cer", der);
  const pem = keep("dist.pem", new X509Certificate(der).toString());

  // 3. the App Store profile for this bundle id with that certificate. A new one is made under a dated name first; only
  // then do this bundle id's older App Store profiles go (another certificate, or expired): never one of another app's
  const old = (await asc("GET", `/v1/profiles?filter[profileType]=IOS_APP_STORE&include=bundleId,certificates&limit=200`)).data
    .filter((p) => p.relationships.bundleId.data?.id === bundle.id);
  let profile = old.find((p) => p.attributes.profileState === "ACTIVE" && p.relationships.certificates.data?.some((c) => c.id === cert.id));
  if (profile) say(`profile: ${profile.attributes.name}, until ${profile.attributes.expirationDate.slice(0, 10)}`);
  else {
    const name = `${PROFILE} ${new Date().toISOString().slice(0, 10)}`;
    profile = (await asc("POST", "/v1/profiles", { data: { type: "profiles", attributes: { name, profileType: "IOS_APP_STORE" },
      relationships: { bundleId: { data: { type: "bundleIds", id: bundle.id } }, certificates: { data: [{ type: "certificates", id: cert.id }] } } } })).data;
    say(`profile: made ${name}, until ${profile.attributes.expirationDate.slice(0, 10)}`);
    for (const p of old) { await asc("DELETE", `/v1/profiles/${p.id}`); say(`profile: removed the older ${p.attributes.name}`); }
  }
  const provision = keep("Parachute_App_Store.mobileprovision", Buffer.from(profile.attributes.profileContent, "base64"));

  // 4. the .p12 Tauri imports on the runner (3DES and SHA-1: the encryption every macOS keychain reads)
  const pass = existsSync(join(dir, "p12pass")) ? join(dir, "p12pass") : keep("p12pass", randomBytes(24).toString("hex"));
  const p12 = join(dir, "dist.p12");
  execFileSync("openssl", ["pkcs12", "-export", "-inkey", join(dir, "dist.key"), "-in", pem, "-name", "Parachute iOS Distribution", "-out", p12,
    "-passout", `file:${pass}`, "-certpbe", "PBE-SHA1-3DES", "-keypbe", "PBE-SHA1-3DES", "-macalg", "sha1"]);
  say(`files: ${p12}, ${provision} (and the password beside them)`);

  // 5. the repository's secrets, from the files
  if (flag("--secrets")) {
    const set = (name, value) => execFileSync("gh", ["secret", "set", name, "--repo", REPO], { input: value, stdio: ["pipe", "ignore", "inherit"] });
    set("IOS_CERTIFICATE", readFileSync(p12).toString("base64"));
    set("IOS_CERTIFICATE_PASSWORD", readFileSync(pass, "utf8").trim());
    set("IOS_MOBILE_PROVISION", readFileSync(provision).toString("base64"));
    say(`secrets: IOS_CERTIFICATE, IOS_CERTIFICATE_PASSWORD, IOS_MOBILE_PROVISION set on ${REPO}`);
  }

  // 6. the app record (only the Account Holder or an Admin makes it, in App Store Connect), and its TestFlight group
  const app = (await asc("GET", `/v1/apps?filter[bundleId]=${BUNDLE}&limit=5`)).data[0];
  if (!app) { say("app record: none for computer.parachute.app yet (App Store Connect → Apps → +: FOR-AARON)"); return; }
  say(`app record: ${app.attributes.name} (${app.id})`);
  const groups = (await asc("GET", `/v1/apps/${app.id}/betaGroups?limit=50`)).data;
  const group = groups.find((g) => g.attributes.name === GROUP);
  if (group) say(`TestFlight: the internal group ${GROUP} is there`);
  else if (flag("--group")) {
    await asc("POST", "/v1/betaGroups", { data: { type: "betaGroups", attributes: { name: GROUP, isInternalGroup: true, hasAccessToAllBuilds: true },
      relationships: { app: { data: { type: "apps", id: app.id } } } } });
    say(`TestFlight: made the internal group ${GROUP} (every build; testers are added in App Store Connect)`);
  } else say(`TestFlight: no group ${GROUP} yet (--group makes it)`);
}

main().catch((e) => { console.error(e instanceof Refused ? `stopped: ${e.message}` : e.message); process.exit(e instanceof Refused ? 3 : 1); });
