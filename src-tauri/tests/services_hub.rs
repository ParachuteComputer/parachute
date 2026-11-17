//! The broker against a real hub (parachute-core in a throwaway home, when `PARACHUTE_CORE` names it; without it this
//! test says so and passes). The NIP-98 the broker builds is the format the hub takes: sent directly for the hub's own
//! account MCP it lists the person's vaults. Through the broker nothing is signed for that hub: its account paths are
//! refused outright, and any other path because the hub answers the probe as a hub. And the hub itself refuses a
//! signature the broker would make for another of its addresses.
#[path = "support/hub.rs"]
mod hub;

use nostr::Keys;
use parachute_lib::door;
use parachute_lib::services::{authorization, nip98_event, Applet, Broker, HttpReq, Role};
use serde_json::json;

#[tokio::test(flavor = "multi_thread")]
async fn the_broker_signs_nothing_for_a_real_hub() {
    let Ok(bin) = std::env::var("PARACHUTE_CORE") else {
        assert!(std::env::var("CI").is_err(), "CI must name a hub in PARACHUTE_CORE for the broker's hub test");
        eprintln!("PARACHUTE_CORE not set: skipping the broker's real-hub test");
        return;
    };
    let _ = rustls::crypto::ring::default_provider().install_default();
    let h = hub::hub_in(bin, "services");
    let keys = Keys::generate();
    hub::cli(&h, &["auth", "link-pubkey", "--user", "owner", &keys.public_key().to_hex()]);
    let http = reqwest::Client::new();
    let post = |url: url::Url, auth: String| {
        http.post(url).header("authorization", auth).header("content-type", "application/json").header("accept", "application/json, text/event-stream").body(door::LIST_VAULTS_BODY).send()
    };

    // the format: the broker's NIP-98 for POST <hub>/account/mcp, sent directly, is accepted
    let mcp = url::Url::parse(&format!("{}/account/mcp", h.origin)).unwrap();
    let ev = nip98_event(&keys, &mcp, "POST", Some(door::LIST_VAULTS_BODY.as_bytes())).unwrap();
    let res = post(mcp.clone(), authorization(&ev)).await.unwrap();
    assert_eq!(res.status(), 200);
    assert_eq!(door::vault_names(&res.text().await.unwrap()).unwrap().vaults, vec!["recipes"], "the hub took the broker's signature");

    // the hub's own last line: a signature for another of its addresses is refused at the account MCP
    let other = url::Url::parse(&format!("{}/mcp", h.origin)).unwrap();
    let lifted = nip98_event(&keys, &other, "POST", Some(door::LIST_VAULTS_BODY.as_bytes())).unwrap();
    let res = post(mcp.clone(), authorization(&lifted)).await.unwrap();
    assert_eq!(res.status(), 401, "a signature for another URL doesn't open the account");

    // through the broker: nothing is signed for that hub
    let dir = std::env::temp_dir().join(format!("parachute-svc-hub-{}", std::process::id()));
    let b = Broker::new(dir.clone()).unwrap();
    let applet = Applet { name: "Probe".into(), subject: "vault:x/probe@1".into() };
    let svc = json!({ "id": "hub", "kind": "http", "url": format!("{}/", h.origin), "auth": "nip98" });
    let relay = json!({ "id": "relay", "kind": "nostr-relay", "url": h.origin.replace("http://", "ws://"), "media": true });
    b.open(&keys, "s", &applet, &[svc, relay], &[]).expect("the device hasn't signed in to it, and the web side lists none: only the probe can tell");
    let req = |path: &str| HttpReq { method: "POST".into(), path: path.into(), body: Some(nostr::base64::Engine::encode(&nostr::base64::engine::general_purpose::STANDARD, door::LIST_VAULTS_BODY)), ..Default::default() };
    assert_eq!(b.http(&keys, &Role::Everyday, "s", "hub", &req("account/mcp")).await.unwrap_err().code, "hub_path");
    assert_eq!(b.http(&keys, &Role::Everyday, "s", "hub", &req("mcp")).await.unwrap_err().code, "hub_probe", "the hub answers its well-known as a hub");
    assert_eq!(b.media(&keys, "s", "relay", &"ab".repeat(32), "png").await.unwrap_err().code, "hub_probe");
    assert!(b.log_lines("vault:x/probe@1").is_empty(), "nothing was signed");
    // and once the device signs in to it, it is refused at open as well
    door::remember_hub(&dir, &url::Url::parse(&h.origin).unwrap()).unwrap();
    assert_eq!(b.open(&keys, "s2", &applet, &[json!({ "id": "hub", "kind": "http", "url": format!("{}/x/", h.origin), "auth": "nip98" })], &[]).unwrap_err().code, "hub_known");
    let _ = std::fs::remove_dir_all(&dir);
}
