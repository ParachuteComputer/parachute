//! Try a hub's key door from the command line, the way the app does (src/door.rs). Prints what the hub answered and,
//! with a `next`, what that page then answers with the session: never the key, never a cookie's value.
//!   cargo run --example key_door -- new <file>                        write a new key to <file> (0600), print its pubkey
//!   cargo run --example key_door -- try <hub> [<key file>] [<next>]   sign in (a throwaway key when no file is given)
use nostr::nips::nip19::ToBech32;
use parachute_lib::door;
use std::os::unix::fs::OpenOptionsExt;

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("new") {
        let keys = nostr::Keys::generate();
        let mut f = std::fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(&args[1]).expect("a new file");
        std::io::Write::write_all(&mut f, keys.secret_key().to_bech32().unwrap().as_bytes()).unwrap();
        println!("{}", keys.public_key().to_hex());
        return;
    }
    let hub = args.get(1).expect("hub address");
    let keys = match args.get(2).filter(|s| !s.is_empty()) {
        Some(file) => parachute_lib::key::parse_secret(&std::fs::read_to_string(file).unwrap()).expect("a secret key"),
        None => nostr::Keys::generate(),
    };
    let origin = door::hub_origin(hub).expect("a hub address");
    let next = args.get(3).map(String::as_str).unwrap_or("/");
    println!("hub {origin} key {}…", &keys.public_key().to_hex()[..12]);
    match door::sign_in(&origin, &door::next_path(&origin, next).expect("next on the hub"), &keys).await {
        Ok(s) => {
            let names: Vec<&str> = s.set_cookies.iter().map(|c| c.split('=').next().unwrap_or("")).collect();
            println!("SESSION redirect={} cookies={names:?}", s.redirect.split('?').next().unwrap_or(""));
            if args.get(3).is_some() {
                let jar: Vec<&str> = s.set_cookies.iter().map(|c| c.split(';').next().unwrap_or("")).collect();
                let http = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).build().unwrap();
                let res = http.get(origin.join(&s.redirect).unwrap()).header("cookie", jar.join("; ")).send().await.unwrap();
                let status = res.status();
                let location = res.headers().get("location").and_then(|v| v.to_str().ok()).map(|l| l.split('?').next().unwrap_or("").to_string());
                let body = res.text().await.unwrap_or_default();
                println!("NEXT status={status} location={location:?} consent_form={} login_page={}", body.contains("<form"), body.contains("name=\"password\""));
            }
        }
        Err(r) => println!("REFUSED code={} message={}", r.code, r.message),
    }
}
