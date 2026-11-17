//! Send a key the way the Uni app does, over a pairing relay run here on loopback: for driving the app's Pair screen
//! as a person would (scripts/mac-signin.sh on the Mac runner). The key is made for the run. Prints, one per line:
//! `link <nostrpair://…>` (paste it into the app), `sas <code>` once the app answers (the app shows the same), `npub
//! <npub1…>` of the key sent, then `done` when the app says it kept it.
//!   cargo run --example pair_send
#[path = "../tests/support/pair_sender.rs"]
mod pair_sender;

use std::io::Write;
use std::time::Duration;

use nostr::nips::nip19::ToBech32;
use nostr::Keys;
use pair_sender::{identity, relay, Sender};

#[tokio::main]
async fn main() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let say = |line: String| {
        println!("{line}");
        let _ = std::io::stdout().flush();
    };
    let relay = relay().await;
    let account = Keys::generate();
    let (mut sender, link) = Sender::open(&relay).await;
    sender.wait = Duration::from_secs(120);
    say(format!("link {link}"));
    say(format!("sas {}", sender.offer().await));
    sender.send(identity(&account, &account)).await;
    say(format!("npub {}", account.public_key().to_bech32().unwrap()));
    loop {
        let ev = sender.next().await;
        if sender.session.handle_complete(&ev).is_ok() {
            say("done".into());
            return;
        }
    }
}
