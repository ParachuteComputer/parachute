//! Notifications while the app is closed (docs/design/KEYRING.md, "Notifications while closed"). The web side hands the
//! list of what granted applets asked to be told about to `notify_set`; it is checked here and passed to Android's
//! `NotifyPlugin.kt`, which keeps it and runs `NotifyService.kt`: a foreground service with its own relay connection.
//!
//! The service signs exactly one thing with the person's key, through [`sign_auth`] over JNI: the relay's NIP-42
//! sign-in (kind 22242, the relay and the challenge, nothing else). It never sees the key's text beyond the bytes it
//! decrypts from the Keystore for that one call, and zeroes them after.
//!
//! The main path is a push gateway (docs/design/SERVICES.md, "Notifications through an open push service"): an applet's
//! `notify` names one; `push_register` signs the registration (NIP-98, only to that gateway, only this request's shape)
//! and sends it with the endpoint and push keys the phone's UnifiedPush distributor gave `PushService.kt` for that
//! gateway (one UnifiedPush instance per gateway, so no gateway learns another's endpoint and keys). The
//! foreground service is the fallback for what no push service delivers (no distributor installed): on unless the
//! person turns it off, and idle while push serves everything.
//!
//! Desktop: not in this step; `notify_set` answers that it is Android only.

use std::collections::{BTreeMap, HashSet};
use std::sync::Mutex;
use std::time::Duration;

use nostr::JsonUtil;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Runtime, State};
use url::Url;

use crate::key::{parse_secret, KeyState};

pub const MAX_ENTRIES: usize = 8;
pub const MAX_ROOMS: usize = 50;
pub const MAX_FROM: usize = 4;
const MAX_SUBJECT: usize = 200;
const MAX_NAME: usize = 80;
const MAX_ROOM_NAME: usize = 40;

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
    /// The push gateway the applet declared (an https prefix ending in `/`), when it named one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gateway: Option<String>,
    /// The applet's names for the rooms it named (`rooms` on its relay service), shown on a pushed notification.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub names: BTreeMap<String, String>,
}

/// One allowed applet's signal that has a gateway (docs/design/APP-RECORD.md "Signals"; src/services/notify.ts): its
/// count goes to `gateway` as the opaque `gid` and `signal`, and a push of it is shown as "`name` · n new: `label`",
/// opening `subject`. `relay` and `rooms`: a relay's signal, which the gateway counts from that registration's messages.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct SignalEntry {
    pub gid: String,
    pub signal: String,
    pub gateway: String,
    pub me: String,
    pub subject: String,
    pub name: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relay: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rooms: Option<Vec<String>>,
}

pub const MAX_SIGNALS: usize = 32;
const MAX_COUNT: u32 = 9999;

fn gid_ok(s: &str) -> bool {
    (8..=64).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// A signal's id as the record names it: lower-case words joined by `-`.
fn signal_id_ok(s: &str) -> bool {
    !s.is_empty() && s.len() <= 40 && s.split('-').all(|w| !w.is_empty() && w.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit()))
}

/// The signal list as the shell keeps it: each for the key this device holds, through a gateway written plain.
pub fn validate_signals(signals: &[SignalEntry], me: Option<&str>) -> Result<(), String> {
    if signals.len() > MAX_SIGNALS {
        return Err(format!("At most {MAX_SIGNALS} signals go to gateways."));
    }
    for s in signals {
        if !gid_ok(&s.gid) || !signal_id_ok(&s.signal) {
            return Err("A signal's ids aren't ones the app makes.".into());
        }
        if me != Some(s.me.as_str()) {
            return Err("`me` isn't the key this device holds.".into());
        }
        if gateway_url(&s.gateway)?.as_str() != s.gateway {
            return Err("A gateway's address is written as the declaration made it plain.".into());
        }
        if !line(&s.subject, MAX_SUBJECT) || !line(&s.name, MAX_NAME) || !line(&s.label, MAX_NAME) {
            return Err("A signal's subject, name and words are short lines.".into());
        }
        if let Some(r) = &s.relay {
            relay_url(r)?;
        }
        if let Some(rooms) = &s.rooms {
            if s.relay.is_none() || rooms.is_empty() || rooms.len() > MAX_ROOMS || !rooms.iter().all(|r| crate::services::room_id_ok(r)) {
                return Err("A relay's signal names 1 to 50 of its rooms, or none for all of them.".into());
            }
        }
    }
    Ok(())
}

/// The registration's `signals`: what a message for the person on this relay counts toward, by room.
pub fn relay_signals(signals: &[SignalEntry], gateway: &str, relay: &str) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();
    // as the gateway takes them: 8 at most, naming 100 rooms at most in all (a signal past that isn't counted there)
    let mut rooms = 0;
    for s in signals.iter().filter(|s| s.gateway == gateway && s.relay.as_deref() == Some(relay)) {
        let v = json!({ "subject": s.gid, "signal": s.signal, "rooms": s.rooms });
        let n = s.rooms.as_ref().map_or(0, Vec::len);
        if out.contains(&v) || out.len() == 8 || rooms + n > 100 {
            continue;
        }
        rooms += n;
        out.push(v);
    }
    out
}

