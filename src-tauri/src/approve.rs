// Approving code (docs/design/APP-RECORD.md "Running needs a signed approval"): the person's key signs "this exact
// code, asking exactly this" as a kind 30479 event, only here and only after the device unlock, every time (no grace).
// When this device's level for approving code is the passcode (Settings → Security; levels.rs), approving asks it too,
// checked here; the web side can ask for more but never for less. Taking an approval back asks only the unlock: it can only stop code. Applets can never reach this: their signing paths (services.rs) take only the kinds they
// declared from a short list, which 30479 and 30480 are not on (a test there says so).
//
// The passcode is its own secret, never the phone's unlock: a salted hash, many rounds, in the app's data folder.
// Five wrong in a row and it waits a minute.
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use nostr::hashes::{sha256, Hash, HashEngine};
use nostr::Event;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, Runtime, State};
use zeroize::Zeroizing;

use crate::door::Refusal;
use crate::key::KeyState;
use crate::keyring::KeyringState;

pub const APPROVAL_KIND: u16 = 30479;
pub const KEYS_KIND: u16 = 30480;
pub const PASSCODE_FILE: &str = "passcode.json";
const ROUNDS: u32 = 120_000;
const TRIES: u32 = 5;
const WAIT: Duration = Duration::from_secs(60);

fn no(code: &'static str, message: impl Into<String>) -> Refusal {
    Refusal { code, message: message.into() }
}
fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

#[derive(Serialize, Deserialize)]
struct Stored {
    salt: String,
    hash: String,
    rounds: u32,
}

fn digest(salt: &str, code: &str, rounds: u32) -> String {
    let mut e = sha256::Hash::engine();
    e.input(salt.as_bytes());
    e.input(code.as_bytes());
    let mut h = sha256::Hash::from_engine(e).to_byte_array();
    for _ in 1..rounds {
        let mut e = sha256::Hash::engine();
        e.input(&h);
        e.input(salt.as_bytes());
        h = sha256::Hash::from_engine(e).to_byte_array();
    }
    hex(&h)
}

fn read(path: &Path) -> Result<Option<Stored>, Refusal> {
    match std::fs::read(path) {
        Ok(b) => serde_json::from_slice(&b).map(Some).map_err(|_| no("storage", "The passcode can't be read.")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(no("storage", "The passcode can't be read.")),
    }
}

/// Whether a passcode is kept at `path`.
pub fn passcode_kept(path: &Path) -> Result<bool, Refusal> {
    Ok(read(path)?.is_some())
}

fn code_ok(code: &str) -> bool {
    (4..=64).contains(&code.chars().count()) && !code.chars().any(char::is_control)
}

/// Wrong tries: after TRIES in a row, nothing is checked until WAIT has passed.
#[derive(Default)]
pub struct PasscodeState(Mutex<(u32, Option<Instant>)>);

impl PasscodeState {
    /// Check `code` against what is kept at `path`. With no passcode kept, there is nothing to check.
    pub fn check(&self, path: &Path, code: Option<&str>) -> Result<(), Refusal> {
        let Some(s) = read(path)? else { return Ok(()) };
        let mut g = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(until) = g.1 {
            if Instant::now() < until {
                return Err(no("passcode", "Too many wrong passcodes. Try again in a minute."));
            }
            *g = (0, None);
        }
        let Some(code) = code else { return Err(no("passcode", "Your passcode is needed for this.")) };
        if digest(&s.salt, code, s.rounds) == s.hash {
            *g = (0, None);
            return Ok(());
        }
        g.0 += 1;
        if g.0 >= TRIES {
            g.1 = Some(Instant::now() + WAIT);
        }
        Err(no("passcode", "That passcode isn't it."))
    }
}

/// Keep a new passcode (or with None, none), the old one checked first when there is one.
pub fn set(path: &Path, state: &PasscodeState, old: Option<&str>, new: Option<&str>) -> Result<(), Refusal> {
    state.check(path, old)?;
    match new {
        None => match std::fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err(no("storage", "The passcode couldn't be removed.")),
        },
        Some(code) => {
            if !code_ok(code) {
                return Err(no("bad_request", "A passcode is 4 to 64 characters."));
            }
            let salt = hex(&nostr::secp256k1::rand::random::<[u8; 16]>());
            let s = Stored { hash: digest(&salt, code, ROUNDS), salt, rounds: ROUNDS };
            if let Some(dir) = path.parent() {
                std::fs::create_dir_all(dir).map_err(|_| no("storage", "The app's data folder can't be written."))?;
            }
            let tmp = path.with_extension("json.tmp");
            std::fs::write(&tmp, serde_json::to_vec(&s).unwrap_or_default()).and_then(|_| std::fs::rename(&tmp, path)).map_err(|_| no("storage", "The passcode couldn't be kept."))
        }
    }
}

fn passcode_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, Refusal> {
    Ok(app.path().app_data_dir().map_err(|_| no("storage", "The app's data folder isn't available."))?.join(PASSCODE_FILE))
}

/// What may be signed as an approval: its content is the approval's own shape, and `d` names the same applet.
pub fn check_content(content: &str, d: &str) -> Result<(), Refusal> {
    let v: Value = serde_json::from_str(content).map_err(|_| no("bad_request", "An approval is JSON."))?;
    let o = v.as_object().ok_or_else(|| no("bad_request", "An approval is a JSON object."))?;
    let s = o.get("subject").and_then(Value::as_object).ok_or_else(|| no("bad_request", "An approval names its applet."))?;
    let part = |k: &str| s.get(k).and_then(Value::as_str).unwrap_or("");
    if o.get("v").and_then(Value::as_u64) != Some(1) || o.get("approved").and_then(Value::as_bool).is_none() || o.get("n").and_then(Value::as_u64).is_none() {
        return Err(no("bad_request", "That isn't an approval."));
    }
    if d.len() > 600 || content.len() > 64 * 1024 || d != format!("{}|{}|{}", part("hub"), part("vault"), part("record")) || part("record").is_empty() {
        return Err(no("bad_request", "The approval names another applet than it says."));
    }
    Ok(())
}

