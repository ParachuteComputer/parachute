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
        Ok(match &*slot {
            Slot::Held(k) => Some(k.clone()),
            _ => None,
        })
    }

    /// Keep `keys` as this device's key. A device holds one key: another is refused until this one is removed.
    pub async fn install<R: Runtime>(&self, app: &AppHandle<R>, keys: Keys) -> Result<KeyInfo, String> {
        let mut slot = self.0.lock().await;
        read(&mut slot, app).await?;
        if let Slot::Held(_) = *slot {
            return Err("This device already has a key. Remove it in Settings first.".into());
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

async fn read<R: Runtime>(slot: &mut Slot, app: &AppHandle<R>) -> Result<(), String> {
    if let Slot::Unread = *slot {
        *slot = match store::load(app).await? {
            Some(secret) => Slot::Held(parse_secret(&secret).map_err(|_| "The key kept on this device can't be read.".to_string())?),
            None => Slot::Empty,
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

#[tauri::command]
pub async fn key_status<R: Runtime>(app: AppHandle<R>, state: State<'_, KeyState>) -> Result<Option<KeyInfo>, String> {
    Ok(state.get(&app).await?.as_ref().map(KeyInfo::of))
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

    #[cfg(not(target_os = "android"))]
    fn entry() -> Result<keyring::Entry, String> {
        keyring::Entry::new("computer.parachute.app", "nostr-key").map_err(|e| format!("This computer's keyring can't be used ({e})."))
    }

    pub async fn load<R: Runtime>(_app: &AppHandle<R>) -> Result<Option<Zeroizing<String>>, String> {
        #[cfg(target_os = "android")]
        {
            #[derive(serde::Deserialize)]
            struct Loaded {
                secret: Option<String>,
            }
            let loaded: Loaded = plugin(_app)?
                .run_mobile_plugin_async("loadSecret", serde_json::json!({ "name": SLOT }))
                .await
                .map_err(|_| "The key store couldn't be read.".to_string())?;
            Ok(loaded.secret.map(Zeroizing::new))
        }
        #[cfg(not(target_os = "android"))]
        {
            tauri::async_runtime::spawn_blocking(|| match entry()?.get_password() {
                Ok(s) => Ok(Some(Zeroizing::new(s))),
                Err(keyring::Error::NoEntry) => Ok(None),
                Err(e) => Err(format!("This computer's keyring couldn't be read ({e}).")),
            })
            .await
            .map_err(|e| e.to_string())?
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
            tauri::async_runtime::spawn_blocking(move || entry()?.set_password(&nsec).map_err(|e| format!("The key couldn't be kept in this computer's keyring ({e}).")))
                .await
                .map_err(|e| e.to_string())?
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
            tauri::async_runtime::spawn_blocking(|| match entry()?.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(e) => Err(format!("The key couldn't be removed from this computer's keyring ({e}).")),
            })
            .await
            .map_err(|e| e.to_string())?
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

    #[test]
    fn info_is_public_only() {
        let k = Keys::generate();
        let shown = serde_json::to_string(&KeyInfo::of(&k)).unwrap();
        assert!(shown.contains(&k.public_key().to_bech32().unwrap()));
        assert!(!shown.contains(&k.secret_key().to_bech32().unwrap()));
        assert!(!shown.contains(&k.secret_key().to_secret_hex()));
    }
}
