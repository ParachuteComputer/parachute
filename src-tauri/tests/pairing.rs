//! Pairing end to end over the real Buzz pairing relay (run in-process): a stand-in sender plays the Uni app's side
//! (uni-core `pairing_source.rs`: a QR link, the offer, the code, `sas-confirm`, Buzz's identity JSON) and the app's
//! receiving side (src/pairing.rs) takes the key.
use std::sync::Arc;
use std::time::Duration;

use buzz_core::kind::KIND_PAIRING;
use buzz_core::pairing::{qr::encode_qr, AbortReason, PairingSession, PayloadType};
use buzz_ws_client::{NostrWsConnection, RelayMessage};
use nostr::nips::nip19::ToBech32;
use nostr::{Event, Keys};
use parachute_lib::pairing;
use serde_json::json;

async fn relay() -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(buzz_pair_relay::run_server(listener, Arc::new(buzz_pair_relay::Relay::new())));
    format!("ws://127.0.0.1:{port}")
}

/// The sender's half, as the Uni app runs it.
struct Sender {
    session: PairingSession,
    conn: NostrWsConnection,
}

impl Sender {
    async fn open(relay: &str) -> (Self, String) {
        let (session, qr) = PairingSession::new_source(relay.into());
        let mut conn = NostrWsConnection::connect(relay).await.unwrap();
        conn.send_raw(&json!(["REQ", "pair", {"kinds": [KIND_PAIRING], "#p": [session.pubkey().to_hex()]}])).await.unwrap();
        loop {
            if let RelayMessage::Eose { .. } = conn.next_event(Duration::from_secs(5)).await.unwrap() {
                break;
            }
        }
        (Sender { session, conn }, encode_qr(&qr))
    }
    async fn next(&mut self) -> Event {
        loop {
            if let RelayMessage::Event { event, .. } = self.conn.next_event(Duration::from_secs(10)).await.unwrap() {
                return *event;
            }
        }
    }
    async fn publish(&mut self, ev: &Event) {
        self.conn.send_raw(&json!(["EVENT", ev])).await.unwrap();
    }
    async fn offer(&mut self) -> String {
        loop {
            let ev = self.next().await;
            if let Ok(sas) = self.session.handle_offer(&ev) {
                return sas;
            }
        }
    }
    async fn send(&mut self, payload: String) {
        let confirm = self.session.confirm_sas().unwrap();
        self.publish(&confirm).await;
        let ev = self.session.send_payload(PayloadType::Custom, zeroize::Zeroizing::new(payload)).unwrap();
        self.publish(&ev).await;
    }
}

fn identity(keys: &Keys, claimed: &Keys) -> String {
    json!({ "relayUrl": "https://relay.example", "pubkey": claimed.public_key().to_hex(), "nsec": keys.secret_key().to_bech32().unwrap() }).to_string()
}

#[tokio::test(flavor = "multi_thread")]
async fn a_key_comes_over_from_the_uni_apps_side() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let relay = relay().await;
    let account = Keys::generate();
    let (mut sender, link) = Sender::open(&relay).await;
    let pending = pairing::start(&link).await.expect("the receiving side starts from the link");
    let theirs = sender.offer().await;
    assert_eq!(pending.sas(), theirs, "both devices show the same code");
    sender.send(identity(&account, &account)).await;
    let got = pending.confirm().await.expect("the key arrives");
    assert_eq!(got.public_key(), account.public_key());
    // the receiving side says it's done
    loop {
        let ev = sender.next().await;
        if sender.session.handle_complete(&ev).is_ok() {
            break;
        }
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn a_key_that_isnt_what_the_sender_claims_is_refused() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let relay = relay().await;
    let (mut sender, link) = Sender::open(&relay).await;
    let pending = pairing::start(&link).await.unwrap();
    sender.offer().await;
    sender.send(identity(&Keys::generate(), &Keys::generate())).await;
    assert!(pending.confirm().await.is_err());
}

#[tokio::test(flavor = "multi_thread")]
async fn codes_that_differ_stop_the_sender() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let relay = relay().await;
    let (mut sender, link) = Sender::open(&relay).await;
    let pending = pairing::start(&link).await.unwrap();
    sender.offer().await;
    pending.cancel(true).await;
    loop {
        let ev = sender.next().await;
        if let Ok(reason) = sender.session.handle_abort(&ev) {
            assert_eq!(reason, AbortReason::SasMismatch);
            break;
        }
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn a_link_to_an_insecure_relay_is_refused() {
    let (_session, qr) = PairingSession::new_source("ws://relay.example".into());
    assert!(pairing::start(&encode_qr(&qr)).await.is_err());
}
