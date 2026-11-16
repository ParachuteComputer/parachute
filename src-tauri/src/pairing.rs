//! Pairing: receive the person's key from a device that already has it, over the Buzz pairing relay (NIP-AB). This is
//! the receiving ("target") side of the protocol the Uni app (Settings → Pair a device) and Buzz desktop (Settings →
//! Pair mobile device) send with; it follows the Uni app's driver (uni-core `pairing.rs`). The protocol's crypto is
//! buzz-core's `PairingSession`; this file is only the relay I/O.
//!
//! 1. `pair_start(link)`: read the `nostrpair://` link, connect to the relay it names (answering a NIP-42 challenge
//!    with the session's throwaway key), subscribe, wait for EOSE, publish the offer. Returns the 6-digit code.
//! 2. The person compares codes. `pair_confirm`: wait for the sender's confirmation (buzz-core checks the transcript),
//!    take the key, check it, say `complete`, keep the key (key.rs). `pair_cancel` sends an abort instead.
//!
//! The received secret lives in `Zeroizing` buffers and goes nowhere but the key store.

use std::time::Duration;

use buzz_core::kind::KIND_PAIRING;
use buzz_core::pairing::{qr::decode_qr, AbortReason, PairingError, PairingSession, PayloadType, SessionState};
use buzz_ws_client::{NostrWsConnection, RelayMessage, WsClientError};
use nostr::{Event, EventBuilder, Keys, PublicKey, RelayUrl};
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Runtime, State};
use tokio::sync::Mutex;
use tokio::time::Instant;
use zeroize::Zeroizing;

use crate::key::{KeyInfo, KeyState};

/// The whole pairing's budget, as buzz-core's session timeout.
pub const SESSION_TIMEOUT: Duration = Duration::from_secs(120);
const AUTH_CHALLENGE_WAIT: Duration = Duration::from_secs(3);
const SUB_ID: &str = "pair";

/// A pairing in progress: offer published, code known, waiting for the person.
pub struct Pending {
    session: PairingSession,
    conn: NostrWsConnection,
    sas: String,
    deadline: Instant,
}

/// The pairing this device has started, if any.
#[derive(Default)]
pub struct PairState(Mutex<Option<Pending>>);

fn remaining(deadline: Instant) -> Result<Duration, String> {
    deadline
        .checked_duration_since(Instant::now())
        .filter(|d| !d.is_zero())
        .ok_or_else(|| "The pairing timed out. Start again on the other device.".to_string())
}

fn ws(e: WsClientError) -> String {
    match e {
        WsClientError::Timeout => "The pairing timed out. Start again on the other device.".into(),
        _ => "The pairing relay couldn't be reached.".into(),
    }
}

/// A pairing relay must be `wss://`; `ws://` only on this machine (tests).
pub fn check_relay(url: &str) -> Result<(), String> {
    let u = url::Url::parse(url).map_err(|_| "The pairing link names no usable relay.".to_string())?;
    let host = u.host_str().unwrap_or_default();
    match u.scheme() {
        "wss" => Ok(()),
        "ws" if matches!(host, "127.0.0.1" | "localhost" | "[::1]") => Ok(()),
        _ => Err("The pairing link's relay isn't a secure (wss://) address.".into()),
    }
}

/// The key a sender sent: Buzz's identity JSON `{relayUrl, pubkey, nsec}` (Buzz desktop, the Uni app) or a bare nsec
/// (the reference CLI). A claimed public key must match the secret.
pub fn parse_payload(kind: PayloadType, payload: &str) -> Result<Keys, String> {
    let nsec = match kind {
        PayloadType::Nsec => Zeroizing::new(payload.trim().to_string()),
        PayloadType::Custom => {
            #[derive(serde::Deserialize)]
            struct Identity {
                pubkey: Option<String>,
                nsec: Option<String>,
            }
            let v: Identity = serde_json::from_str(payload).map_err(|_| "The other device sent something that isn't a key.".to_string())?;
            let nsec = Zeroizing::new(v.nsec.ok_or_else(|| "The other device sent no key.".to_string())?);
            if let Some(claimed) = v.pubkey {
                let keys = Keys::parse(nsec.as_str()).map_err(|_| "The other device sent something that isn't a key.".to_string())?;
                let claimed = PublicKey::parse(claimed.trim()).map_err(|_| "The other device sent a broken key.".to_string())?;
                if claimed != keys.public_key() {
                    return Err("The key the other device sent doesn't match its own public key.".into());
                }
            }
            nsec
        }
        _ => return Err("The other device offered a different kind of sign-in than a key. Pair from the Uni app or Buzz.".into()),
    };
    Keys::parse(nsec.as_str()).map_err(|_| "The other device sent something that isn't a key.".to_string())
}

