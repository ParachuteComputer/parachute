//! Approvals for an applet (docs/design/KEYRING.md): Uni's sealed cards and secret requests, answered with the approval
//! key for an applet whose relay service has the approvals line. The checks are the Uni app's (approvals/); this file
//! joins them to the applet's session (its grant), the device's trusted list and the device unlock (keyring.rs).
//!
//! What crosses to the web side: a card's view (never its data key), and the gift wraps to publish (ciphertext to the
//! request's one-time key). A secret's value comes in from the shell's own sheet and goes out only sealed.

use std::path::PathBuf;

use nostr::{Event, JsonUtil, Timestamp};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, Runtime, State};
use zeroize::Zeroizing;

use crate::approvals::{self, approval_summary, check_answerable, mark_sent, needs_fresh_unlock, prepare_answer, seal_delivery, seal_forget, seal_key, verified_request, view, Answers, ApprovalKeys, CardView, Decision};
use crate::door::Refusal;
use crate::key::KeyState;
use crate::keyring::{self, KeyringState};
use crate::services::{held, Grantee, ServicesState};

fn no(code: &'static str, message: impl Into<String>) -> Refusal {
    Refusal { code, message: message.into() }
}
fn refused(e: approvals::Error) -> Refusal {
    no("refused", e.to_string())
}
fn now() -> u64 {
    Timestamp::now().as_secs()
}

/// A signed kind 9, as handed over: its id and signature checked here.
fn signed(raw: &Value) -> Result<Event, Refusal> {
    let ev = Event::from_json(raw.to_string()).map_err(|_| no("bad_params", "A card is a signed message."))?;
    ev.verify().map_err(|_| no("bad_params", "That message's signature doesn't check."))?;
    if ev.kind.as_u16() != 9 {
        return Err(no("bad_params", "A card is a room message."));
    }
    Ok(ev)
}

/// With rooms, the card is in one of them.
fn in_rooms(g: &Grantee, ev: &Event) -> Result<(), Refusal> {
    if g.rooms.is_empty() {
        return Ok(());
    }
    let room = ev.tags.iter().find(|t| t.as_slice().first().map(String::as_str) == Some("h")).and_then(|t| t.as_slice().get(1).cloned());
    match room {
        Some(r) if g.rooms.contains(&r) => Ok(()),
        _ => Err(no("out_of_scope", "That card isn't in its rooms.")),
    }
}

/// The answers ledger for this approval key, shared by every applet on this device.
fn ledger_dir<R: Runtime>(app: &AppHandle<R>, a: &ApprovalKeys) -> Result<PathBuf, Refusal> {
    let base = app.path().app_data_dir().map_err(|_| no("storage", "The app's data folder isn't available."))?;
    Ok(base.join("approvals").join(&a.public_key().to_hex()[..16]))
}

struct Ready {
    g: Grantee,
    ev: Event,
    approval: ApprovalKeys,
    trusted: Vec<nostr::PublicKey>,
    dir: PathBuf,
}

async fn ready<R: Runtime>(app: &AppHandle<R>, keys: &KeyState, ring: &KeyringState, state: &ServicesState, session: &str, service: &str, event: &Value) -> Result<Ready, Refusal> {
    let g = state.broker(app)?.approvals_of(session, service)?;
    let ev = signed(event)?;
    in_rooms(&g, &ev)?;
    let everyday = held(app, keys).await?;
    let approval = ring.approval(app, &everyday).await?;
    let trusted = keyring::trusted_of(&g.from, &keyring::approvers(app)?);
    let dir = ledger_dir(app, &approval)?;
    Ok(Ready { g, ev, approval, trusted, dir })
}

