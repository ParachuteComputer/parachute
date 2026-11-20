//! The keyring (docs/design/KEYRING.md): the approval key beside the everyday key (key.rs), the list of keys this
//! device trusts to ask for approvals, and the device unlock with its grace.
//!
//! - **everyday key**: key.rs. **approval key**: a separate secret when the person made one (its own storage entry),
//!   else the everyday key in the approval role. **root key**: offline, never here.
//! - The approval role is a type (`approvals::ApprovalKeys`): only this module makes one, so nothing signs a seal or an
//!   approval request without deliberately taking it.
//! - The unlock is decided here, natively: Android's BiometricPrompt (strong biometric or the screen lock), macOS
//!   LocalAuthentication, elsewhere a native OK/Cancel dialog. Nothing from the web side can say "unlocked".
//! - The grace: 300 seconds after a passing unlock, for routine approvals only, for the applet (grant subject) that
//!   earned it, ended when the screen goes off (Android's screen-off count) and by the idle lock (levels.rs). Never on
//!   desktop in this step. What an action asks before the unlock (nothing, the unlock, the passcode) is levels.rs's.

use std::collections::HashMap;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use nostr::nips::nip19::{FromBech32, ToBech32};
use nostr::{Event, Keys, PublicKey};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime, State};
use tokio::sync::Mutex;
use zeroize::Zeroizing;

use crate::approvals::{approval_role, ApprovalKeys};
use crate::door::Refusal;
use crate::key::store::{self, Stored, Which};
use crate::key::{parse_secret, KeyState};

/// How long an unlock covers routine approvals for the applet that asked.
pub const GRACE: Duration = Duration::from_secs(300);
/// After a cancelled unlock, the same card can't ask again for this long (no prompts in a loop).
pub const COOLDOWN: Duration = Duration::from_secs(5);
const APPROVERS_FILE: &str = "approvers.json";
const MAX_APPROVERS: usize = 8;

fn no(code: &'static str, message: impl Into<String>) -> Refusal {
    Refusal { code, message: message.into() }
}

enum Slot {
    Unread,
    /// No separate approval key: the everyday key is the approval key.
    Same,
    Held(Keys),
    Unreadable(String),
}

struct Grace {
    subject: String,
    at: Instant,
    epoch: u64,
}

pub struct KeyringState {
    approval: Mutex<Slot>,
    grace: std::sync::Mutex<Option<Grace>>,
    /// One device unlock at a time.
    unlocking: Mutex<()>,
    cooldown: std::sync::Mutex<HashMap<String, Instant>>,
}

impl Default for KeyringState {
    fn default() -> Self {
        KeyringState { approval: Mutex::new(Slot::Unread), grace: std::sync::Mutex::new(None), unlocking: Mutex::new(()), cooldown: std::sync::Mutex::new(HashMap::new()) }
    }
}

async fn read<R: Runtime>(slot: &mut Slot, app: &AppHandle<R>) -> Result<(), Refusal> {
    if let Slot::Unread = *slot {
        *slot = match store::load_which(app, Which::Approval).await.map_err(|m| no("storage", m))? {
            Stored::Secret(s) => parse_secret(&s).map(Slot::Held).unwrap_or_else(|()| Slot::Unreadable("The approval key kept here can't be read.".into())),
            Stored::Unreadable => Slot::Unreadable("The approval key kept here can't be read.".into()),
            Stored::Nothing => Slot::Same,
        };
    }
    Ok(())
}

impl KeyringState {
    /// The approval key, in its role: the separate one, or the everyday key when there is none.
    pub async fn approval<R: Runtime>(&self, app: &AppHandle<R>, everyday: &Keys) -> Result<ApprovalKeys, Refusal> {
        let mut slot = self.approval.lock().await;
        read(&mut slot, app).await?;
        match &*slot {
            Slot::Held(k) => Ok(approval_role(k.clone())),
            Slot::Same => Ok(approval_role(everyday.clone())),
            Slot::Unreadable(m) => Err(no("no_key", m.clone())),
            Slot::Unread => Err(no("no_key", "The approval key isn't read yet.")),
        }
    }

