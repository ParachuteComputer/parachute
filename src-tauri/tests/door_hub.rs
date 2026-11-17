//! The key door against a real hub: parachute-core in a throwaway home on loopback, when `PARACHUTE_CORE` names it (CI
//! sets it; without it this test says so and passes). A key linked to the hub's owner gets a session that opens the
//! hub's authorize page (its consent, not its login); a key the hub doesn't know is told so.
#[path = "support/hub.rs"]
mod hub;

use std::process::Command;

use hub::{cli, hub, hub_in};
use parachute_lib::door;

#[tokio::test(flavor = "multi_thread")]
async fn a_linked_key_opens_the_hubs_consent_and_an_unknown_one_is_told() {
    let Ok(bin) = std::env::var("PARACHUTE_CORE") else {
        assert!(std::env::var("CI").is_err(), "CI must name a hub in PARACHUTE_CORE for the key door test");
        eprintln!("PARACHUTE_CORE not set: skipping the real-hub key door test");
        return;
    };
    let _ = rustls::crypto::ring::default_provider().install_default();
    let h = hub(bin);
    let keys = nostr::Keys::generate();
    let linked = Command::new(&h.bin)
        .args(["auth", "link-pubkey", "--user", "owner", &keys.public_key().to_hex()])
        .env("PARACHUTE_HOME", h.home.join("home"))
        .env("PORT", h.origin.rsplit(':').next().unwrap())
        .output()
        .unwrap();
    assert!(linked.status.success(), "link-pubkey: {}", String::from_utf8_lossy(&linked.stderr));

    let origin = door::hub_origin(&h.origin).unwrap();
    // the app's own registration and authorize address, as src/vault/oauth.ts builds them
    let http = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).build().unwrap();
    let redirect = "http://127.0.0.1:47219/oauth/callback";
    let reg: serde_json::Value = http
        .post(format!("{}/oauth/register", h.origin))
        .json(&serde_json::json!({ "client_name": "Parachute", "redirect_uris": [redirect], "grant_types": ["authorization_code", "refresh_token"], "response_types": ["code"], "token_endpoint_auth_method": "none" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let client = reg["client_id"].as_str().unwrap();
    let authorize = format!("{}/oauth/authorize?response_type=code&client_id={client}&redirect_uri={}&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256&state=s&scope=vault%3Arecipes%3Aread%20vault%3Arecipes%3Awrite&vault=recipes", h.origin, "http%3A%2F%2F127.0.0.1%3A47219%2Foauth%2Fcallback");

    let session = door::sign_in(&origin, &door::next_path(&origin, &authorize).unwrap(), &keys).await.expect("a linked key signs in");
    assert!(session.redirect.starts_with("/oauth/authorize?"), "back to the authorize page: {}", session.redirect);
    let jar: Vec<&str> = session.set_cookies.iter().map(|c| c.split(';').next().unwrap()).collect();
    let page = http.get(format!("{}{}", h.origin, session.redirect)).header("cookie", jar.join("; ")).send().await.unwrap();
    assert_eq!(page.status(), 200);
    let body = page.text().await.unwrap();
    assert!(body.contains("<form") && !body.contains("name=\"password\""), "the hub's consent, not its login");
    // without the session the same page is the hub's login
    let anon = http.get(&authorize).send().await.unwrap();
    assert!(anon.status().is_redirection() || anon.text().await.unwrap().contains("password"));

    let stranger = door::sign_in(&origin, "/", &nostr::Keys::generate()).await.unwrap_err();
    assert_eq!(stranger.code, "unknown_key");
}

/// A hub that answers its door with `status` and `body`, once per connection.
async fn answering(status: &'static str, body: &'static str) -> String {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        while let Ok((mut sock, _)) = listener.accept().await {
            let mut buf = [0u8; 4096];
            let _ = sock.read(&mut buf).await;
            let reply = format!("HTTP/1.1 {status}\r\ncontent-type: text/html\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}", body.len());
            let _ = sock.write_all(reply.as_bytes()).await;
        }
    });
    format!("http://127.0.0.1:{port}")
}