/// Answer a prompt NIP-42 challenge with the session's throwaway key. A relay that asks nothing is fine.
async fn maybe_auth(conn: &mut NostrWsConnection, session: &PairingSession, relay: &str) -> Result<(), String> {
    let challenge = match conn.next_event(AUTH_CHALLENGE_WAIT).await {
        Ok(RelayMessage::Auth { challenge }) => challenge,
        Ok(_) | Err(WsClientError::Timeout) => return Ok(()),
        Err(e) => return Err(ws(e)),
    };
    let url = RelayUrl::parse(relay).map_err(|_| "The pairing link names no usable relay.".to_string())?;
    let auth = session.sign_event(EventBuilder::auth(challenge, url)).map_err(|_| "The pairing couldn't start.".to_string())?;
    let id = auth.id.to_hex();
    conn.send_raw(&json!(["AUTH", auth])).await.map_err(ws)?;
    let until = Instant::now() + Duration::from_secs(10);
    loop {
        match conn.next_event(remaining(until)?).await.map_err(ws)? {
            RelayMessage::Ok(ok) if ok.event_id == id => {
                return if ok.accepted { Ok(()) } else { Err("The pairing relay refused this device.".into()) };
            }
            _ => {}
        }
    }
}

async fn publish(conn: &mut NostrWsConnection, ev: &Event) -> Result<(), String> {
    conn.send_raw(&json!(["EVENT", ev])).await.map_err(ws)
}

fn abort_text(r: AbortReason) -> &'static str {
    match r {
        AbortReason::SasMismatch => "the codes didn't match",
        AbortReason::UserDenied => "it was declined",
        AbortReason::Timeout => "it timed out",
        AbortReason::ProtocolError | AbortReason::Unknown => "something went wrong there",
    }
}

/// Step 1: read the link, connect, subscribe, publish the offer.
pub async fn start(uri: &str) -> Result<Pending, String> {
    let deadline = Instant::now() + SESSION_TIMEOUT;
    let qr = decode_qr(uri.trim()).map_err(|_| "That isn't a pairing link. It starts with nostrpair://".to_string())?;
    let (session, offer) = PairingSession::new_target(&qr).map_err(|_| "That pairing link can't be used. Start again on the other device.".to_string())?;
    let relay = session.relay_urls().first().cloned().ok_or_else(|| "The pairing link names no relay.".to_string())?;
    check_relay(&relay)?;
    let sas = session.sas_code().ok_or_else(|| "The pairing couldn't start.".to_string())?;
    let mut conn = tokio::time::timeout(remaining(deadline)?, NostrWsConnection::connect(&relay))
        .await
        .map_err(|_| "The pairing relay couldn't be reached.".to_string())?
        .map_err(ws)?;
    maybe_auth(&mut conn, &session, &relay).await?;
    let filter = json!({ "kinds": [KIND_PAIRING], "#p": [session.pubkey().to_hex()] });
    conn.send_raw(&json!(["REQ", SUB_ID, filter])).await.map_err(ws)?;
    // the subscription must be live on the relay before the offer goes out
    loop {
        match conn.next_event(remaining(deadline)?).await.map_err(ws)? {
            RelayMessage::Eose { subscription_id } if subscription_id == SUB_ID => break,
            RelayMessage::Closed { subscription_id, .. } if subscription_id == SUB_ID => return Err("The pairing relay closed the pairing.".into()),
            _ => {}
        }
    }
    publish(&mut conn, &offer).await?;
    Ok(Pending { session, conn, sas, deadline })
}

impl Pending {
    pub fn sas(&self) -> &str {
        &self.sas
    }

    async fn next_pairing_event(&mut self) -> Result<Event, String> {
        loop {
            match self.conn.next_event(remaining(self.deadline)?).await {
                Ok(RelayMessage::Event { subscription_id, event }) if subscription_id == SUB_ID => {
                    if let Ok(reason) = self.session.handle_abort(&event) {
                        return Err(format!("The other device stopped the pairing: {}.", abort_text(reason)));
                    }
                    return Ok(*event);
                }
                Ok(RelayMessage::Ok(ok)) if !ok.accepted => return Err("The pairing relay refused a message.".into()),
                Ok(RelayMessage::Closed { subscription_id, .. }) if subscription_id == SUB_ID => return Err("The pairing relay closed the pairing.".into()),
                Ok(_) => {}
                Err(WsClientError::Json(_) | WsClientError::UnexpectedMessage(_)) => {}
                Err(e) => return Err(ws(e)),
            }
        }
    }

    /// Step 2, after the person says the codes match: receive the key.
    pub async fn confirm(mut self) -> Result<Keys, String> {
        let result = self.receive().await;
        if result.is_err() && !matches!(self.session.state(), SessionState::Aborted) {
            if let Ok(Some(ev)) = self.session.abort(AbortReason::ProtocolError) {
                let _ = publish(&mut self.conn, &ev).await;
            }
        }
        let _ = tokio::time::timeout(Duration::from_secs(2), self.conn.disconnect()).await;
        result
    }

