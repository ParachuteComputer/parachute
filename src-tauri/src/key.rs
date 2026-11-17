//! The person's Nostr key. It is made here, pasted in, or paired in from a device that has it (pairing.rs), and it
//! stays in the shell: kept in the platform's secure storage (Android Keystore through `KeyPlugin.kt`, the desktop's
//! keyring), held in memory here, and used only to sign the hub's sign-in (door.rs). No command hands it to the web
//! side; the web side learns only the public key.

use nostr::nips::nip19::ToBech32;
use nostr::Keys;
use serde::Serialize;
use tauri::{AppHandle, Runtime, State};
use tokio::sync::Mutex;
use zeroize::Zeroizing;

/// What the web side may know about the key: its public half.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct KeyInfo {
    pub npub: String,
}

impl KeyInfo {
    pub fn of(keys: &Keys) -> Self {
        KeyInfo { npub: keys.public_key().to_bech32().unwrap_or_default() }
    }
}

enum Slot {
    /// Storage not read yet this run.
    Unread,
    Empty,
    Held(Keys),
    /// Something is stored but can't be read (storage refused, or not a key): only removing it helps.
    Unreadable(String),
}

/// The key this device holds, once read from storage.
pub struct KeyState(Mutex<Slot>);

impl Default for KeyState {
    fn default() -> Self {
        KeyState(Mutex::new(Slot::Unread))
    }
}

impl KeyState {
    /// The key, reading storage the first time.
    pub async fn get<R: Runtime>(&self, app: &AppHandle<R>) -> Result<Option<Keys>, String> {
        let mut slot = self.0.lock().await;
        read(&mut slot, app).await?;
        match &*slot {
            Slot::Held(k) => Ok(Some(k.clone())),
            Slot::Unreadable(why) => Err(why.clone()),
            _ => Ok(None),
        }
    }

    /// Keep `keys` as this device's key. A device holds one key: another is refused until this one is removed.
    pub async fn install<R: Runtime>(&self, app: &AppHandle<R>, keys: Keys) -> Result<KeyInfo, String> {
        let mut slot = self.0.lock().await;
        read(&mut slot, app).await?;
        match &*slot {
            Slot::Held(_) => return Err("This device already has a key. Remove it in Settings first.".into()),
            Slot::Unreadable(_) => return Err("The key kept on this device can't be read. Remove it in Settings first.".into()),
            _ => {}
        }
        let nsec = Zeroizing::new(keys.secret_key().to_bech32().map_err(|_| "Couldn't encode the key.".to_string())?);
        store::save(app, &nsec).await?;
        let info = KeyInfo::of(&keys);
        *slot = Slot::Held(keys);
        Ok(info)
    }

    /// Does the device hold a key? (Pairing asks before it starts.)
    pub async fn holds<R: Runtime>(&self, app: &AppHandle<R>) -> Result<bool, String> {
        Ok(self.get(app).await?.is_some())
    }

    async fn forget<R: Runtime>(&self, app: &AppHandle<R>) -> Result<(), String> {
        let mut slot = self.0.lock().await;
        store::clear(app).await?;
        *slot = Slot::Empty;
        Ok(())
    }
}

/// Read storage once a run. A storage error is tried again next time; a stored value that isn't a key stays unreadable.
async fn read<R: Runtime>(slot: &mut Slot, app: &AppHandle<R>) -> Result<(), String> {
    if let Slot::Unread = *slot {
        let unreadable = || Slot::Unreadable("The key kept on this device can't be read.".into());
        *slot = match store::load(app).await? {
            store::Stored::Secret(secret) => parse_secret(&secret).map(Slot::Held).unwrap_or_else(|()| unreadable()),
            store::Stored::Unreadable => unreadable(),
            store::Stored::Nothing => Slot::Empty,
        };
    }
    Ok(())
}

/// A secret key as a person might paste it: `nsec1…`, or 64 hex characters.
pub fn parse_secret(raw: &str) -> Result<Keys, ()> {
    let raw = raw.trim();
    if raw.starts_with("npub1") {
        return Err(());
    }
    Keys::parse(raw).map_err(|_| ())
}

/// Why the key can't be shown: `unavailable` (storage didn't answer this time: try again; the key may be fine) or
/// `unreadable` (what is stored isn't a key: only removing it helps).
#[derive(Serialize)]
pub struct KeyProblem {
    code: &'static str,
    message: String,
}