/// What a device tells a gateway: counts for signals the list sends there, nothing else (`<gateway>signals`).
#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct SetCount {
    pub subject: String,
    pub signal: String,
    pub count: u32,
}

pub fn signals_body(signals: &[SignalEntry], gateway: &str, set: &[SetCount]) -> Result<Vec<u8>, String> {
    if set.len() > 16 {
        return Err("At most 16 counts at once.".into());
    }
    for c in set {
        if c.count > MAX_COUNT || !signals.iter().any(|s| s.gateway == gateway && s.gid == c.subject && s.signal == c.signal) {
            return Err("No allowed applet sends that count to that gateway.".into());
        }
    }
    serde_json::to_vec(&json!({ "set": set })).map_err(|e| e.to_string())
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
            // one rule for a room id everywhere: Buzz's (services.rs), as the notification's link reads it (notifyLink.ts)
            if !rooms.iter().all(|r| crate::services::room_id_ok(r)) {
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
        if let Some(g) = &e.gateway {
            if gateway_url(g)?.as_str() != g {
                return Err("A gateway's address is written as the declaration made it plain.".into());
            }
        }
        let named = e.rooms.as_deref().unwrap_or(&[]);
        if !e.names.iter().all(|(id, n)| named.contains(id) && line(n, MAX_ROOM_NAME)) {
            return Err("Room names are for the rooms the applet named, each a short line.".into());
        }
    }
    Ok(())
}

/// A push gateway's address: https (http to this device only), a prefix ending in `/`, as services.rs reads an http
/// service's url.
pub fn gateway_url(raw: &str) -> Result<Url, String> {
    crate::services::normal_url(&Value::String(raw.to_string()), "https", "http", true).map_err(|e| format!("The gateway's address: {e}"))
}

/// The two requests the shell sends a gateway, and nothing else: `<gateway>register` and `<gateway>unregister`.
pub fn push_url(gateway: &str, op: PushOp) -> Result<Url, String> {
    let g = gateway_url(gateway)?;
    let u = Url::parse(&format!("{}{}", g.as_str(), op.path())).map_err(|_| "The gateway's address doesn't take a request.".to_string())?;
    if u.origin() != g.origin() || u.path() != format!("{}{}", g.path(), op.path()) || u.query().is_some() {
        return Err("The gateway's address doesn't take a request.".into());
    }
    Ok(u)
}

#[derive(Deserialize, Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PushOp {
    Register,
    Unregister,
    Signals,
}

impl PushOp {
    fn path(self) -> &'static str {
        match self {
            PushOp::Register => "register",
            PushOp::Unregister => "unregister",
            PushOp::Signals => "signals",
        }
    }
}

/// Where the phone's distributor delivers for one gateway, and the keys its pushes are sealed to (PushService.kt keeps
/// one per gateway).
#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
pub struct Endpoint {
    pub endpoint: String,
    pub p256dh: String,
    pub auth: String,
}

impl Endpoint {
    /// What the distributor handed over, checked: a URL of the push server's (https, or http to this device), and the
    /// keys' sizes (an uncompressed P-256 point, a 16-byte secret, base64url).
    pub fn checked(self) -> Result<Self, String> {
        let u = Url::parse(&self.endpoint).map_err(|_| "The push endpoint isn't an address.".to_string())?;
        let host = u.host_str().unwrap_or("");
        let loopback = matches!(host, "localhost" | "127.0.0.1" | "[::1]");
        if self.endpoint.len() > 1024 || !(u.scheme() == "https" || (u.scheme() == "http" && loopback)) || !u.username().is_empty() || u.fragment().is_some() {
            return Err("The push endpoint isn't one a gateway takes.".into());
        }
        let b64 = |s: &str, n: usize| s.len() < 200 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') && (s.len() * 6) / 8 == n;
        if !b64(&self.p256dh, 65) || !b64(&self.auth, 16) {
            return Err("The push keys aren't the connector's.".into());
        }
        Ok(self)
    }
}

/// What every allowed applet naming this gateway asks on this relay, as one registration (the gateway keeps one per key,
/// endpoint and relay): rooms together (all of them if any asks for all), mentions if any asks, `from` keys together.
/// The first applet's subject and name, for the signature log.
pub fn merged(entries: &[NotifyEntry], gateway: &str, relay: &str) -> Option<NotifyEntry> {
    let on: Vec<&NotifyEntry> = entries.iter().filter(|e| e.gateway.as_deref() == Some(gateway) && e.relay == relay).collect();
    let first = (*on.first()?).clone();
    let rooms = if on.iter().any(|e| e.rooms.is_none()) {
        None
    } else {
        let mut r: Vec<String> = on.iter().flat_map(|e| e.rooms.clone().unwrap_or_default()).collect();
        r.sort();
        r.dedup();
        r.truncate(MAX_ROOMS);
        Some(r)
    };
    let mut from: Vec<String> = on.iter().flat_map(|e| e.from.clone()).collect();
    from.sort();
    from.dedup();
    from.truncate(MAX_FROM);
    Some(NotifyEntry { rooms, mentions: on.iter().any(|e| e.mentions), from, ..first })
}

