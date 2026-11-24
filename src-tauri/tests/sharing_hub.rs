//! Sharing a vault with a friend against a real hub (docs/design/SHARING.md), the requests the shell signs itself: the
//! owner's key invites someone to `recipes` and lists who is in, the friend's own key accepts the link once, and the
//! owner ends it. Runs when `PARACHUTE_CORE` names a hub; a hub before sharing (core T-476) says so and the test passes,
//! unless `E2E_CORE_NEXT=1` says the hub must have it (CI's 0.9.0-pre.2 leg).
#[path = "support/hub.rs"]
mod hub;

use std::process::Command;

use hub::hub_in;
use parachute_lib::door;
use serde_json::{json, Map, Value};

fn args(v: Value) -> Map<String, Value> {
    v.as_object().unwrap().clone()
}

#[tokio::test(flavor = "multi_thread")]
async fn the_owner_invites_the_friend_accepts_with_his_key_and_the_owner_ends_it() {
    let Ok(bin) = std::env::var("PARACHUTE_CORE") else {
        eprintln!("PARACHUTE_CORE not set: skipping the real-hub sharing test");
        return;
    };
    let _ = rustls::crypto::ring::default_provider().install_default();
    let h = hub_in(bin, "sharing");
    let owner = nostr::Keys::generate();
    let linked = Command::new(&h.bin)
        .args(["auth", "link-pubkey", "--user", "owner", &owner.public_key().to_hex()])
        .env("PARACHUTE_HOME", h.home.join("home"))
        .env("PORT", h.origin.rsplit(':').next().unwrap())
        .output()
        .unwrap();
    assert!(linked.status.success(), "link-pubkey: {}", String::from_utf8_lossy(&linked.stderr));
    let origin = door::hub_origin(&h.origin).unwrap();

    let made = door::sharing_tool(&origin, &owner, "invite-to-vault", &args(json!({ "vault": "recipes", "name": "Bo", "from": "Aaron" }))).await;
    let made = match made {
        Err(e) if e.message.contains("Unknown tool") => {
            // E2E_CORE_NEXT=1: this hub must have sharing (CI's 0.9.0-pre.2 leg)
            assert!(std::env::var("E2E_CORE_NEXT").as_deref() != Ok("1"), "this core has no sharing: {}", e.message);
            eprintln!("this hub has no sharing (core before T-476): skipping");
            return;
        }
        r => r.expect("the owner's key invites"),
    };
    let url = made["url"].as_str().unwrap();
    let code = url.split('#').nth(1).unwrap();
    assert_eq!(url, format!("{}/invite#{code}", h.origin));

    // a tool the shell doesn't sign for sharing is refused before anything is sent
    assert!(door::sharing_tool(&origin, &owner, "grant-access", &args(json!({ "vault": "recipes", "pubkey": "ab".repeat(32), "role": "write" }))).await.is_err());

    let bo = nostr::Keys::generate();
    let accepted = door::accept_invite(&origin, &bo, code).await.expect("Bo's key accepts");
    assert_eq!(accepted["vault"], "recipes");
    assert_eq!(accepted["name"], "Bo");
    assert_eq!(accepted["from"], "Aaron");
    assert_eq!(door::accept_invite(&origin, &nostr::Keys::generate(), code).await.unwrap_err().code, "no_invite");

    // Bo is in, by name, as a member; and his key now lists the vault
    let listed = door::sharing_tool(&origin, &owner, "list-access", &args(json!({ "vault": "recipes" }))).await.unwrap();
    let row = listed["access"].as_array().unwrap().iter().find(|r| r["name"] == "Bo").expect("Bo is listed").clone();
    assert_eq!(row["role"], "member");
    assert_eq!(row["pubkey"], bo.public_key().to_hex());
    assert_eq!(door::list_vaults(&origin, &bo).await.unwrap().vaults, vec!["recipes".to_string()]);
    // Bo can't invite anyone
    assert_eq!(door::sharing_tool(&origin, &bo, "invite-to-vault", &args(json!({ "vault": "recipes", "name": "Mallory" }))).await.unwrap_err().code, "not_owner");

    // End: his key no longer reaches it
    let ended = door::sharing_tool(&origin, &owner, "revoke-access", &args(json!({ "vault": "recipes", "pubkey": bo.public_key().to_hex() }))).await.unwrap();
    assert_eq!(ended["revoked"], true);
    assert!(door::list_vaults(&origin, &bo).await.map(|v| v.vaults).unwrap_or_default().is_empty());
}