    async fn receive(&mut self) -> Result<Keys, String> {
        // the sender confirms once its person approves; buzz-core checks the transcript. Junk and repeats are skipped.
        loop {
            let ev = self.next_pairing_event().await?;
            match self.session.handle_sas_confirm(&ev) {
                Ok(code) if code == self.sas => break,
                Ok(_) => return Err("The codes didn't match. Nothing was kept.".into()),
                Err(PairingError::TranscriptMismatch) => {
                    if let Ok(Some(abort)) = self.session.abort(AbortReason::SasMismatch) {
                        let _ = publish(&mut self.conn, &abort).await;
                    }
                    return Err("The security check failed, so the pairing stopped. Nothing was kept.".into());
                }
                Err(PairingError::SessionExpired) => return Err("The pairing timed out. Start again on the other device.".into()),
                Err(_) => continue,
            }
        }
        self.session.confirm_target_sas().map_err(|_| "The pairing couldn't continue.".to_string())?;
        let (kind, payload) = loop {
            let ev = self.next_pairing_event().await?;
            match self.session.handle_payload(&ev) {
                Ok(p) => break p,
                Err(PairingError::SessionExpired) => return Err("The pairing timed out. Start again on the other device.".into()),
                Err(_) => continue,
            }
        };
        let payload = Zeroizing::new(payload.to_string());
        let keys = parse_payload(kind, &payload)?;
        let complete = self.session.send_complete().map_err(|_| "The pairing couldn't finish.".to_string())?;
        publish(&mut self.conn, &complete).await?;
        Ok(keys)
    }

    /// The person declined (codes differ, or cancel): tell the sender.
    pub async fn cancel(mut self, codes_differ: bool) {
        let reason = if codes_differ { AbortReason::SasMismatch } else { AbortReason::UserDenied };
        if let Ok(Some(ev)) = self.session.abort(reason) {
            let _ = publish(&mut self.conn, &ev).await;
        }
        let _ = tokio::time::timeout(Duration::from_secs(2), self.conn.disconnect()).await;
    }
}

#[derive(Serialize)]
pub struct Started {
    sas: String,
}

#[tauri::command]
pub async fn pair_start<R: Runtime>(app: AppHandle<R>, keys: State<'_, KeyState>, pairing: State<'_, PairState>, link: String) -> Result<Started, String> {
    let link = Zeroizing::new(link);
    if keys.holds(&app).await? {
        return Err("This device already has a key. Remove it in Settings first.".into());
    }
    // one pairing at a time: a new start ends the old one (the lock is not held while connecting, so Cancel answers)
    let old = pairing.0.lock().await.take();
    if let Some(old) = old {
        old.cancel(false).await;
    }
    let pending = start(&link).await?;
    let sas = pending.sas().to_string();
    if let Some(raced) = pairing.0.lock().await.replace(pending) {
        raced.cancel(false).await;
    }
    Ok(Started { sas })
}

#[tauri::command]
pub async fn pair_confirm<R: Runtime>(app: AppHandle<R>, keys: State<'_, KeyState>, pairing: State<'_, PairState>) -> Result<KeyInfo, String> {
    let pending = pairing.0.lock().await.take().ok_or_else(|| "No pairing is waiting. Start again.".to_string())?;
    let received = pending.confirm().await?;
    keys.install(&app, received).await
}

#[tauri::command]
pub async fn pair_cancel(pairing: State<'_, PairState>, codes_differ: bool) -> Result<(), String> {
    if let Some(pending) = pairing.0.lock().await.take() {
        pending.cancel(codes_differ).await;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use nostr::nips::nip19::ToBech32;

    #[test]
    fn relays() {
        assert!(check_relay("wss://pairing.example").is_ok());
        assert!(check_relay("ws://127.0.0.1:7777").is_ok());
        assert!(check_relay("ws://pairing.example").is_err());
        assert!(check_relay("https://pairing.example").is_err());
    }

    #[test]
    fn payloads() {
        let k = Keys::generate();
        let other = Keys::generate();
        let nsec = k.secret_key().to_bech32().unwrap();
        let buzz = json!({"relayUrl":"https://relay.example","pubkey":k.public_key().to_hex(),"nsec":nsec}).to_string();
        assert_eq!(parse_payload(PayloadType::Custom, &buzz).unwrap().public_key(), k.public_key());
        let wrong = json!({"pubkey":other.public_key().to_hex(),"nsec":nsec}).to_string();
        assert!(parse_payload(PayloadType::Custom, &wrong).is_err(), "a claimed public key must match");
        assert_eq!(parse_payload(PayloadType::Nsec, &format!("{nsec}\n")).unwrap().public_key(), k.public_key());
        assert!(parse_payload(PayloadType::Bunker, "bunker://x").is_err());
        assert!(parse_payload(PayloadType::Custom, "{}").is_err());
    }

    #[test]
    fn links() {
        assert!(decode_qr("https://example.com").is_err());
    }
}