#[tauri::command]
pub async fn svc_card_view<R: Runtime>(app: AppHandle<R>, keys: State<'_, KeyState>, ring: State<'_, KeyringState>, state: State<'_, ServicesState>, session: String, service: String, event: Value) -> Result<CardView, Refusal> {
    let r = ready(&app, &keys, &ring, &state, &session, &service, &event).await?;
    let seal = seal_key(&r.approval).map_err(refused)?;
    let answers = Answers::load(&r.dir).map_err(refused)?;
    let mut v = view(&r.ev, &r.trusted, &seal, &answers, now());
    // signed by a key the grant names, only not trusted on this device yet: say that (not "not Uni"), and offer it
    let author = r.ev.pubkey.to_hex();
    if v.rows.is_empty() && r.ev.kind.as_u16() == 9 && keyring::trust_offer(&r.g.from, &keyring::approvers(&app)?, &author) {
        v.refused = Some(NOT_TRUSTED_HERE.into());
        v.trust = Some(author);
    }
    Ok(v)
}

/// What a card from a key the grant names, not yet on this device's list, says instead of "Not signed by Uni."
pub const NOT_TRUSTED_HERE: &str = "This device doesn't trust the key that signed this card yet.";

/// Trust the card's author for approvals on this device: only a key the applet's grant names in `approvals.from`
/// (which the person saw on the grant's card), under `name`, behind the device unlock. Nothing else adds a key.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn svc_card_trust<R: Runtime>(app: AppHandle<R>, keys: State<'_, KeyState>, ring: State<'_, KeyringState>, state: State<'_, ServicesState>, session: String, service: String, event: Value, name: String) -> Result<(), Refusal> {
    let r = ready(&app, &keys, &ring, &state, &session, &service, &event).await?;
    let author = r.ev.pubkey.to_hex();
    if !keyring::trust_offer(&r.g.from, &keyring::approvers(&app)?, &author) {
        return Err(no("not_granted", "That key isn't one this applet names for approvals, or it is trusted already."));
    }
    keyring::add_approver(&app, &ring, &name, &r.ev.pubkey).await?;
    state.broker(&app)?.log_for(&session, &service, format!("trust {name}'s key for approvals"), Some(r.ev.id.to_hex()))?;
    Ok(())
}

#[derive(Serialize)]
pub struct Wrap {
    rid: String,
    wrap: Event,
}

