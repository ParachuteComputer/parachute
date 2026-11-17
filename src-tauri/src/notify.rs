//! Notifications while the app is closed (docs/design/KEYRING.md, "Notifications while closed"). The web side hands the
//! list of what granted applets asked to be told about to `notify_set`; it is checked here and passed to Android's
//! `NotifyPlugin.kt`, which keeps it and runs `NotifyService.kt`: a foreground service with its own relay connection.
//!
//! The service signs exactly one thing with the person's key, through [`sign_auth`] over JNI: the relay's NIP-42
//! sign-in (kind 22242, the relay and the challenge, nothing else). It never sees the key's text beyond the bytes it
//! decrypts from the Keystore for that one call, and zeroes them after.
//!
//! Desktop: not in this step; `notify_set` answers that it is Android only.

use nostr::JsonUtil;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime, State};
use url::Url;

use crate::key::{parse_secret, KeyState};

pub const MAX_ENTRIES: usize = 8;
pub const MAX_ROOMS: usize = 50;
pub const MAX_FROM: usize = 4;
const MAX_SUBJECT: usize = 200;
const MAX_NAME: usize = 80;
const MAX_ROOM_ID: usize = 128;

/// One granted applet's ask: tell the person about new messages on `relay`, in `rooms` (or every room they are in),
/// that name them (`mentions`) or come from one of the `from` keys. `subject` and `name` are the applet (which one a
/// tap opens, and how it is called).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct NotifyEntry {
    pub relay: String,
    pub me: String,
    pub rooms: Option<Vec<String>>,
    #[serde(default)]
    pub mentions: bool,
    #[serde(default)]
    pub from: Vec<String>,
    pub subject: String,
    pub name: String,
}

fn is_hex_key(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// A relay's address: ws or wss, with a host, and nothing that isn't an address (no user, no fragment).
fn relay_url(raw: &str) -> Result<Url, String> {
    let u = Url::parse(raw).map_err(|_| format!("{raw} isn't a relay's address"))?;
    if !matches!(u.scheme(), "ws" | "wss") || u.host_str().is_none() || !u.username().is_empty() || u.password().is_some() || u.fragment().is_some() {
        return Err(format!("{raw} isn't a relay's address (ws:// or wss://)"));
    }
    Ok(u)
}

fn line(s: &str, max: usize) -> bool {
    !s.trim().is_empty() && s.chars().count() <= max && !s.chars().any(char::is_control)
}

/// The list as the service may keep it. `me` must be the key this device holds: it is the key the service signs in with.
pub fn validate(entries: &[NotifyEntry], me: Option<&str>) -> Result<(), String> {
    if entries.len() > MAX_ENTRIES {
        return Err(format!("At most {MAX_ENTRIES} applets can ask for notifications."));
    }
    for e in entries {
        relay_url(&e.relay)?;
        if !is_hex_key(&e.me) {
            return Err("`me` isn't a public key (64 hex characters).".into());
        }
        if me != Some(e.me.as_str()) {
            return Err("`me` isn't the key this device holds.".into());
        }
        if let Some(rooms) = &e.rooms {
            if rooms.is_empty() || rooms.len() > MAX_ROOMS {
                return Err(format!("An applet names 1 to {MAX_ROOMS} rooms, or none for all of them."));
            }
            if !rooms.iter().all(|r| !r.is_empty() && r.len() <= MAX_ROOM_ID && r.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.')) {
                return Err("A room id isn't one the relay makes.".into());
            }
        }
        if e.from.len() > MAX_FROM || !e.from.iter().all(|k| is_hex_key(k)) {
            return Err(format!("`from` is up to {MAX_FROM} public keys (64 hex characters)."));
        }
        if !e.mentions && e.from.is_empty() {
            return Err("An applet asks for mentions, or names who it hears from, or both.".into());
        }
        if !line(&e.subject, MAX_SUBJECT) || !line(&e.name, MAX_NAME) {
            return Err("An applet's subject and name are short lines.".into());
        }
    }
    Ok(())
}

/// The relay's sign-in, and only that: kind 22242 with the relay and the challenge, signed with the kept key (its text,
/// as Android keeps it). `None` for anything else: a relay that isn't ws/wss, a challenge that isn't a short line, a key
/// that doesn't parse.
pub fn sign_auth(secret: &[u8], relay: &str, challenge: &str) -> Option<String> {
    let secret = std::str::from_utf8(secret).ok()?;
    let keys = parse_secret(secret).ok()?;
    relay_url(relay).ok()?;
    crate::services::relay_auth_event(&keys, relay, challenge).ok().map(|ev| ev.as_json())
}

/// `NotifyService.signAuth(secret: ByteArray, relay: String, challenge: String): String?`. The bytes are copied into a
/// buffer that is zeroed when dropped; the service zeroes its own array.
#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_computer_parachute_app_NotifyService_signAuth<'l>(
    mut env: jni::JNIEnv<'l>,
    _class: jni::objects::JClass<'l>,
    secret: jni::objects::JByteArray<'l>,
    relay: jni::objects::JString<'l>,
    challenge: jni::objects::JString<'l>,
) -> jni::sys::jstring {
    let signed = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let secret = zeroize::Zeroizing::new(env.convert_byte_array(&secret).ok()?);
        let relay: String = env.get_string(&relay).ok()?.into();
        let challenge: String = env.get_string(&challenge).ok()?.into();
        sign_auth(&secret, &relay, &challenge)
    }))
    .ok()
    .flatten();
    match signed.and_then(|json| env.new_string(json).ok()) {
        Some(s) => s.into_raw(),
        None => std::ptr::null_mut(),
    }
}