#[tauri::command]
pub async fn key_status<R: Runtime>(app: AppHandle<R>, state: State<'_, KeyState>) -> Result<Option<KeyInfo>, KeyProblem> {
    let mut slot = state.0.lock().await;
    read(&mut slot, &app).await.map_err(|message| KeyProblem { code: "unavailable", message })?;
    match &*slot {
        Slot::Held(k) => Ok(Some(KeyInfo::of(k))),
        Slot::Unreadable(message) => Err(KeyProblem { code: "unreadable", message: message.clone() }),
        _ => Ok(None),
    }
}

/// Make a new key for someone who has none.
#[tauri::command]
pub async fn key_create<R: Runtime>(app: AppHandle<R>, state: State<'_, KeyState>) -> Result<KeyInfo, String> {
    state.install(&app, Keys::generate()).await
}

/// Keep a pasted secret key. The text never comes back out.
#[tauri::command]
pub async fn key_import<R: Runtime>(app: AppHandle<R>, state: State<'_, KeyState>, secret: String) -> Result<KeyInfo, String> {
    let secret = Zeroizing::new(secret);
    if secret.trim().starts_with("npub1") {
        return Err("That's a public key (npub). Paste the secret key, which starts with nsec1.".into());
    }
    let keys = parse_secret(&secret).map_err(|_| "That isn't a Nostr secret key. It starts with nsec1.".to_string())?;
    state.install(&app, keys).await
}

/// Remove the key from this device.
#[tauri::command]
pub async fn key_forget<R: Runtime>(app: AppHandle<R>, state: State<'_, KeyState>) -> Result<(), String> {
    state.forget(&app).await
}

/// The platform's secure storage for the one secret this app keeps.
mod store {
    use tauri::{AppHandle, Runtime};
    use zeroize::Zeroizing;

    #[cfg(target_os = "android")]
    const SLOT: &str = "nostr_key";

    #[cfg(target_os = "android")]
    fn plugin<R: Runtime>(app: &AppHandle<R>) -> Result<tauri::plugin::PluginHandle<R>, String> {
        use tauri::Manager;
        app.try_state::<crate::android::KeyPluginHandle<R>>().map(|h| h.0.clone()).ok_or_else(|| "The key store isn't ready.".to_string())
    }

    /// What storage holds: a secret, nothing, or something that will never read as one.
    pub enum Stored {
        Secret(Zeroizing<String>),
        Nothing,
        Unreadable,
    }

    /// Desktop: one item in the OS keyring (macOS Keychain, Windows Credential Manager, Linux Secret Service), filed
    /// under the app's identifier. The account is a parameter only so a test can use its own item.
    #[cfg(not(target_os = "android"))]
    pub(super) mod desktop {
        use super::Stored;
        use zeroize::Zeroizing;

        pub const SERVICE: &str = "computer.parachute.app";
        pub const ACCOUNT: &str = "nostr-key";

        fn entry(account: &str) -> Result<keyring::Entry, String> {
            keyring::Entry::new(SERVICE, account).map_err(|e| format!("This computer's keyring can't be used ({e})."))
        }

        pub fn load(account: &str) -> Result<Stored, String> {
            match entry(account)?.get_password() {
                Ok(s) => Ok(Stored::Secret(Zeroizing::new(s))),
                Err(keyring::Error::NoEntry) => Ok(Stored::Nothing),
                Err(keyring::Error::BadEncoding(_)) => Ok(Stored::Unreadable),
                Err(e) => Err(format!("This computer's keyring couldn't be read ({e}).")),
            }
        }

        pub fn save(account: &str, nsec: &str) -> Result<(), String> {
            entry(account)?.set_password(nsec).map_err(|e| format!("The key couldn't be kept in this computer's keyring ({e})."))
        }