/// The body of a registration: built here from the checked entry and the distributor's endpoint, never handed in.
pub fn register_body(e: &NotifyEntry, ep: &Endpoint, signals: &[Value]) -> Vec<u8> {
    let mut body = json!({ "endpoint": ep.endpoint, "keys": { "p256dh": ep.p256dh, "auth": ep.auth }, "relay": e.relay, "rooms": e.rooms, "mentions": e.mentions, "from": e.from });
    // only when an applet counts these messages: a registration without signals reads as before
    if !signals.is_empty() {
        body["signals"] = json!(signals);
    }
    serde_json::to_vec(&body).unwrap_or_default()
}

pub fn unregister_body(endpoint: &str, relay: &str) -> Vec<u8> {
    serde_json::to_vec(&json!({ "endpoint": endpoint, "relay": relay })).unwrap_or_default()
}

/// A registration the shell made, kept so it is sent again only when something changed (or a week passed: the
/// gateway forgets one after 30 days) and can be unregistered when the grant goes.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Kept {
    /// the key it was registered as: another key on this device registers again
    #[serde(default)]
    pub me: String,
    pub gateway: String,
    pub relay: String,
    pub endpoint: String,
    pub hash: String,
    pub at: u64,
}

pub const KEPT_FILE: &str = "push-registered.json";
const RENEW_S: u64 = 7 * 24 * 3600;
/// A registration the gateway answered `pending` (no member list it reads shows the key yet: it drops it at its next
/// read) is sent again after this, not a week: a room may add the gateway or the person meanwhile.
const RENEW_PENDING_S: u64 = 24 * 3600;

/// What a gateway said when it refused (its answer's `error`), for Settings: one short line of plain characters (no
/// control, direction or zero-width characters).
pub fn gateway_said(answer: &[u8]) -> String {
    let why = serde_json::from_slice::<Value>(answer).ok().and_then(|v| v.get("error").and_then(Value::as_str).map(str::to_string)).unwrap_or_default();
    let plain = |c: &char| !c.is_control() && !matches!(*c, '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2060}'..='\u{2069}' | '\u{FEFF}' | '\u{00AD}');
    let why: String = why.chars().filter(plain).take(120).collect();
    if why.trim().is_empty() { String::new() } else { format!(": {}", why.trim()) }
}

/// The `at` to keep for a registration made `now`: a pending one is due again after a day.
pub fn kept_at(now: u64, answer: &[u8]) -> u64 {
    let pending = serde_json::from_slice::<Value>(answer).ok().and_then(|v| v.get("pending").and_then(Value::as_bool)) == Some(true);
    if pending { now.saturating_sub(RENEW_S - RENEW_PENDING_S) } else { now }
}

/// The list the last `notify_set` checked: `push_register` registers only what is on it.
#[derive(Default)]
pub struct NotifyState(Mutex<Vec<NotifyEntry>>);

/// The signals the last `notify_set` checked: `push_signals` sends only their counts, only to their gateways.
#[derive(Default)]
pub struct SignalState(Mutex<Vec<SignalEntry>>);

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
/// buffer that is zeroed when dropped; the service zeroes its own array. `catch_unwind` turns a panic into `null` only
/// in a debug build: the release build aborts on any panic (Cargo.toml `panic = "abort"`), so nothing on this path may
/// panic; each step answers `None` instead.
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
                let handle = _api.register_android_plugin("computer.parachute.app", "NotifyPlugin")?;
                _app.manage(NotifyPluginHandle(handle));
            }
            Ok(())
        })
        .build()
}

/// Android's `PushPlugin.kt` (the UnifiedPush connector), reachable from Rust only.
#[cfg(target_os = "android")]
pub struct PushPluginHandle<R: Runtime>(pub tauri::plugin::PluginHandle<R>);

pub fn push_plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::<R>::new("parachute-push")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                let handle = _api.register_android_plugin("computer.parachute.app", "PushPlugin")?;
                _app.manage(PushPluginHandle(handle));
            }
            Ok(())
        })
        .build()
}

#[cfg(target_os = "android")]
async fn push_call<R: Runtime>(app: &AppHandle<R>, cmd: &str, args: Value) -> Result<Value, String> {
    let plugin = app.try_state::<PushPluginHandle<R>>().map(|h| h.0.clone()).ok_or("Push isn't ready.")?;
    plugin.run_mobile_plugin_async::<Value>(cmd, args).await.map_err(|e| format!("The push service didn't answer ({e})."))
}

/// The endpoint and keys the distributor gave the phone for this gateway: its own UnifiedPush instance, asked for the
/// first time it is needed (PushPlugin.kt works out the instance from the gateway; nothing here does).
async fn endpoint<R: Runtime>(app: &AppHandle<R>, gateway: &str) -> Result<Endpoint, String> {
    #[cfg(target_os = "android")]
    {
        serde_json::from_value(push_call(app, "endpoint", json!({ "gateway": gateway })).await?).map_err(|_| "The push service has no endpoint yet.".to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, gateway);
        Err("Notifications while the app is closed are Android only for now.".into())
    }
}