/// Android's `NotifyPlugin.kt`, reachable from Rust only.
#[cfg(target_os = "android")]
pub struct NotifyPluginHandle<R: Runtime>(pub tauri::plugin::PluginHandle<R>);

pub fn plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::<R>::new("parachute-notify")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                use tauri::Manager;
                let handle = _api.register_android_plugin("computer.parachute.app", "NotifyPlugin")?;
                _app.manage(NotifyPluginHandle(handle));
            }
            Ok(())
        })
        .build()
}

/// Keep what granted applets asked to be told about, and start or stop the service to match (an empty list stops it).
/// Answers the service's state: `{ running, permission, entries }`, or on desktop `{ android_only: true }`.
#[tauri::command]
pub async fn notify_set<R: Runtime>(app: AppHandle<R>, state: State<'_, KeyState>, mut entries: Vec<NotifyEntry>) -> Result<serde_json::Value, String> {
    // `from` counts only for keys this device trusts (docs/design/KEYRING.md); an entry left asking for nothing goes
    let trusted = crate::keyring::approvers(&app).map_err(|r| r.message)?;
    for e in entries.iter_mut() {
        e.from.retain(|k| trusted.iter().any(|a| &a.pubkey == k));
    }
    entries.retain(|e| e.mentions || !e.from.is_empty());
    let me = state.get(&app).await?.map(|k| k.public_key().to_hex());
    if !entries.is_empty() && me.is_none() {
        return Err("This device has no key to sign in to a relay with.".into());
    }
    validate(&entries, me.as_deref())?;
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        let plugin = app.try_state::<NotifyPluginHandle<R>>().map(|h| h.0.clone()).ok_or("Notifications aren't ready.")?;
        let entries = serde_json::to_string(&entries).map_err(|e| e.to_string())?;
        plugin
            .run_mobile_plugin_async::<serde_json::Value>("configure", serde_json::json!({ "entries": entries }))
            .await
            .map_err(|e| format!("Notifications couldn't be set up ({e})."))
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, entries);
        Ok(serde_json::json!({ "android_only": true, "note": "Notifications while the app is closed are Android only for now." }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nostr::nips::nip19::ToBech32;
    use nostr::{Event, Keys};

    fn entry(me: &str) -> NotifyEntry {
        NotifyEntry {
            relay: "wss://relay.example".into(),
            me: me.into(),
            rooms: None,
            mentions: true,
            from: vec![],
            subject: "rooms".into(),
            name: "Rooms".into(),
        }
    }

    #[test]
    fn the_list_is_checked() {
        let me = Keys::generate().public_key().to_hex();
        let other = Keys::generate().public_key().to_hex();
        let ok = |e: NotifyEntry| validate(&[e], Some(&me));
        assert!(ok(entry(&me)).is_ok());
        assert!(validate(&[], None).is_ok(), "an empty list stops the service");
        assert!(validate(&vec![entry(&me); MAX_ENTRIES], Some(&me)).is_ok());
        assert!(validate(&vec![entry(&me); MAX_ENTRIES + 1], Some(&me)).is_err());
        assert!(ok(entry(&other)).is_err(), "`me` is the device's key");
        assert!(validate(&[entry(&me)], None).is_err(), "no key, nothing to sign in with");
        for relay in ["https://relay.example", "relay.example", "ws://", "wss://u:p@relay.example", "wss://relay.example/#x"] {
            assert!(ok(NotifyEntry { relay: relay.into(), ..entry(&me) }).is_err(), "{relay}");
        }
        assert!(ok(NotifyEntry { relay: "ws://localhost:3871".into(), ..entry(&me) }).is_ok());
        let rooms = |n: usize| Some((0..n).map(|i| format!("room-{i}")).collect::<Vec<_>>());
        assert!(ok(NotifyEntry { rooms: rooms(MAX_ROOMS), ..entry(&me) }).is_ok());
        assert!(ok(NotifyEntry { rooms: rooms(MAX_ROOMS + 1), ..entry(&me) }).is_err());
        assert!(ok(NotifyEntry { rooms: Some(vec![]), ..entry(&me) }).is_err());
        assert!(ok(NotifyEntry { rooms: Some(vec!["a b".into()]), ..entry(&me) }).is_err());
        assert!(ok(NotifyEntry { from: vec![other.clone(); MAX_FROM], ..entry(&me) }).is_ok());
        assert!(ok(NotifyEntry { from: vec![other.clone(); MAX_FROM + 1], ..entry(&me) }).is_err());
        assert!(ok(NotifyEntry { from: vec![other.to_uppercase()], ..entry(&me) }).is_err());
        assert!(ok(NotifyEntry { mentions: false, ..entry(&me) }).is_err(), "asks for something");
        assert!(ok(NotifyEntry { mentions: false, from: vec![other.clone()], ..entry(&me) }).is_ok());
        assert!(ok(NotifyEntry { subject: "".into(), ..entry(&me) }).is_err());
        assert!(ok(NotifyEntry { name: "a\nb".into(), ..entry(&me) }).is_err());
        let extra: Result<Vec<NotifyEntry>, _> = serde_json::from_str(&format!(
            r#"[{{"relay":"wss://r.example","me":"{me}","rooms":null,"mentions":true,"from":[],"subject":"s","name":"n","kind":1}}]"#
        ));
        assert!(extra.is_err(), "no fields beyond the list's");
    }

    #[test]
    fn the_service_can_sign_only_a_relay_sign_in() {
        let k = Keys::generate();
        let nsec = k.secret_key().to_bech32().unwrap();
        let json = sign_auth(nsec.as_bytes(), "ws://localhost:3871", "abc123").expect("signed");
        let ev = Event::from_json(&json).unwrap();
        ev.verify().unwrap();
        assert_eq!(ev.kind.as_u16(), 22242);
        assert_eq!(ev.pubkey, k.public_key());
        assert_eq!(ev.content, "");
        let tags: Vec<Vec<String>> = ev.tags.iter().map(|t| t.as_slice().to_vec()).collect();
        assert_eq!(tags, vec![vec!["relay".to_string(), "ws://localhost:3871".into()], vec!["challenge".to_string(), "abc123".into()]]);
        // the hex form of the key reads too
        assert!(sign_auth(k.secret_key().to_secret_hex().as_bytes(), "wss://relay.example", "c").is_some());
        assert!(sign_auth(nsec.as_bytes(), "https://relay.example", "c").is_none(), "only a relay");
        assert!(sign_auth(nsec.as_bytes(), "wss://relay.example", "").is_none());
        assert!(sign_auth(nsec.as_bytes(), "wss://relay.example", "a\nb").is_none());
        assert!(sign_auth(nsec.as_bytes(), "wss://relay.example", &"c".repeat(257)).is_none());
        assert!(sign_auth(b"nsec1notakey", "wss://relay.example", "c").is_none());
        assert!(sign_auth(k.public_key().to_bech32().unwrap().as_bytes(), "wss://relay.example", "c").is_none());
        assert!(sign_auth(&[0xff, 0xfe], "wss://relay.example", "c").is_none());
    }
}
