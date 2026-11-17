//! The sending side of a pairing, as the Uni app runs it (uni-core `pairing_source.rs`), and a Buzz pairing relay run
//! in-process. Used by the pairing tests (tests/pairing.rs) and by `examples/pair_send.rs`, which plays the Uni app
//! against the real app on the Mac runner (scripts/mac-signin.sh).
#![allow(dead_code)]
use std::sync::Arc;
use std::time::Duration;

use buzz_core::kind::KIND_PAIRING;
use buzz_core::pairing::{qr::encode_qr, PairingSession, PayloadType};
use buzz_ws_client::{NostrWsConnection, RelayMessage};
use nostr::nips::nip19::ToBech32;
use nostr::{Event, Keys};
use serde_json::json;

pub async fn relay() -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(buzz_pair_relay::run_server(listener, Arc::new(buzz_pair_relay::Relay::new())));
    format!("ws://127.0.0.1:{port}")
}

/// The sender's half, as the Uni app runs it.
pub struct Sender {
    pub session: PairingSession,
    conn: NostrWsConnection,
    /// How long to wait for the other side's next message (a person driving the app takes longer than a test).
    pub wait: Duration,
}

impl Sender {
    pub async fn open(relay: &str) -> (Self, String) {
        let (session, qr) = PairingSession::new_source(relay.into());
        let mut conn = NostrWsConnection::connect(relay).await.unwrap();
        conn.send_raw(&json!(["REQ", "pair", {"kinds": [KIND_PAIRING], "#p": [session.pubkey().to_hex()]}])).await.unwrap();
        loop {
            if let RelayMessage::Eose { .. } = conn.next_event(Duration::from_secs(5)).await.unwrap() {
                break;
            }
        }
        (Sender { session, conn, wait: Duration::from_secs(10) }, encode_qr(&qr))
    }
    pub async fn next(&mut self) -> Event {
        loop {
            if let RelayMessage::Event { event, .. } = self.conn.next_event(self.wait).await.unwrap() {
                return *event;
            }
        }
    }
    pub async fn publish(&mut self, ev: &Event) {
        self.conn.send_raw(&json!(["EVENT", ev])).await.unwrap();
    }
    pub async fn offer(&mut self) -> String {
        loop {
            let ev = self.next().await;
            if let Ok(sas) = self.session.handle_offer(&ev) {
                return sas;
            }
        }
    }
    pub async fn send(&mut self, payload: String) {
        let confirm = self.session.confirm_sas().unwrap();
        self.publish(&confirm).await;
        let ev = self.session.send_payload(PayloadType::Custom, zeroize::Zeroizing::new(payload)).unwrap();
        self.publish(&ev).await;
    }
}

pub fn identity(keys: &Keys, claimed: &Keys) -> String {
    json!({ "relayUrl": "https://relay.example", "pubkey": claimed.public_key().to_hex(), "nsec": keys.secret_key().to_bech32().unwrap() }).to_string()
}