/// The fallback listener serves only what no registration does: Android keeps which (gateway, relay) are registered,
/// and lets go of a gateway's push instance once no pair uses it.
async fn tell_native<R: Runtime>(app: &AppHandle<R>, kept: &[Kept]) {
    #[cfg(target_os = "android")]
    {
        let pairs: Vec<Value> = kept.iter().map(|k| json!({ "gateway": k.gateway, "relay": k.relay })).collect();
        let _ = push_call(app, "registered", json!({ "pairs": serde_json::to_string(&pairs).unwrap_or_default() })).await;
    }
    #[cfg(not(target_os = "android"))]
    let _ = (app, kept);
}

fn kept_path<R: Runtime>(app: &AppHandle<R>) -> Result<std::path::PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|_| "The app's data folder isn't available.")?.join(KEPT_FILE))
}

/// The phone's push state: the distributors installed (ntfy, …), the one in use, whether it gave an endpoint, the
/// fallback listener's switch, and the gateways registered with. Desktop: `{ available: false }`.
#[tauri::command]
pub async fn push_status<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    let kept: Vec<Kept> = crate::services::read_json(&kept_path(&app)?);
    let registered: Vec<Value> = kept.iter().map(|k| json!({ "gateway": k.gateway, "relay": k.relay })).collect();
    #[cfg(target_os = "android")]
    {
        let mut v = push_call(&app, "status", json!({})).await?;
        v["available"] = json!(true);
        v["registered"] = json!(registered);
        Ok(v)
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(json!({ "available": false, "registered": registered, "note": "Notifications while the app is closed are Android only for now." }))
    }
}

/// Use a distributor (the one named, else the one in use or the only one installed) and wait for its endpoint; or turn
/// the fallback listener on or off.
#[tauri::command]
pub async fn push_setup<R: Runtime>(app: AppHandle<R>, distributor: Option<String>, fallback: Option<bool>) -> Result<Value, String> {
    if let Some(d) = &distributor {
        if d.is_empty() || d.len() > 200 || !d.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'_') {
            return Err("That isn't an app's package name.".into());
        }
    }
    #[cfg(target_os = "android")]
    {
        push_call(&app, "setup", json!({ "distributor": distributor, "fallback": fallback })).await
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, fallback);
        Ok(json!({ "available": false }))
    }
}

/// One signed request to a gateway: the URL from the gateway and the operation (no other path), after the hub check,
/// signed NIP-98 with the everyday key over exactly that URL and body, a line in the applet's signature log, no
/// redirect followed. The status and the answer's first `max` bytes.
#[allow(clippy::too_many_arguments)]
async fn signed_post(
    broker: &crate::services::Broker,
    hubs: &HashSet<String>,
    client: &reqwest::Client,
    k: &nostr::Keys,
    gateway: &str,
    op: PushOp,
    body: Vec<u8>,
    subject: &str,
    name: &str,
    max: usize,
) -> Result<(u16, Vec<u8>), String> {
    let url = push_url(gateway, op)?;
    broker.guard(hubs, &url).await.map_err(|r| r.message)?;
    let ev = crate::services::nip98_event(k, &url, "POST", Some(&body)).map_err(|r| r.message)?;
    broker.log_outside(subject, name, "push gateway", format!("POST {}", url.path()), Some(ev.id.to_hex())).map_err(|r| r.message)?;
    let mut res = client
        .post(url)
        .header(reqwest::header::AUTHORIZATION, crate::services::authorization(&ev))
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body)
        .send()
        .await
        // src/services/signalBook.ts `retryable` reads this wording (and "(429", "(5xx" below): keep them in step
        .map_err(|_| "The gateway didn't answer.".to_string())?;
    let status = res.status().as_u16();
    let mut answer = Vec::new();
    while let Ok(Some(chunk)) = res.chunk().await {
        answer.extend_from_slice(&chunk[..chunk.len().min(max - answer.len())]);
        if answer.len() >= max {
            break;
        }
    }
    Ok((status, answer))
}

/// Tell a gateway the counts this device moved, and read what it holds for this key (docs/design/APP-RECORD.md
/// "Signals"). Only to a gateway an allowed applet's signal names, only counts for those signals: the applet's opaque
/// id, the signal's id, the number. Answers the gateway's `{ok, counts}`.
#[tauri::command]
pub async fn push_signals<R: Runtime>(
    app: AppHandle<R>,
    keys: State<'_, KeyState>,
    services: State<'_, crate::services::ServicesState>,
    signals: State<'_, SignalState>,
    gateway: String,
    set: Vec<SetCount>,
    hubs: Vec<String>,
) -> Result<Value, String> {
    let (body, first) = {
        let list = signals.0.lock().unwrap_or_else(|e| e.into_inner());
        let first = list.iter().find(|s| s.gateway == gateway).cloned().ok_or("No allowed applet sends counts to that gateway.")?;
        (signals_body(&list, &gateway, &set)?, first)
    };
    let k = crate::services::held(&app, &keys).await.map_err(|r| r.message)?;
    let broker = services.broker(&app).map_err(|r| r.message)?;
    let hubs: HashSet<String> = hubs.into_iter().take(1000).collect();
    let client = crate::door::http_client(Duration::from_secs(15)).map_err(|_| "Secure connections aren't available.".to_string())?;
    // a key's counts are at most 64, each a short line: 64 KB holds them
    let (status, answer) = signed_post(broker, &hubs, &client, &k, &gateway, PushOp::Signals, body, &first.subject, &first.name, 64 * 1024).await?;
    if !(200..300).contains(&status) {
        return Err(format!("The gateway didn't take the counts ({status}{}).", gateway_said(&answer)));
    }
    serde_json::from_slice(&answer).map_err(|_| "The gateway's answer isn't JSON.".to_string())
}