#[tokio::test(flavor = "multi_thread")]
async fn a_hub_without_the_door_and_a_hub_in_trouble_are_told_apart() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let keys = nostr::Keys::generate();
    // Cloud answers the door's address with its web page; an older hub with 404: no door, sign in another way
    for (status, body) in [("200 OK", "<!doctype html><title>app</title>"), ("200 OK", "{\"error\":\"not found\"}"), ("404 Not Found", "not found"), ("302 Found", ""), ("403 Forbidden", "behind a login")] {
        let o = door::hub_origin(&answering(status, body).await).unwrap();
        assert_eq!(door::sign_in(&o, "/", &keys).await.unwrap_err().code, "no_door", "{status}");
    }
    // a hub that is restarting is not a hub without the door
    let o = door::hub_origin(&answering("503 Service Unavailable", "busy").await).unwrap();
    assert_eq!(door::sign_in(&o, "/", &keys).await.unwrap_err().code, "unreachable");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_key_is_told_its_own_vaults_and_no_others() {
    let Ok(bin) = std::env::var("PARACHUTE_CORE") else {
        assert!(std::env::var("CI").is_err(), "CI must name a hub in PARACHUTE_CORE for the list test");
        eprintln!("PARACHUTE_CORE not set: skipping the real-hub list test");
        return;
    };
    let _ = rustls::crypto::ring::default_provider().install_default();
    let h = hub_in(bin, "list");
    for v in ["work", "family"] {
        cli(&h, &["vault", "create", v, "--json", "--no-mirror"]);
    }
    let origin = door::hub_origin(&h.origin).unwrap();
    // the hub's owner (its admin): every vault
    let owner = nostr::Keys::generate();
    cli(&h, &["auth", "link-pubkey", "--user", "owner", &owner.public_key().to_hex()]);
    let theirs = door::list_vaults(&origin, &owner).await.unwrap();
    assert_eq!(theirs.vaults, vec!["family", "recipes", "work"]);
    assert!(theirs.all, "the owner runs the hub: every vault, said so");
    // a member given one vault by their key: that one only
    let member = nostr::Keys::generate();
    let token: serde_json::Value = serde_json::from_slice(&cli(&h, &["auth", "mint-token", "--scope", "account:vaults", "--json"]).stdout).unwrap();
    let granted = reqwest::Client::new()
        .post(format!("{}/account/mcp", h.origin))
        .bearer_auth(token["token"].as_str().unwrap())
        .header("accept", "application/json, text/event-stream")
        .json(&serde_json::json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": "grant-access", "arguments": { "pubkey": member.public_key().to_hex(), "vault": "work", "role": "write" } } }))
        .send()
        .await
        .unwrap();
    assert_eq!(granted.status(), 200);
    let given = door::list_vaults(&origin, &member).await.unwrap();
    assert_eq!(given.vaults, vec!["work"]);
    assert!(!given.all, "a member: the vaults given to them");
    // asking twice in the same second is two requests, not a replay
    assert_eq!(door::list_vaults(&origin, &member).await.unwrap().vaults, vec!["work"]);
    // a key the hub doesn't know is told so
    assert_eq!(door::list_vaults(&origin, &nostr::Keys::generate()).await.unwrap_err().code, "unknown_key");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_hub_that_lists_no_vaults_for_a_key_says_so() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let keys = nostr::Keys::generate();
    for status in ["404 Not Found", "405 Method Not Allowed", "406 Not Acceptable"] {
        let o = door::hub_origin(&answering(status, "no").await).unwrap();
        assert_eq!(door::list_vaults(&o, &keys).await.unwrap_err().code, "no_list", "{status}");
    }
    let o = door::hub_origin(&answering("503 Service Unavailable", "busy").await).unwrap();
    assert_eq!(door::list_vaults(&o, &keys).await.unwrap_err().code, "unreachable");
}
