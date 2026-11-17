//! Pairing end to end over the real Buzz pairing relay (run in-process): a stand-in sender plays the Uni app's side
//! (uni-core `pairing_source.rs`: a QR link, the offer, the code, `sas-confirm`, Buzz's identity JSON) and the app's
//! receiving side (src/pairing.rs) takes the key.
#[path = "support/pair_sender.rs"]
mod pair_sender;

use std::time::Duration;

use buzz_core::pairing::{qr::encode_qr, AbortReason, PairingSession};
use nostr::Keys;
use pair_sender::{identity, relay, Sender};
use parachute_lib::pairing;

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
    let got = pending.confirm(|k| async move { Ok::<_, String>(k) }, tokio::sync::oneshot::channel().1).await.expect("the key arrives");
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
    assert!(pending.confirm(|k| async move { Ok::<_, String>(k) }, tokio::sync::oneshot::channel().1).await.is_err());
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

#[tokio::test(flavor = "multi_thread")]
async fn a_key_this_device_couldnt_keep_isnt_reported_done() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let relay = relay().await;
    let account = Keys::generate();
    let (mut sender, link) = Sender::open(&relay).await;
    let pending = pairing::start(&link).await.unwrap();
    sender.offer().await;
    sender.send(identity(&account, &account)).await;
    let kept = pending.confirm(|_| async move { Err::<(), _>("the key store refused".to_string()) }, tokio::sync::oneshot::channel().1).await;
    assert!(kept.is_err());
    // the sender hears an abort, never `complete`
    loop {
        let ev = sender.next().await;
        assert!(sender.session.handle_complete(&ev).is_err() || sender.session.state() == buzz_core::pairing::SessionState::Aborted, "complete sent for a key that wasn't kept");
        if sender.session.handle_abort(&ev).is_ok() || sender.session.state() == buzz_core::pairing::SessionState::Aborted {
            break;
        }
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn cancel_while_waiting_for_the_key_tells_the_sender() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let relay = relay().await;
    let (mut sender, link) = Sender::open(&relay).await;
    let pending = pairing::start(&link).await.unwrap();
    sender.offer().await;
    let (stop, stopped) = tokio::sync::oneshot::channel();
    let waiting = tokio::spawn(pending.confirm(|k| async move { Ok::<_, String>(k) }, stopped));
    tokio::time::sleep(Duration::from_millis(300)).await;
    stop.send(()).unwrap();
    assert!(waiting.await.unwrap().is_err());
    loop {
        let ev = sender.next().await;
        if let Ok(reason) = sender.session.handle_abort(&ev) {
            assert_eq!(reason, AbortReason::UserDenied);
            break;
        }
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn a_dropped_stop_is_not_a_stop() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let relay = relay().await;
    let account = Keys::generate();
    let (mut sender, link) = Sender::open(&relay).await;
    let pending = pairing::start(&link).await.unwrap();
    sender.offer().await;
    let (stop, stopped) = tokio::sync::oneshot::channel::<()>();
    drop(stop);
    sender.send(identity(&account, &account)).await;
    let got = pending.confirm(|k| async move { Ok::<_, String>(k) }, stopped).await.expect("still arrives");
    assert_eq!(got.public_key(), account.public_key());
}

#[tokio::test(flavor = "multi_thread")]
async fn only_a_pairing_link_starts_a_pairing() {
    for not_a_link in ["https://example.com", "nostrpair://nothex?secret=00&relay=wss%3A%2F%2Fr.example&v=1", "", "  "] {
        let e = pairing::start(not_a_link).await.err().expect(not_a_link);
        assert!(e.contains("pairing link"), "{not_a_link}: {e}");
    }
}