        pub fn clear(account: &str) -> Result<(), String> {
            match entry(account)?.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(e) => Err(format!("The key couldn't be removed from this computer's keyring ({e}).")),
            }
        }
    }

    /// An `Err` is storage not answering this time (try again); `Unreadable` is for good.
    pub async fn load<R: Runtime>(_app: &AppHandle<R>) -> Result<Stored, String> {
        #[cfg(target_os = "android")]
        {
            #[derive(serde::Deserialize)]
            struct Loaded {
                secret: Option<String>,
                #[serde(default)]
                unreadable: bool,
            }
            let loaded: Loaded = plugin(_app)?
                .run_mobile_plugin_async("loadSecret", serde_json::json!({ "name": SLOT }))
                .await
                .map_err(|_| "The key store couldn't be read. Try again, or close and reopen the app.".to_string())?;
            Ok(match (loaded.secret, loaded.unreadable) {
                (_, true) => Stored::Unreadable,
                (Some(s), _) => Stored::Secret(Zeroizing::new(s)),
                (None, _) => Stored::Nothing,
            })
        }
        #[cfg(not(target_os = "android"))]
        {
            tauri::async_runtime::spawn_blocking(|| desktop::load(desktop::ACCOUNT)).await.map_err(|e| e.to_string())?
        }
    }

    pub async fn save<R: Runtime>(_app: &AppHandle<R>, nsec: &Zeroizing<String>) -> Result<(), String> {
        #[cfg(target_os = "android")]
        {
            #[derive(serde::Serialize)]
            struct Args<'a> {
                name: &'a str,
                secret: &'a str,
            }
            plugin(_app)?
                .run_mobile_plugin_async::<serde_json::Value>("saveSecret", Args { name: SLOT, secret: nsec.as_str() })
                .await
                .map_err(|_| "The key couldn't be kept on this device.".to_string())?;
            Ok(())
        }
        #[cfg(not(target_os = "android"))]
        {
            let nsec = nsec.clone();
            tauri::async_runtime::spawn_blocking(move || desktop::save(desktop::ACCOUNT, &nsec)).await.map_err(|e| e.to_string())?
        }
    }

    pub async fn clear<R: Runtime>(_app: &AppHandle<R>) -> Result<(), String> {
        #[cfg(target_os = "android")]
        {
            plugin(_app)?
                .run_mobile_plugin_async::<serde_json::Value>("clearSecret", serde_json::json!({ "name": SLOT }))
                .await
                .map_err(|_| "The key couldn't be removed.".to_string())?;
            Ok(())
        }
        #[cfg(not(target_os = "android"))]
        {
            tauri::async_runtime::spawn_blocking(|| desktop::clear(desktop::ACCOUNT)).await.map_err(|e| e.to_string())?
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secrets_as_pasted() {
        let k = Keys::generate();
        let nsec = k.secret_key().to_bech32().unwrap();
        assert_eq!(parse_secret(&format!("  {nsec}\n")).unwrap().public_key(), k.public_key());
        assert_eq!(parse_secret(&k.secret_key().to_secret_hex()).unwrap().public_key(), k.public_key());
        assert!(parse_secret(&k.public_key().to_bech32().unwrap()).is_err(), "a public key is not a secret");
        assert!(parse_secret("nsec1notakey").is_err());
        assert!(parse_secret("").is_err());
    }

    /// The Mac keeps the key in the login Keychain, not in a stub: what is saved is there for `security` to find, reads
    /// back as the same key, and is gone after clearing. (Runs on macOS: the Mac workflow, .github/workflows/mac.yml.)
    #[cfg(target_os = "macos")]
    #[test]
    fn the_mac_keeps_the_key_in_its_keychain() {
        use super::store::{desktop, Stored};
        let account = format!("nostr-key-test-{}", std::process::id());
        let in_keychain = || {
            std::process::Command::new("security")
                .args(["find-generic-password", "-s", desktop::SERVICE, "-a", &account])
                .output()
                .unwrap()
                .status
                .success()
        };
        // the test's item goes even when an assertion fails
        struct Cleanup<'a>(&'a str);
        impl Drop for Cleanup<'_> {
            fn drop(&mut self) {
                let _ = desktop::clear(self.0);
            }
        }
        let _cleanup = Cleanup(&account);
        let k = Keys::generate();
        let nsec = k.secret_key().to_bech32().unwrap();
        assert!(matches!(desktop::load(&account).unwrap(), Stored::Nothing));
        desktop::save(&account, &nsec).unwrap();
        let kept = in_keychain();
        let back = desktop::load(&account);
        desktop::clear(&account).unwrap();
        assert!(kept, "the key is an item in the macOS Keychain");
        match back.unwrap() {
            Stored::Secret(s) => assert_eq!(parse_secret(&s).unwrap().public_key(), k.public_key()),
            _ => panic!("the key reads back"),
        }
        assert!(!in_keychain(), "clearing removes the Keychain item");
        assert!(matches!(desktop::load(&account).unwrap(), Stored::Nothing));
    }

    #[test]
    fn info_is_public_only() {
        let k = Keys::generate();
        let shown = serde_json::to_string(&KeyInfo::of(&k)).unwrap();
        assert!(shown.contains(&k.public_key().to_bech32().unwrap()));
        assert!(!shown.contains(&k.secret_key().to_bech32().unwrap()));
        assert!(!shown.contains(&k.secret_key().to_secret_hex()));
    }
}