    /// Is there a separate approval key? (None: the everyday key is it.)
    pub async fn separate<R: Runtime>(&self, app: &AppHandle<R>) -> Result<Option<PublicKey>, Refusal> {
        let mut slot = self.approval.lock().await;
        read(&mut slot, app).await?;
        Ok(match &*slot {
            Slot::Held(k) => Some(k.public_key()),
            Slot::Unreadable(m) => return Err(no("no_key", m.clone())),
            _ => None,
        })
    }

    fn graced(&self, subject: &str, epoch: Option<u64>) -> bool {
        let g = self.grace.lock().unwrap_or_else(|e| e.into_inner());
        match (&*g, epoch) {
            (Some(g), Some(e)) => g.subject == subject && g.at.elapsed() < GRACE && g.epoch == e,
            _ => false,
        }
    }

    /// End any grace (a key changed, or the person asked).
    pub fn end_grace(&self) {
        *self.grace.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }

    /// Refuse a second prompt for `what` (a card) within the cooldown after a cancelled one.
    pub fn cooling(&self, what: &str) -> bool {
        let mut c = self.cooldown.lock().unwrap_or_else(|e| e.into_inner());
        c.retain(|_, at| at.elapsed() < COOLDOWN);
        c.contains_key(what)
    }

    fn cooled(&self, what: &str) {
        self.cooldown.lock().unwrap_or_else(|e| e.into_inner()).insert(what.to_string(), Instant::now());
    }

    /// The device unlock before an approval. `routine`: a grace earned by this applet (`subject`) may cover it; else
    /// it always asks. Returns whether a grace covered it (the shell then says so over the applet). `what`: the card or
    /// request, for the cooldown after a cancel.
    /// Refused while Parachute is locked (the idle lock, levels.rs): only its own unlock opens it.
    pub async fn confirm<R: Runtime>(&self, app: &AppHandle<R>, subject: &str, what: &str, routine: bool, title: &str, reason: &str) -> Result<bool, Refusal> {
        if let Some(levels) = app.try_state::<crate::levels::LevelsState>() {
            if levels.locked(app).await? {
                return Err(no("locked", "Parachute is locked. Unlock it first."));
            }
        }
        self.ask(app, subject, what, routine, title, reason).await
    }

    /// The unlock itself, as `confirm` asks it (the idle lock's own unlock calls this).
    pub async fn ask<R: Runtime>(&self, app: &AppHandle<R>, subject: &str, what: &str, routine: bool, title: &str, reason: &str) -> Result<bool, Refusal> {
        if self.cooling(what) {
            return Err(no("refused", "That was just cancelled. Try again in a moment."));
        }
        let _one = self.unlocking.try_lock().map_err(|_| no("refused", "A device unlock is already showing."))?;
        if routine && self.graced(subject, platform::epoch(app).await) {
            return Ok(true);
        }
        match platform::unlock(app, title, reason).await {
            Ok(()) => {
                if let Some(epoch) = platform::epoch(app).await {
                    *self.grace.lock().unwrap_or_else(|e| e.into_inner()) = Some(Grace { subject: subject.to_string(), at: Instant::now(), epoch });
                }
                Ok(false)
            }
            Err(m) => {
                self.cooled(what);
                Err(no("unlock", m))
            }
        }
    }
}

// ── trusted for approvals ──

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Approver {
    pub name: String,
    /// hex
    pub pubkey: String,
}

fn approvers_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, Refusal> {
    Ok(app.path().app_data_dir().map_err(|_| no("storage", "The app's data folder isn't available."))?.join(APPROVERS_FILE))
}

