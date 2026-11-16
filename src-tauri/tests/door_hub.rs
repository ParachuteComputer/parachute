//! The key door against a real hub: parachute-core in a throwaway home on loopback, when `PARACHUTE_CORE` names it (CI
//! sets it; without it this test says so and passes). A key linked to the hub's owner gets a session that opens the
//! hub's authorize page (its consent, not its login); a key the hub doesn't know is told so.
use std::process::{Command, Stdio};
use std::time::Duration;

use parachute_lib::door;

struct Hub {
    child: std::process::Child,
    home: std::path::PathBuf,
    origin: String,
    bin: String,
}

impl Drop for Hub {
    fn drop(&mut self) {
        let _ = Command::new("kill").args(["--", &format!("-{}", self.child.id())]).status();
        let _ = self.child.kill();
        let _ = std::fs::remove_dir_all(&self.home);
    }
}

fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
}

fn hub(bin: String) -> Hub {
    let home = std::env::temp_dir().join(format!("parachute-door-{}", std::process::id()));
    std::fs::create_dir_all(&home).unwrap();
    std::fs::write(home.join("pw"), "correct horse battery staple 1").unwrap();
    let ph = home.join("home");
    let ok = Command::new(&bin)
        .args(["bootstrap", "--embedded", "--home", ph.to_str().unwrap(), "--username", "owner", "--password-file", home.join("pw").to_str().unwrap(), "--vault", "recipes", "--json"])
        .env("PARACHUTE_HOME", &ph)
        .stdout(Stdio::null())
        .status()
        .unwrap();
    assert!(ok.success(), "bootstrap");
    let (port, vport) = (free_port(), free_port());
    let origin = format!("http://127.0.0.1:{port}");
    let log = std::fs::File::create(home.join("serve.log")).unwrap();
    // embedded serve stops when its parent goes; a shell that waits on it is the parent, in its own group
    let child = Command::new("setsid")
        .args(["sh", "-c", "\"$@\"; :", "_", &bin, "serve", "--embedded", "--home", ph.to_str().unwrap(), "--listen", &format!("127.0.0.1:{port}"), "--vault-listen", &format!("127.0.0.1:{vport}")])
        .env("PARACHUTE_HOME", &ph)
        .env("PARACHUTE_HUB_ORIGIN", &origin)
        .stdout(log.try_clone().unwrap())
        .stderr(log)
        .spawn()
        .unwrap();
    let h = Hub { child, home, origin, bin };
    for _ in 0..120 {
        if std::fs::read_to_string(h.home.join("serve.log")).unwrap_or_default().contains("ready: hub") {
            return h;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    panic!("hub didn't start: {}", std::fs::read_to_string(h.home.join("serve.log")).unwrap_or_default());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_linked_key_opens_the_hubs_consent_and_an_unknown_one_is_told() {
    let Ok(bin) = std::env::var("PARACHUTE_CORE") else {
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