/// Register with (or unregister from) the push gateway an allowed applet declared. The shell builds the request: the
/// URL from the declared gateway, the body from the checked list and the phone's endpoint, signed NIP-98 with the
/// everyday key over exactly that URL and body. Nothing for a gateway the list doesn't name (or, to unregister, that
/// the shell didn't register with), nothing for a hub, no redirect followed.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn push_register<R: Runtime>(
    app: AppHandle<R>,
    keys: State<'_, KeyState>,
    services: State<'_, crate::services::ServicesState>,
    list: State<'_, NotifyState>,
    signals: State<'_, SignalState>,
    gateway: String,
    relay: String,
    op: PushOp,
    hubs: Vec<String>,
) -> Result<Value, String> {
    let entry = merged(&list.0.lock().unwrap_or_else(|e| e.into_inner()), &gateway, &relay);
    let path = kept_path(&app)?;
    let mut kept: Vec<Kept> = crate::services::read_json(&path);
    let had = kept.iter().position(|k| k.gateway == gateway && k.relay == relay);
    let k = crate::services::held(&app, &keys).await.map_err(|r| r.message)?;
    let broker = services.broker(&app).map_err(|r| r.message)?;
    let hubs: HashSet<String> = hubs.into_iter().take(1000).collect();
    let now = nostr::Timestamp::now().as_secs();
    let client = crate::door::http_client(Duration::from_secs(15)).map_err(|_| "Secure connections aren't available.".to_string())?;
    let relay_signals = relay_signals(&signals.0.lock().unwrap_or_else(|e| e.into_inner()), &gateway, &relay);
    let send = |op: PushOp, body: Vec<u8>, subject: String, name: String| {
        let (broker, hubs, client, k, gateway) = (broker, &hubs, &client, &k, gateway.clone());
        // the answer's first 4 KB at most (`{ok, expires, pending}`)
        async move { signed_post(broker, hubs, client, k, &gateway, op, body, &subject, &name, 4096).await }
    };
    match op {
        PushOp::Signals => Err("Counts go through push_signals.".into()),
        PushOp::Register => {
            let e = entry.ok_or("No allowed applet names that gateway for that relay.")?;
            let ep = endpoint(&app, &gateway).await?.checked()?;
            let body = register_body(&e, &ep, &relay_signals);
            let hash = crate::services::sha256_hex(&[e.me.as_bytes(), b"\n", gateway.as_bytes(), b"\n", &body].concat());
            if let Some(i) = had {
                if kept[i].hash == hash && now.saturating_sub(kept[i].at) < RENEW_S {
                    tell_native(&app, &kept).await;
                    return Ok(json!({ "status": "unchanged" }));
                }
                // the distributor gave a new endpoint: the old one goes first (the gateway would drop it at its first 404)
                if kept[i].endpoint != ep.endpoint {
                    let _ = send(PushOp::Unregister, unregister_body(&kept[i].endpoint, &relay), e.subject.clone(), e.name.clone()).await;
                }
            }
            let (status, answer) = send(PushOp::Register, body, e.subject.clone(), e.name.clone()).await?;
            if !(200..300).contains(&status) {
                return Err(format!("The gateway refused the registration ({status}{}).", gateway_said(&answer)));
            }
            kept.retain(|x| !(x.gateway == gateway && x.relay == relay));
            kept.push(Kept { me: e.me.clone(), gateway: gateway.clone(), relay: relay.clone(), endpoint: ep.endpoint, hash, at: kept_at(now, &answer) });
            crate::services::write_json(&path, &kept).map_err(|_| "The registration couldn't be kept.".to_string())?;
            tell_native(&app, &kept).await;
            Ok(json!({ "status": "registered" }))
        }
        PushOp::Unregister => {
            let i = had.ok_or("This device didn't register with that gateway.")?;
            let (subject, name) = entry.map(|e| (e.subject, e.name)).unwrap_or_else(|| ("push".into(), "Notifications".into()));
            let (status, _) = send(PushOp::Unregister, unregister_body(&kept[i].endpoint, &relay), subject, name).await?;
            // an answer is an answer: a 4xx won't change by asking again (the gateway forgets it in 30 days anyway)
            if status >= 500 {
                return Err(format!("The gateway didn't take the unregistration ({status})."));
            }
            kept.remove(i);
            crate::services::write_json(&path, &kept).map_err(|_| "The registration list couldn't be written.".to_string())?;
            tell_native(&app, &kept).await;
            Ok(json!({ "status": "unregistered" }))
        }
    }
}

/// The mark that Android's notification permission was asked for once (app data).
pub const ASKED_FILE: &str = "notify-asked";

