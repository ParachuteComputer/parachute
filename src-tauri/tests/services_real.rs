//! The native side against the real servers the first applets use, run by the Services workflow (e2e/services/README.md): our Buzz
//! relay (BUZZ_RELAY, e.g. ws://localhost:3871) and the Uni app's mail gateway (MAIL_BRIDGE). BUZZ_KEYS is a folder
//! with alice.hex: a relay member and a gateway key. Skipped when they aren't set.
use nostr::base64::engine::general_purpose::STANDARD as B64;
use nostr::base64::Engine;
use nostr::Keys;
use parachute_lib::services::{Applet, Broker, HttpReq, Role};
use serde_json::{json, Value};

fn keys() -> Option<Keys> {
    let dir = std::env::var("BUZZ_KEYS").ok()?;
    let hex = std::fs::read_to_string(format!("{dir}/alice.hex")).ok()?;
    Keys::parse(hex.trim()).ok()
}
fn broker(name: &str, keys: &Keys, services: &[Value]) -> Broker {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let d = std::env::temp_dir().join(format!("parachute-services-real-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    let b = Broker::new(d).unwrap();
    b.open(keys, "s", &Applet { name: "Real".into(), subject: "vault:home/real@1".into() }, services, &[]).unwrap();
    b
}

#[tokio::test(flavor = "multi_thread")]
async fn the_mail_gateway_takes_what_the_native_side_signs() {
    let (Some(k), Ok(bridge)) = (keys(), std::env::var("MAIL_BRIDGE")) else { eprintln!("skipped: MAIL_BRIDGE/BUZZ_KEYS unset"); return };
    let b = broker("mail", &k, &[json!({ "id": "mail", "kind": "http", "url": format!("{bridge}/mail/"), "auth": "nip98" })]);
    let mut r = HttpReq { method: "POST".into(), path: "session".into(), body: Some(B64.encode(b"{}")), ..Default::default() };
    r.headers.insert("content-type".into(), "application/json".into());
    let res = b.http(&k, &Role::Everyday, "s", "mail", &r).await.unwrap();
    let body: Value = serde_json::from_slice(&B64.decode(res.body).unwrap()).unwrap();
    assert_eq!(res.status, 200, "{body}");
    assert!(body["primaryAccounts"]["urn:ietf:params:jmap:mail"].is_string(), "{body}");
    // the same request twice: a fresh nonce each time, so the gateway's replay cache takes both
    assert_eq!(b.http(&k, &Role::Everyday, "s", "mail", &r).await.unwrap().status, 200);
}

#[tokio::test(flavor = "multi_thread")]
async fn the_relay_takes_a_file_and_gives_it_back() {
    let (Some(k), Ok(relay)) = (keys(), std::env::var("BUZZ_RELAY")) else { eprintln!("skipped: BUZZ_RELAY/BUZZ_KEYS unset"); return };
    let b = broker("relay", &k, &[json!({ "id": "rooms", "kind": "nostr-relay", "url": relay, "media": true, "publish": [9] })]);
    let png = std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/../e2e/fixtures/seedlings.png")).unwrap();
    let d = b.upload(&k, "s", "rooms", &B64.encode(&png), "image/png").await.unwrap();
    let sha = d["sha256"].as_str().unwrap().to_string();
    let got = b.media(&k, "s", "rooms", &sha, "png").await.unwrap();
    assert_eq!(B64.decode(got.body).unwrap(), png);
}