#[derive(Serialize)]
pub struct Answered {
    wraps: Vec<Wrap>,
    /// An approval an earlier unlock covered: the shell says so over the applet.
    graced: bool,
    summary: String,
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn svc_card_answer<R: Runtime>(app: AppHandle<R>, keys: State<'_, KeyState>, ring: State<'_, KeyringState>, state: State<'_, ServicesState>, session: String, service: String, event: Value, decision: String, rids: Vec<String>) -> Result<Answered, Refusal> {
    let r = ready(&app, &keys, &ring, &state, &session, &service, &event).await?;
    let decision = match decision.as_str() {
        "approve" => Decision::Approve,
        "deny" => Decision::Deny,
        _ => return Err(no("bad_params", "A decision is approve or deny.")),
    };
    let mut graced = false;
    let mut summary = String::new();
    if decision == Decision::Approve {
        // the device unlock, in the shell's words from the checked card; a grace only for routine rows, and only for
        // the applet that earned it
        let seal = seal_key(&r.approval).map_err(refused)?;
        let answers = Answers::load(&r.dir).map_err(refused)?;
        let v = view(&r.ev, &r.trusted, &seal, &answers, now());
        if let Some(why) = &v.refused {
            return Err(no("refused", why.clone()));
        }
        let (title, reason) = approval_summary(&v, &rids).map_err(refused)?;
        let fresh = needs_fresh_unlock(&v, &rids);
        graced = ring.confirm(&app, &r.g.subject, &r.ev.id.to_hex(), !fresh, &title, &reason).await?;
        if graced {
            summary = format!("{title}: approved. Your unlock a moment ago covered it.");
        }
    }
    let wraps = prepare_answer(&r.approval, &r.trusted, &r.ev, decision, &rids, &r.dir, now()).map_err(refused)?;
    let broker = state.broker(&app)?;
    let word = if decision == Decision::Approve { "approve" } else { "deny" };
    for w in &wraps {
        broker.log_for(&session, &service, format!("answer a card ({word}, approval key{})", if graced { ", within an unlock" } else { "" }), Some(w.wrap.id.to_hex()))?;
    }
    Ok(Answered { wraps: wraps.into_iter().map(|w| Wrap { rid: w.rid, wrap: w.wrap }).collect(), graced, summary })
}

#[tauri::command]
pub async fn svc_card_sent<R: Runtime>(app: AppHandle<R>, keys: State<'_, KeyState>, ring: State<'_, KeyringState>, state: State<'_, ServicesState>, session: String, service: String, card: String, rid: String) -> Result<(), Refusal> {
    state.broker(&app)?.approvals_of(&session, &service)?;
    let everyday = held(&app, &keys).await?;
    let approval = ring.approval(&app, &everyday).await?;
    mark_sent(&ledger_dir(&app, &approval)?, &card, &rid).map_err(refused)
}

/// A secret request, for the shell's sheet: who asks (the trusted list's name), and Uni's own words.
#[derive(Serialize)]
pub struct SecretView {
    requester: String,
    rid: String,
    name: String,
    label: String,
    purpose: String,
    store: String,
    keep_days: u32,
    expires: u64,
}

async fn asked<R: Runtime>(app: &AppHandle<R>, r: &Ready) -> Result<approvals::Asked, Refusal> {
    let a = verified_request(&r.ev).map_err(refused)?;
    check_answerable(&a, &r.trusted, now()).map_err(refused)?;
    let _ = app;
    Ok(a)
}

#[tauri::command]
pub async fn svc_secret_view<R: Runtime>(app: AppHandle<R>, keys: State<'_, KeyState>, ring: State<'_, KeyringState>, state: State<'_, ServicesState>, session: String, service: String, event: Value) -> Result<SecretView, Refusal> {
    let r = ready(&app, &keys, &ring, &state, &session, &service, &event).await?;
    let a = asked(&app, &r).await?;
    let requester = keyring::approvers(&app)?.into_iter().find(|x| x.pubkey == a.requester.to_hex()).map(|x| x.name).unwrap_or_default();
    let q = a.request;
    Ok(SecretView { requester, rid: q.rid, name: q.name, label: q.label, purpose: q.purpose, store: q.store, keep_days: q.keep_days, expires: q.expires })
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn svc_secret_send<R: Runtime>(app: AppHandle<R>, keys: State<'_, KeyState>, ring: State<'_, KeyringState>, state: State<'_, ServicesState>, session: String, service: String, event: Value, value: String) -> Result<Event, Refusal> {
    let value = Zeroizing::new(value);
    let r = ready(&app, &keys, &ring, &state, &session, &service, &event).await?;
    let a = asked(&app, &r).await?;
    let wrap = seal_delivery(&r.approval, &a, &value, now()).map_err(refused)?;
    state.broker(&app)?.log_for(&session, &service, "give a secret (approval key)".into(), Some(wrap.id.to_hex()))?;
    Ok(wrap)
}

#[tauri::command]
pub async fn svc_secret_forget<R: Runtime>(app: AppHandle<R>, keys: State<'_, KeyState>, ring: State<'_, KeyringState>, state: State<'_, ServicesState>, session: String, service: String, event: Value) -> Result<Event, Refusal> {
    let r = ready(&app, &keys, &ring, &state, &session, &service, &event).await?;
    let a = verified_request(&r.ev).map_err(refused)?;
    if !r.trusted.contains(&a.requester) {
        return Err(no("refused", "This requester is not trusted for secrets."));
    }
    let wrap = seal_forget(&r.approval, &a, now()).map_err(refused)?;
    state.broker(&app)?.log_for(&session, &service, "ask to forget a secret (approval key)".into(), Some(wrap.id.to_hex()))?;
    Ok(wrap)
}