/// Whether to ask for Android's notification permission now: the first time an applet asks to tell the person
/// something (`wants`), and never again by itself. A sync runs on every return to the front, and asking each time means a
/// denial reopens the question at once, round and round, until Android removes the app. Afterwards Settings says
/// notifications are off and opens the phone's own switch. The mark is kept before asking; one that can't be kept, or
/// read, asks nothing.
pub fn take_ask(dir: &std::path::Path, wants: bool) -> bool {
    if !wants {
        return false;
    }
    let mark = dir.join(ASKED_FILE);
    if !matches!(mark.try_exists(), Ok(false)) {
        return false;
    }
    std::fs::create_dir_all(dir).is_ok() && std::fs::write(&mark, b"asked\n").is_ok()
}

/// Keep what granted applets asked to be told about, and start or stop the service to match (an empty list stops it).
/// Answers the service's state: `{ running, permission, entries }`, or on desktop `{ android_only: true }`.
#[tauri::command]
pub async fn notify_set<R: Runtime>(app: AppHandle<R>, state: State<'_, KeyState>, mut entries: Vec<NotifyEntry>, signals: Option<Vec<SignalEntry>>) -> Result<serde_json::Value, String> {
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
    let signals = signals.unwrap_or_default();
    validate_signals(&signals, me.as_deref())?;
    *app.state::<NotifyState>().0.lock().unwrap_or_else(|e| e.into_inner()) = entries.clone();
    *app.state::<SignalState>().0.lock().unwrap_or_else(|e| e.into_inner()) = signals.clone();
    #[cfg(target_os = "android")]
    {
        let plugin = app.try_state::<NotifyPluginHandle<R>>().map(|h| h.0.clone()).ok_or("Notifications aren't ready.")?;
        let ask = take_ask(&app.path().app_data_dir().map_err(|_| "The app's data folder isn't available.")?, !entries.is_empty());
        let entries = serde_json::to_string(&entries).map_err(|e| e.to_string())?;
        let signals = serde_json::to_string(&signals).map_err(|e| e.to_string())?;
        plugin
            .run_mobile_plugin_async::<serde_json::Value>("configure", serde_json::json!({ "entries": entries, "signals": signals, "ask": ask }))
            .await
            .map_err(|e| format!("Notifications couldn't be set up ({e})."))
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, entries, signals);
        Ok(serde_json::json!({ "android_only": true, "note": "Notifications while the app is closed are Android only for now." }))
    }
}