/// Sign an approval (or a taking back) of an applet's exact code and asks: this device's level for approving code (the
/// passcode, when it says so, then the device unlock; levels.rs), the unlock alone for a taking back.
#[tauri::command]
pub async fn approval_sign<R: Runtime>(app: AppHandle<R>, keys: State<'_, KeyState>, ring: State<'_, KeyringState>, levels: State<'_, crate::levels::LevelsState>, content: String, d: String, name: String, passcode: Option<String>) -> Result<Event, Refusal> {
    check_content(&content, &d)?;
    let name: String = name.chars().filter(|c| !c.is_control()).take(60).collect();
    let passcode = passcode.map(Zeroizing::new);
    let approved = serde_json::from_str::<Value>(&content).ok().and_then(|v| v.get("approved").and_then(Value::as_bool)).unwrap_or(false);
    // approving takes this device's code level (never below the unlock); taking an approval back only stops code: it
    // takes the unlock (it signs with the key), never the passcode
    let level = if approved { levels.levels(&app).await?.code.max(crate::levels::Level::Unlock) } else { crate::levels::Level::Unlock };
    let (title, reason) = if approved {
        (format!("Approve «{name}»"), format!("Approve this exact version of «{name}» on every device of yours"))
    } else {
        (format!("Stop «{name}»"), format!("Take back your approval of «{name}» on every device of yours"))
    };
    levels.gate(&app, level, passcode.as_ref().map(|p| p.as_str()), || ring.confirm(&app, "approve-code", &d, false, &title, &reason)).await?;
    let k = keys.get(&app).await.map_err(|m| no("no_key", m))?.ok_or_else(|| no("no_key", "This device has no key."))?;
    crate::services::sign_template(&k, APPROVAL_KIND, &content, &[vec!["d".into(), d]])
}

#[tauri::command]
pub async fn passcode_status<R: Runtime>(app: AppHandle<R>) -> Result<bool, Refusal> {
    Ok(read(&passcode_path(&app)?)?.is_some())
}

/// Set, change or remove this device's passcode: the old one, then the device unlock.
#[tauri::command]
pub async fn passcode_set<R: Runtime>(app: AppHandle<R>, ring: State<'_, KeyringState>, codes: State<'_, PasscodeState>, old: Option<String>, new: Option<String>) -> Result<(), Refusal> {
    let (old, new) = (old.map(Zeroizing::new), new.map(Zeroizing::new));
    let path = passcode_path(&app)?;
    codes.check(&path, old.as_ref().map(|p| p.as_str()))?;
    ring.confirm(&app, "passcode", "passcode", false, "Your passcode", "Change the passcode Parachute asks for what you set to need it").await?;
    set(&path, &codes, old.as_ref().map(|p| p.as_str()), new.as_ref().map(|p| p.as_str()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> PathBuf {
        let d = std::env::temp_dir().join(format!("parachute-pass-{}-{}", std::process::id(), hex(&nostr::secp256k1::rand::random::<[u8; 8]>())));
        std::fs::create_dir_all(&d).unwrap();
        d.join(PASSCODE_FILE)
    }

    #[test]
    fn with_no_passcode_nothing_is_asked_with_one_only_it_passes() {
        let (p, s) = (tmp(), PasscodeState::default());
        assert!(s.check(&p, None).is_ok());
        set(&p, &s, None, Some("garden-gate")).unwrap();
        assert!(s.check(&p, None).is_err());
        assert!(s.check(&p, Some("garden-gat")).is_err());
        assert!(s.check(&p, Some("garden-gate")).is_ok());
        // changing it needs the old one
        assert!(set(&p, &s, Some("wrong"), Some("new-code")).is_err());
        set(&p, &s, Some("garden-gate"), Some("new-code")).unwrap();
        assert!(s.check(&p, Some("new-code")).is_ok());
        assert!(!std::fs::read_to_string(&p).unwrap().contains("new-code"));
        set(&p, &s, Some("new-code"), None).unwrap();
        assert!(s.check(&p, None).is_ok());
    }

    #[test]
    fn five_wrong_passcodes_wait_a_minute_even_for_the_right_one() {
        let (p, s) = (tmp(), PasscodeState::default());
        set(&p, &s, None, Some("garden-gate")).unwrap();
        for _ in 0..TRIES {
            assert!(s.check(&p, Some("nope")).is_err());
        }
        assert_eq!(s.check(&p, Some("garden-gate")).unwrap_err().message, "Too many wrong passcodes. Try again in a minute.");
    }

    #[test]
    fn only_an_approval_for_the_applet_it_names_is_signed() {
        let c = r#"{"v":1,"subject":{"hub":"https://uni.example","vault":"home","record":"01R","applet":"rooms"},"n":5,"approved":true,"code":"c","scope":"s"}"#;
        assert!(check_content(c, "https://uni.example|home|01R").is_ok());
        assert!(check_content(c, "https://uni.example|home|01OTHER").is_err());
        assert!(check_content(r#"{"kind":9,"content":"hello"}"#, "x|y|z").is_err());
        assert!(check_content("not json", "x").is_err());
    }
}