/// The list as kept. Missing is empty; unreadable is an error (an empty list would quietly trust nobody, which is
/// safe, but the person should hear why their approvals stopped).
pub fn read_approvers(path: &std::path::Path) -> Result<Vec<Approver>, Refusal> {
    match std::fs::read(path) {
        Ok(b) => serde_json::from_slice(&b).map_err(|_| no("storage", "The list of keys trusted for approvals can't be read.")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(_) => Err(no("storage", "The list of keys trusted for approvals can't be read.")),
    }
}

pub fn approvers<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<Approver>, Refusal> {
    read_approvers(&approvers_path(app)?)
}

/// `npub1…` or 64 hex characters.
pub fn parse_public(raw: &str) -> Option<PublicKey> {
    let raw = raw.trim();
    let k = if raw.starts_with("npub1") { PublicKey::from_bech32(raw).ok()? } else { PublicKey::from_hex(raw).ok()? };
    k.xonly().ok().map(|_| k)
}

fn name_ok(n: &str) -> bool {
    let n = n.trim();
    !n.is_empty() && n.chars().count() <= 40 && !n.chars().any(|c| c.is_control() || matches!(c, '\u{200b}'..='\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}' | '\u{feff}'))
}

/// The list with `name` trusting `key` added (a key already there takes the new name).
pub fn with_approver(mut list: Vec<Approver>, name: &str, key: &PublicKey) -> Result<Vec<Approver>, Refusal> {
    if !name_ok(name) {
        return Err(no("bad_params", "A name is one short line."));
    }
    let hex = key.to_hex();
    // one name, one key: a second "Uni" beside the real one would read as Uni on the secret sheet
    if list.iter().any(|a| a.pubkey != hex && a.name.trim().eq_ignore_ascii_case(name.trim())) {
        return Err(no("bad_params", "Another key already has that name."));
    }
    list.retain(|a| a.pubkey != hex);
    if list.len() >= MAX_APPROVERS {
        return Err(no("bad_params", "At most 8 keys are trusted for approvals."));
    }
    list.push(Approver { name: name.trim().to_string(), pubkey: hex });
    Ok(list)
}

/// The keys an applet's `from` names that this device also trusts: the only ones whose cards are answered.
pub fn trusted_of(from: &[String], list: &[Approver]) -> Vec<PublicKey> {
    from.iter().filter(|k| list.iter().any(|a| &a.pubkey == *k)).filter_map(|k| PublicKey::from_hex(k).ok()).collect()
}

// ── the platform unlock ──

mod platform {
    use tauri::{AppHandle, Runtime};

    /// The screen-off count (Android), or None where no grace is given (or the app isn't in front).
    pub async fn epoch<R: Runtime>(_app: &AppHandle<R>) -> Option<u64> {
        #[cfg(target_os = "android")]
        {
            #[derive(serde::Deserialize)]
            struct E {
                epoch: u64,
                resumed: bool,
            }
            let h = handle(_app).ok()?;
            let e: E = h.run_mobile_plugin_async("epoch", serde_json::json!({})).await.ok()?;
            e.resumed.then_some(e.epoch)
        }
        #[cfg(not(target_os = "android"))]
        {
            None
        }
    }

    #[cfg(target_os = "android")]
    fn handle<R: Runtime>(app: &AppHandle<R>) -> Result<tauri::plugin::PluginHandle<R>, String> {
        use tauri::Manager;
        app.try_state::<crate::android::UnlockPluginHandle<R>>().map(|h| h.0.clone()).ok_or_else(|| "The device unlock isn't ready.".to_string())
    }

    pub async fn unlock<R: Runtime>(_app: &AppHandle<R>, _title: &str, _reason: &str) -> Result<(), String> {
        #[cfg(target_os = "android")]
        {
            handle(_app)?
                .run_mobile_plugin_async::<serde_json::Value>("authenticate", serde_json::json!({ "title": _title, "reason": _reason }))
                .await
                .map(|_| ())
                .map_err(|e| {
                    let m = e.to_string();
                    if m.contains("screen lock") { "Set a screen lock on this phone to approve this.".into() } else { "The device unlock was cancelled or failed.".into() }
                })
        }
        #[cfg(target_os = "macos")]
        {
            let reason = _reason.to_string();
            tauri::async_runtime::spawn_blocking(move || {
                use objc2_foundation::{NSError, NSString};
                use objc2_local_authentication::{LAContext, LAPolicy};
                let context = unsafe { LAContext::new() };
                let (send, receive) = std::sync::mpsc::sync_channel(1);
                let reply = block2::RcBlock::new(move |success: objc2::runtime::Bool, _error: *mut NSError| {
                    let _ = send.try_send(success.as_bool());
                });
                // LocalAuthentication owns its system UI; creating and waiting stay off the main thread (from the Uni app)
                unsafe { context.evaluatePolicy_localizedReason_reply(LAPolicy::DeviceOwnerAuthentication, &NSString::from_str(&reason), &reply) };
                let result = receive.recv_timeout(std::time::Duration::from_secs(60));
                unsafe { context.invalidate() };
                match result {
                    Ok(true) => Ok(()),
                    Ok(false) => Err("The device unlock was cancelled or failed.".to_string()),
                    Err(_) => Err("The device unlock timed out. Try again.".to_string()),
                }
            })
            .await
            .map_err(|_| "The device unlock failed.".to_string())?
        }
        #[cfg(all(not(target_os = "android"), not(target_os = "macos"), not(target_os = "ios")))]
        {
            // As the Uni app: no device unlock to ask here, so a native dialog the web side can't draw or answer.
            use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
            let app = _app.clone();
            let (title, reason) = (_title.to_string(), _reason.to_string());
            let ok = tauri::async_runtime::spawn_blocking(move || {
                app.dialog().message(reason).title(title).kind(MessageDialogKind::Warning).buttons(MessageDialogButtons::OkCancelCustom("Approve".into(), "Cancel".into())).blocking_show()
            })
            .await
            .map_err(|_| "The confirmation failed.".to_string())?;
            if ok { Ok(()) } else { Err("Cancelled: nothing was sent.".into()) }
        }
        #[cfg(target_os = "ios")]
        {
            Err("The device unlock isn't available here.".into())
        }
    }
}

// ── the commands (Settings → Keys) ──

#[derive(Serialize)]
pub struct KeyringStatus {
    pub everyday: String,
    pub approval: String,
    /// No separate approval key: the everyday key is it.
    pub same: bool,
    /// The sealing public key Uni seals cards to (hex), derived from the approval key.
    pub seal_pub: String,
    pub approvers: Vec<Approver>,
}

async fn everyday<R: Runtime>(app: &AppHandle<R>, keys: &KeyState) -> Result<Keys, Refusal> {
    keys.get(app).await.map_err(|m| no("no_key", m))?.ok_or_else(|| no("no_key", "This device has no key."))
}

async fn status_of<R: Runtime>(app: &AppHandle<R>, keys: &KeyState, ring: &KeyringState) -> Result<KeyringStatus, Refusal> {
    let e = everyday(app, keys).await?;
    let a = ring.approval(app, &e).await?;
    let seal = crate::approvals::seal_pub(&a).map_err(|_| no("refused", "The sealing key couldn't be made."))?;
    Ok(KeyringStatus {
        everyday: e.public_key().to_bech32().unwrap_or_default(),
        approval: a.public_key().to_bech32().unwrap_or_default(),
        same: ring.separate(app).await?.is_none(),
        seal_pub: seal.to_hex(),
        approvers: approvers(app)?,
    })
}

#[tauri::command]
pub async fn keyring_status<R: Runtime>(app: AppHandle<R>, keys: State<'_, KeyState>, ring: State<'_, KeyringState>) -> Result<KeyringStatus, Refusal> {
    status_of(&app, &keys, &ring).await
}

/// Make a separate approval key. Refused when one is there.
#[tauri::command]
pub async fn keyring_make_approval<R: Runtime>(app: AppHandle<R>, keys: State<'_, KeyState>, ring: State<'_, KeyringState>) -> Result<KeyringStatus, Refusal> {
    everyday(&app, &keys).await?;
    {
        let mut slot = ring.approval.lock().await;
        read(&mut slot, &app).await?;
        if !matches!(*slot, Slot::Same) {
            return Err(no("refused", "This device already has a separate approval key."));
        }
        let k = Keys::generate();
        let nsec = Zeroizing::new(k.secret_key().to_bech32().map_err(|_| no("refused", "The key couldn't be made."))?);
        store::save_which(&app, Which::Approval, &nsec).await.map_err(|m| no("storage", m))?;
        *slot = Slot::Held(k);
    }
    ring.end_grace();
    status_of(&app, &keys, &ring).await
}

/// Remove the separate approval key (the everyday key is the approval key again), after the device unlock.
#[tauri::command]
pub async fn keyring_remove_approval<R: Runtime>(app: AppHandle<R>, keys: State<'_, KeyState>, ring: State<'_, KeyringState>) -> Result<KeyringStatus, Refusal> {
    ring.confirm(&app, "settings", "remove-approval-key", false, "Remove the approval key", "Remove this device's approval key. Everything Uni sealed to it must be sealed again.").await?;
    {
        let mut slot = ring.approval.lock().await;
        store::clear_which(&app, Which::Approval).await.map_err(|m| no("storage", m))?;
        *slot = Slot::Same;
    }
    ring.end_grace();
    status_of(&app, &keys, &ring).await
}

/// The Uni app's enrollment event, signed by the approval key, for `sealed enroll` on the box Uni runs on. `room`: the
/// room id the event names (Buzz files a kind 9 by it); `uni`: the trusted key it is for.
#[tauri::command]
pub async fn keyring_enrollment<R: Runtime>(app: AppHandle<R>, keys: State<'_, KeyState>, ring: State<'_, KeyringState>, room: String, uni: String) -> Result<Event, Refusal> {
    if !crate::services::room_id_ok(&room) {
        return Err(no("bad_params", "A room id is as the relay names it."));
    }
    let uni = parse_public(&uni).ok_or_else(|| no("bad_params", "That isn't a public key."))?;
    if !approvers(&app)?.iter().any(|a| a.pubkey == uni.to_hex()) {
        return Err(no("bad_params", "Trust that key for approvals first."));
    }
    let e = everyday(&app, &keys).await?;
    let a = ring.approval(&app, &e).await?;
    crate::approvals::enrollment_event(&a, &uni, &room, nostr::Timestamp::now().as_secs()).map_err(|_| no("refused", "The enrollment couldn't be signed."))
}

#[tauri::command]
pub async fn approvers_add<R: Runtime>(app: AppHandle<R>, ring: State<'_, KeyringState>, name: String, key: String) -> Result<Vec<Approver>, Refusal> {
    let k = parse_public(&key).ok_or_else(|| no("bad_params", "That isn't a public key (npub1… or 64 hex characters)."))?;
    add_approver(&app, &ring, &name, &k).await
}

/// `key` trusted under `name`, behind the device unlock: the one way a key joins the list (Settings, or a card's offer).
pub async fn add_approver<R: Runtime>(app: &AppHandle<R>, ring: &KeyringState, name: &str, key: &PublicKey) -> Result<Vec<Approver>, Refusal> {
    let list = with_approver(approvers(app)?, name, key)?;
    let npub = key.to_bech32().unwrap_or_else(|_| key.to_hex());
    ring.confirm(app, "settings", "approvers", false, "Trust a key for approvals", &format!("Let {} ({npub}) ask this device for approvals and secrets.", name.trim())).await?;
    crate::services::write_json(&approvers_path(app)?, &list).map_err(|_| no("storage", "The list couldn't be kept."))?;
    Ok(list)
}

/// A card's author the grant names in `from` but the device's list doesn't have yet: what a card may offer to trust.
pub fn trust_offer(from: &[String], list: &[Approver], author: &str) -> bool {
    from.iter().any(|k| k.eq_ignore_ascii_case(author)) && !list.iter().any(|a| a.pubkey.eq_ignore_ascii_case(author))
}

#[tauri::command]
pub async fn approvers_remove<R: Runtime>(app: AppHandle<R>, ring: State<'_, KeyringState>, pubkey: String) -> Result<Vec<Approver>, Refusal> {
    let mut list = approvers(&app)?;
    let before = list.len();
    list.retain(|a| a.pubkey != pubkey);
    if list.len() == before {
        return Ok(list);
    }
    ring.confirm(&app, "settings", "approvers", false, "Stop trusting a key", "Stop answering approvals and secret requests from this key.").await?;
    crate::services::write_json(&approvers_path(&app)?, &list).map_err(|_| no("storage", "The list couldn't be kept."))?;
    ring.end_grace();
    Ok(list)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_card_offers_to_trust_only_a_key_its_grant_names_and_the_device_lacks() {
        let uni = Keys::generate().public_key().to_hex();
        let other = Keys::generate().public_key().to_hex();
        let from = vec![uni.clone()];
        // named by the grant, not on the list: offered (whatever the hex case)
        assert!(trust_offer(&from, &[], &uni));
        assert!(trust_offer(&[uni.to_uppercase()], &[], &uni));
        // a key the grant doesn't name: never, so an applet can't get its own key trusted from a card
        assert!(!trust_offer(&from, &[], &other));
        // already trusted: nothing to offer
        assert!(!trust_offer(&from, &[Approver { name: "Uni".into(), pubkey: uni.clone() }], &uni));
        // a second key can't take a name another key has (a fake "Uni" beside the real one)
        let list = vec![Approver { name: "Uni".into(), pubkey: uni.clone() }];
        assert!(with_approver(list.clone(), " uni ", &PublicKey::from_hex(&other).unwrap()).is_err());
        assert!(with_approver(list, "Uni", &PublicKey::from_hex(&uni).unwrap()).is_ok());
    }

    #[test]
    fn the_trusted_list_takes_plain_names_and_real_keys_and_trusts_only_what_both_name() {
        let k = Keys::generate().public_key();
        assert_eq!(parse_public(&k.to_bech32().unwrap()), Some(k));
        assert_eq!(parse_public(&k.to_hex()), Some(k));
        assert!(parse_public("npub1nothing").is_none());
        let list = with_approver(vec![], "Uni", &k).unwrap();
        assert_eq!(list, vec![Approver { name: "Uni".into(), pubkey: k.to_hex() }]);
        assert_eq!(with_approver(list.clone(), "Uni again", &k).unwrap().len(), 1, "a key once, with its newest name");
        for bad in ["", "   ", "a\nb", "a\u{202e}b", &"x".repeat(41)] {
            assert!(with_approver(vec![], bad, &k).is_err(), "{bad:?}");
        }
        let other = Keys::generate().public_key();
        // an applet naming a key the device doesn't trust gets nothing for it
        assert_eq!(trusted_of(&[k.to_hex(), other.to_hex()], &list), vec![k]);
        assert!(trusted_of(&[other.to_hex()], &list).is_empty());
        let full = (0..8).fold(vec![], |l, i| with_approver(l, &format!("k{i}"), &Keys::generate().public_key()).unwrap());
        assert!(with_approver(full, "one more", &k).is_err());
    }

    #[test]
    fn an_unreadable_list_is_an_error_not_an_empty_one() {
        let d = std::env::temp_dir().join(format!("parachute-approvers-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        let p = d.join(APPROVERS_FILE);
        assert_eq!(read_approvers(&p).unwrap(), vec![]);
        std::fs::write(&p, b"not json").unwrap();
        assert!(read_approvers(&p).is_err());
    }
}