/// Open the phone's own notification settings for Parachute (Settings → Notifications while closed, when they are off):
/// the one way back after the person said no, since Parachute never asks again by itself.
#[tauri::command]
pub async fn notify_open_settings<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let plugin = app.try_state::<NotifyPluginHandle<R>>().map(|h| h.0.clone()).ok_or("Notifications aren't ready.")?;
        plugin.run_mobile_plugin_async::<serde_json::Value>("openSettings", serde_json::json!({})).await.map(|_| ()).map_err(|e| format!("The phone's settings couldn't be opened ({e})."))
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err("Notifications while the app is closed are Android only for now.".into())
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
            gateway: None,
            names: BTreeMap::new(),
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
        assert!(ok(NotifyEntry { rooms: Some(vec!["a.b".into()]), ..entry(&me) }).is_err(), "Buzz's rule, as the link reads it");
        assert!(ok(NotifyEntry { rooms: Some(vec!["a".repeat(65)]), ..entry(&me) }).is_err());
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
    fn a_gateway_gets_two_requests_built_here() {
        assert_eq!(push_url("https://push.example/", PushOp::Register).unwrap().as_str(), "https://push.example/register");
        assert_eq!(push_url("https://push.example/p/", PushOp::Unregister).unwrap().as_str(), "https://push.example/p/unregister");
        assert_eq!(push_url("http://localhost:8790/", PushOp::Register).unwrap().as_str(), "http://localhost:8790/register");
        for g in ["http://push.example/", "https://push.example/p", "https://push.example/?x", "wss://push.example/", "https://u@push.example/", "https://push.example/../x/"] {
            assert!(push_url(g, PushOp::Register).is_err(), "{g}");
        }
        let me = Keys::generate().public_key().to_hex();
        let ep = Endpoint { endpoint: "https://ntfy.example/upAbc?up=1".into(), p256dh: "B".repeat(87), auth: "A".repeat(22) };
        let e = NotifyEntry { rooms: Some(vec!["garden".into()]), from: vec!["c".repeat(64)], gateway: Some("https://push.example/".into()), ..entry(&me) };
        let body: Value = serde_json::from_slice(&register_body(&e, &ep, &[])).unwrap();
        assert_eq!(body, json!({ "endpoint": "https://ntfy.example/upAbc?up=1", "keys": { "p256dh": "B".repeat(87), "auth": "A".repeat(22) }, "relay": "wss://relay.example", "rooms": ["garden"], "mentions": true, "from": ["c".repeat(64)] }));
        assert!(!String::from_utf8(register_body(&e, &ep, &[])).unwrap().contains("Rooms"), "the applet's name and address stay on the phone");
        assert!(ep.clone().checked().is_ok());
        for bad in [
            Endpoint { endpoint: "http://ntfy.example/up".into(), ..ep.clone() },
            Endpoint { endpoint: "https://u:p@ntfy.example/up".into(), ..ep.clone() },
            Endpoint { endpoint: "not a url".into(), ..ep.clone() },
            Endpoint { p256dh: "B".repeat(86) + "=", ..ep.clone() },
            Endpoint { auth: "A".repeat(30), ..ep.clone() },
        ] {
            assert!(bad.clone().checked().is_err(), "{bad:?}");
        }
        assert!(Endpoint { endpoint: "http://localhost:18566/upAbc?up=1".into(), ..ep.clone() }.checked().is_ok(), "a push server on this device (tests)");
    }

    #[test]
    fn a_refusal_says_what_the_gateway_said_in_one_short_plain_line() {
        assert_eq!(gateway_said(br#"{"error":"endpoint on that host must be its push server"}"#), ": endpoint on that host must be its push server");
        assert_eq!(gateway_said(b"<html>bad gateway</html>"), "");
        assert_eq!(gateway_said(br#"{"error":"  "}"#), "");
        let long = gateway_said(format!(r#"{{"error":"a\nb{}"}}"#, "x".repeat(500)).as_bytes());
        assert!(!long.contains('\n') && long.chars().count() == 2 + 120, "{long}");
        assert_eq!(gateway_said("{\"error\":\"ok\u{202E}evil\u{200B}\"}".as_bytes()), ": okevil", "no direction or zero-width characters");
    }

    #[test]
    fn a_pending_registration_is_sent_again_after_a_day() {
        let now = 10 * RENEW_S;
        assert_eq!(kept_at(now, br#"{"ok":true,"expires":1,"pending":false}"#), now);
        assert_eq!(kept_at(now, b"not json"), now);
        let at = kept_at(now, br#"{"ok":true,"expires":1,"pending":true}"#);
        // the renewal check (`now - at < RENEW_S` keeps it) lets it go again one day on
        assert!(now - at < RENEW_S && (now + RENEW_PENDING_S) - at >= RENEW_S);
    }

    #[test]
    fn applets_on_one_gateway_and_relay_register_as_one() {
        let me = Keys::generate().public_key().to_hex();
        let g = Some("https://push.example/".to_string());
        let a = NotifyEntry { rooms: Some(vec!["a".into()]), gateway: g.clone(), ..entry(&me) };
        let b = NotifyEntry { rooms: Some(vec!["b".into()]), mentions: false, from: vec!["c".repeat(64)], gateway: g.clone(), subject: "area".into(), ..entry(&me) };
        let other = NotifyEntry { rooms: Some(vec!["x".into()]), gateway: Some("https://other.example/".into()), ..entry(&me) };
        let m = merged(&[a.clone(), b.clone(), other], "https://push.example/", "wss://relay.example").unwrap();
        assert_eq!(m.rooms, Some(vec!["a".to_string(), "b".into()]), "both applets' rooms");
        assert!(m.mentions);
        assert_eq!(m.from, vec!["c".repeat(64)]);
        assert_eq!(m.subject, "rooms");
        let all = merged(&[a, NotifyEntry { rooms: None, gateway: g, ..entry(&me) }], "https://push.example/", "wss://relay.example").unwrap();
        assert_eq!(all.rooms, None, "one asking for all its rooms asks for all");
        assert!(merged(&[b], "https://push.example/", "wss://elsewhere.example").is_none());
    }

    #[test]
    fn the_list_checks_gateways_and_room_names() {
        let me = Keys::generate().public_key().to_hex();
        let ok = |e: NotifyEntry| validate(&[e], Some(&me));
        assert!(ok(NotifyEntry { gateway: Some("https://push.example/".into()), ..entry(&me) }).is_ok());
        assert!(ok(NotifyEntry { gateway: Some("https://Push.Example/".into()), ..entry(&me) }).is_err(), "as the declaration made it plain");
        assert!(ok(NotifyEntry { gateway: Some("http://push.example/".into()), ..entry(&me) }).is_err());
        let names = |k: &str, v: &str| BTreeMap::from([(k.to_string(), v.to_string())]);
        assert!(ok(NotifyEntry { rooms: Some(vec!["garden".into()]), names: names("garden", "Garden"), ..entry(&me) }).is_ok());
        assert!(ok(NotifyEntry { rooms: Some(vec!["garden".into()]), names: names("other", "Other"), ..entry(&me) }).is_err());
        assert!(ok(NotifyEntry { rooms: None, names: names("garden", "Garden"), ..entry(&me) }).is_err());
        assert!(ok(NotifyEntry { rooms: Some(vec!["garden".into()]), names: names("garden", "a\nb"), ..entry(&me) }).is_err());
    }

    #[test]
    fn counts_go_only_to_a_signal_s_gateway_and_say_only_which_signal_and_how_many() {
        let me = Keys::generate().public_key().to_hex();
        let sig = |gid: &str, gateway: &str| SignalEntry { gid: gid.into(), signal: "new".into(), gateway: gateway.into(), me: me.clone(), subject: "/v/home/a/01I".into(), name: "Ideas".into(), label: "new ideas from others".into(), relay: None, rooms: None };
        let list = vec![sig("Z2lkLW9mLWlkZWFz", "https://push.example/")];
        assert!(validate_signals(&list, Some(&me)).is_ok());
        let body: Value = serde_json::from_slice(&signals_body(&list, "https://push.example/", &[SetCount { subject: "Z2lkLW9mLWlkZWFz".into(), signal: "new".into(), count: 2 }]).unwrap()).unwrap();
        assert_eq!(body, json!({ "set": [{ "subject": "Z2lkLW9mLWlkZWFz", "signal": "new", "count": 2 }] }), "the opaque id, the signal, the number: not the applet's name or address");
        assert_eq!(push_url("https://push.example/", PushOp::Signals).unwrap().as_str(), "https://push.example/signals");
        for (gateway, c) in [
            ("https://other.example/", SetCount { subject: "Z2lkLW9mLWlkZWFz".into(), signal: "new".into(), count: 1 }),
            ("https://push.example/", SetCount { subject: "YW5vdGhlci1hcHBsZXQ".into(), signal: "new".into(), count: 1 }),
            ("https://push.example/", SetCount { subject: "Z2lkLW9mLWlkZWFz".into(), signal: "old".into(), count: 1 }),
            ("https://push.example/", SetCount { subject: "Z2lkLW9mLWlkZWFz".into(), signal: "new".into(), count: 10_000 }),
        ] {
            assert!(signals_body(&list, gateway, &[c.clone()]).is_err(), "{gateway} {c:?}");
        }
        let many: Vec<SetCount> = (0..17).map(|_| SetCount { subject: "Z2lkLW9mLWlkZWFz".into(), signal: "new".into(), count: 1 }).collect();
        assert!(signals_body(&list, "https://push.example/", &many).is_err());
        let other = Keys::generate().public_key().to_hex();
        assert!(validate_signals(&list, Some(&other)).is_err(), "another key's");
        for bad in [
            SignalEntry { gid: "short".into(), ..list[0].clone() },
            SignalEntry { signal: "New".into(), ..list[0].clone() },
            SignalEntry { gateway: "https://push.example".into(), ..list[0].clone() },
            SignalEntry { gateway: "http://push.example/".into(), ..list[0].clone() },
            SignalEntry { rooms: Some(vec!["garden".into()]), ..list[0].clone() },
            SignalEntry { label: "two\nlines".into(), ..list[0].clone() },
        ] {
            assert!(validate_signals(&[bad.clone()], Some(&me)).is_err(), "{bad:?}");
        }
        // a relay's signal rides that registration, by room; a registration without one reads as before
        let rooms = SignalEntry { gid: "cm9vbXMtYXBwbGV0".into(), signal: "for-you".into(), relay: Some("wss://relay.example".into()), rooms: Some(vec!["garden".into()]), ..list[0].clone() };
        let regs = relay_signals(&[rooms, list[0].clone()], "https://push.example/", "wss://relay.example");
        assert_eq!(regs, vec![json!({ "subject": "cm9vbXMtYXBwbGV0", "signal": "for-you", "rooms": ["garden"] })]);
        let ep = Endpoint { endpoint: "https://ntfy.example/upAbc?up=1".into(), p256dh: "B".repeat(87), auth: "A".repeat(22) };
        let e = NotifyEntry { gateway: Some("https://push.example/".into()), ..entry(&me) };
        let body: Value = serde_json::from_slice(&register_body(&e, &ep, &regs)).unwrap();
        assert_eq!(body["signals"], json!(regs));
        assert!(serde_json::from_slice::<Value>(&register_body(&e, &ep, &[])).unwrap().get("signals").is_none());
        // never more rooms than the gateway takes: 50 + 50, and a third signal of 50 is left out
        let wide = |gid: &str| SignalEntry { gid: gid.into(), signal: "for-you".into(), relay: Some("wss://relay.example".into()), rooms: Some((0..50).map(|i| format!("room{i}")).collect()), ..list[0].clone() };
        assert_eq!(relay_signals(&[wide("YWFhYWFhYWFh"), wide("YmJiYmJiYmJi"), wide("Y2NjY2NjY2Nj")], "https://push.example/", "wss://relay.example").len(), 2);
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

    #[test]
    fn asks_for_the_permission_once_and_never_again_by_itself() {
        let d = std::env::temp_dir().join(format!("parachute-notify-ask-{}-{}", std::process::id(), nostr::secp256k1::rand::random::<u64>()));
        // nothing asks to tell the person anything yet: no question, and none used up
        assert!(!take_ask(&d, false));
        assert!(!d.join(ASKED_FILE).exists());
        // the first applet that does: asked once
        assert!(take_ask(&d, true));
        // every sync after (each return to the front) asks nothing, granted or denied
        assert!(!take_ask(&d, true));
        assert!(!take_ask(&d, true));
        let _ = std::fs::remove_dir_all(&d);
        // a mark that can't be kept asks nothing (asking each time is the loop Android ends by removing the app)
        let f = std::env::temp_dir().join(format!("parachute-notify-ask-file-{}", std::process::id()));
        std::fs::write(&f, b"x").unwrap();
        assert!(!take_ask(&f.join("app"), true));
        let _ = std::fs::remove_file(&f);
    }
}
