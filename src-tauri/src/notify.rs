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
}

impl PushOp {
    fn path(self) -> &'static str {
        match self {
            PushOp::Register => "register",
            PushOp::Unregister => "unregister",
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
pub fn register_body(e: &NotifyEntry, ep: &Endpoint) -> Vec<u8> {
    let body = json!({ "endpoint": ep.endpoint, "keys": { "p256dh": ep.p256dh, "auth": ep.auth }, "relay": e.relay, "rooms": e.rooms, "mentions": e.mentions, "from": e.from });
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

/// The `at` to keep for a registration made `now`: a pending one is due again after a day.
/** What a gateway said when it refused (its answer's `error`), for Settings: one short line, plain characters only. */
pub fn gateway_said(answer: &[u8]) -> String {
    let why = serde_json::from_slice::<Value>(answer).ok().and_then(|v| v.get("error").and_then(Value::as_str).map(str::to_string)).unwrap_or_default();
    let why: String = why.chars().filter(|c| !c.is_control()).take(120).collect();
    if why.trim().is_empty() { String::new() } else { format!(": {}", why.trim()) }
}

pub fn kept_at(now: u64, answer: &[u8]) -> u64 {
    let pending = serde_json::from_slice::<Value>(answer).ok().and_then(|v| v.get("pending").and_then(Value::as_bool)) == Some(true);
    if pending { now.saturating_sub(RENEW_S - RENEW_PENDING_S) } else { now }
}

/// The list the last `notify_set` checked: `push_register` registers only what is on it.
#[derive(Default)]
pub struct NotifyState(Mutex<Vec<NotifyEntry>>);

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
    let send = |op: PushOp, body: Vec<u8>, subject: String, name: String| {
        let (broker, hubs, client, k, gateway) = (broker, &hubs, &client, &k, gateway.clone());
        async move {
            let url = push_url(&gateway, op)?;
            broker.guard(hubs, &url).await.map_err(|r| r.message)?;
            let ev = crate::services::nip98_event(k, &url, "POST", Some(&body)).map_err(|r| r.message)?;
            broker.log_outside(&subject, &name, "push gateway", format!("POST {}", url.path()), Some(ev.id.to_hex())).map_err(|r| r.message)?;
            let res = client
                .post(url)
                .header(reqwest::header::AUTHORIZATION, crate::services::authorization(&ev))
                .header(reqwest::header::CONTENT_TYPE, "application/json")
                .body(body)
                .send()
                .await
                .map_err(|_| "The gateway didn't answer.".to_string())?;
            let status = res.status().as_u16();
            // the answer's first 4 KB at most (`{ok, expires, pending}`)
            let mut res = res;
            let mut answer = Vec::new();
            while let Ok(Some(chunk)) = res.chunk().await {
                answer.extend_from_slice(&chunk[..chunk.len().min(4096 - answer.len())]);
                if answer.len() >= 4096 {
                    break;
                }
            }
            Ok::<(u16, Vec<u8>), String>((status, answer))
        }
    };
    match op {
        PushOp::Register => {
            let e = entry.ok_or("No allowed applet names that gateway for that relay.")?;
            let ep = endpoint(&app, &gateway).await?.checked()?;
            let body = register_body(&e, &ep);
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
    *app.state::<NotifyState>().0.lock().unwrap_or_else(|e| e.into_inner()) = entries.clone();
    #[cfg(target_os = "android")]
    {
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
        let body: Value = serde_json::from_slice(&register_body(&e, &ep)).unwrap();
        assert_eq!(body, json!({ "endpoint": "https://ntfy.example/upAbc?up=1", "keys": { "p256dh": "B".repeat(87), "auth": "A".repeat(22) }, "relay": "wss://relay.example", "rooms": ["garden"], "mentions": true, "from": ["c".repeat(64)] }));
        assert!(!String::from_utf8(register_body(&e, &ep)).unwrap().contains("Rooms"), "the applet's name and address stay on the phone");
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
