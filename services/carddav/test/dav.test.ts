// The DAV plumbing that is logic on its own: the XML DAVx5 sends, and the devices file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CARDDAV, DAV, child, children, parseXml } from "../src/xml.ts";
import { addDevice, deviceChecker, revokeDevice } from "../src/devices.ts";
import { DAVX5 } from "./davx5.ts";

test("the XML DAVx5 sends parses into names and namespaces", () => {
  const p = parseXml(DAVX5.findPrincipal);
  assert.equal(p.ns, DAV);
  assert.equal(p.name, "propfind");
  assert.deepEqual(child(p, DAV, "prop")!.children.map((c) => `${c.ns} ${c.name}`), [
    "DAV: resourcetype", "DAV: displayname", "DAV: current-user-principal", `${CARDDAV} addressbook-home-set`, `${CARDDAV} addressbook-description`]);
  const m = parseXml(DAVX5.multiget(["/dav/addressbooks/people/a.vcf", "/dav/addressbooks/people/b%20c.vcf"]));
  assert.equal(m.name, "addressbook-multiget");
  assert.deepEqual(children(m, DAV, "href").map((h) => h.text), ["/dav/addressbooks/people/a.vcf", "/dav/addressbooks/people/b%20c.vcf"]);
  const ad = child(child(m, DAV, "prop"), CARDDAV, "address-data")!;
  assert.equal(ad.attrs["content-type"], "text/vcard");
  // prefixes, comments, CDATA and entities
  const x = parseXml(`<?xml version="1.0"?><!-- hi --><D:a xmlns:D="DAV:"><D:b>x &amp; <![CDATA[<y>]]></D:b><c xmlns="urn:z"/></D:a>`);
  assert.equal(child(x, DAV, "b")!.text, "x & <y>");
  assert.equal(child(x, "urn:z", "c")!.name, "c");
  assert.throws(() => parseXml("<a><b></a"));
  assert.throws(() => parseXml("<x:a/>"));
});

test("devices: a password works once added, a wrong one never, and not after revoke; only the hash is kept", () => {
  const dir = mkdtempSync(join(tmpdir(), "carddav-devices-"));
  try {
    const file = join(dir, "devices");
    const pw = addDevice(file, "pixel");
    assert.ok(pw.length >= 24);
    const held = readFileSync(file, "utf8");
    assert.match(held, /^pixel:scrypt\$16384\$8\$1\$/);
    assert.doesNotMatch(held, new RegExp(pw.replace(/[-]/g, "\\-")));
    const check = deviceChecker(file);
    const basic = (u: string, p: string) => `Basic ${Buffer.from(`${u}:${p}`).toString("base64")}`;
    assert.equal(check(basic("pixel", pw)), "pixel");
    assert.equal(check(basic("pixel", pw)), "pixel"); // remembered
    assert.equal(check(basic("pixel", `${pw}x`)), null);
    assert.equal(check(basic("other", pw)), null);
    assert.equal(check(undefined), null);
    assert.equal(check("Bearer x"), null);
    assert.throws(() => addDevice(file, "bad name"));
    assert.equal(revokeDevice(file, "pixel"), true);
    assert.equal(check(basic("pixel", pw)), null);
    assert.equal(revokeDevice(file, "pixel"), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
