//! Signing in to a hub with the key: the hub's key door, `/api/auth/nostr/{challenge,verify}`. The door is the same on
//! core 0.8 and 0.9 and opens for any hub user the key is linked to. It starts the same hub session a password does;
//! the app then goes on through the hub's usual OAuth authorize (consent, then the code), so a vault signed in with a
//! key is held exactly like one signed in with a password (one kind of token, refreshed and revoked the same way).
//!
//! The shell does both requests itself, so the key never leaves it, and they carry no `Origin` (the door refuses a
//! foreign one). The session the hub answers with is put into the webview's cookies for the hub, and the app opens the
//! hub's authorize page with it. The signed event is NIP-98 shaped and bound by the hub to its own verify address, its
//! method and a single-use challenge: we build it here from those, never sign what the hub hands us as-is.

use std::time::Duration;

use nostr::base64::Engine;
use nostr::hashes::Hash;
use nostr::{EventBuilder, Kind, Tag};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Runtime, State, Webview};

use crate::key::KeyState;

pub const CHALLENGE_PATH: &str = "/api/auth/nostr/challenge";
pub const VERIFY_PATH: &str = "/api/auth/nostr/verify";
const SIGN_IN_KIND: u16 = 27235;

/// Why a key sign-in didn't happen, for the app to word: `no_key`, `no_door` (the hub has no key door: sign in another
/// way), `unknown_key` (the hub doesn't know this key), `refused`, `unreachable`, `bad_hub`.
#[derive(Serialize, Debug, PartialEq)]
pub struct Refusal {
    pub code: &'static str,
    pub message: String,
}

fn refusal(code: &'static str, message: impl Into<String>) -> Refusal {
    Refusal { code, message: message.into() }
}

/// What the hub answered: where to go next on the hub, and the cookies that carry its session there.
pub struct Session {
    pub set_cookies: Vec<String>,
    /// a path on the hub
    pub redirect: String,
}

/// Names only: a cookie's value is the hub session.
impl std::fmt::Debug for Session {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let names: Vec<&str> = self.set_cookies.iter().map(|c| c.split('=').next().unwrap_or("")).collect();
        f.debug_struct("Session").field("cookies", &names).field("redirect", &self.redirect).finish()
    }
}

/// The hub's origin, when it is one the app signs in to: https, or http on this machine.
pub fn hub_origin(raw: &str) -> Result<url::Url, Refusal> {
    let u = url::Url::parse(raw).map_err(|_| refusal("bad_hub", "That isn't a hub address."))?;
    let loopback = matches!(u.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if !(u.scheme() == "https" || (u.scheme() == "http" && loopback)) || u.host_str().is_none() {
        return Err(refusal("bad_hub", "A hub is signed in to over https."));
    }
    url::Url::parse(&u.origin().ascii_serialization()).map_err(|_| refusal("bad_hub", "That isn't a hub address."))
}

/// The hub's account MCP, where `list-vaults` answers which vaults a key's person may reach (docs/design/ONE-SIGN-IN.md).
pub const ACCOUNT_MCP_PATH: &str = "/account/mcp";
/// The one call the key signs there: list the person's vaults. Nothing else is ever signed for the web side.
pub const LIST_VAULTS_BODY: &str = r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list-vaults","arguments":{}}}"#;

/// The NIP-98 event for the one `list-vaults` request to this hub: kind 27235, `u` its account MCP on the hub's own
/// origin, `method` POST, a fresh `nonce` (two asks in the same second are two events), and `payload` the body's hash.
pub fn list_vaults_event(origin: &url::Url, nonce: &str) -> Result<EventBuilder, Refusal> {
    let bad = || refusal("refused", "The request to list your vaults couldn't be made.");
    let u = format!("{}{ACCOUNT_MCP_PATH}", origin.origin().ascii_serialization());
    let payload = nostr::hashes::sha256::Hash::hash(LIST_VAULTS_BODY.as_bytes()).to_string();
    let tag = |k: &str, v: &str| Tag::parse([k, v]).map_err(|_| bad());
    Ok(EventBuilder::new(Kind::from(SIGN_IN_KIND), "").tags([tag("u", &u)?, tag("method", "POST")?, tag("nonce", nonce)?, tag("payload", &payload)?]))
}

/// The vault names in the hub's answer to `list-vaults` (JSON, or one server-sent event carrying it): names a vault can
/// have, each once, sorted.
pub fn vault_names(body: &str) -> Option<Vec<String>> {
    let json = if body.trim_start().starts_with('{') { body.to_string() } else { body.lines().find_map(|l| l.strip_prefix("data:")).map(|d| d.trim().to_string())? };
    let v: Value = serde_json::from_str(&json).ok()?;
    if v.get("error").is_some() || v.pointer("/result/isError").and_then(Value::as_bool) == Some(true) {
        return None;
    }
    let text = v.pointer("/result/content")?.as_array()?.iter().find(|c| c.get("type").and_then(Value::as_str) == Some("text"))?.get("text")?.as_str()?;
    let inner: Value = serde_json::from_str(text).ok()?;
    let mut names: Vec<String> = inner
        .get("vaults")?
        .as_array()?
        .iter()
        .filter_map(|x| x.get("name").and_then(Value::as_str))
        .filter(|n| vault_name_ok(n))
        .map(str::to_string)
        .collect();
    names.sort();
    names.dedup();
    names.truncate(200);
    Some(names)
}

/// A vault's name, as the app takes one: lower-case letters, digits, `-` and `_`, starting with a letter or digit.
fn vault_name_ok(n: &str) -> bool {
    !n.is_empty() && n.len() <= 64 && n.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_') && n.as_bytes()[0] != b'-' && n.as_bytes()[0] != b'_'
}

static NONCES: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
fn nonce() -> String {
    let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("{t:x}{:x}", NONCES.fetch_add(1, std::sync::atomic::Ordering::Relaxed))
}

/// Ask the hub which vaults this key's person may reach.
pub async fn list_vaults(origin: &url::Url, keys: &nostr::Keys) -> Result<Vec<String>, Refusal> {
    let http = client()?;
    let event = list_vaults_event(origin, &nonce())?.sign_with_keys(keys).map_err(|_| refusal("refused", "The key couldn't sign."))?;
    let auth = format!("Nostr {}", nostr::base64::engine::general_purpose::STANDARD.encode(nostr::JsonUtil::as_json(&event)));
    let res = http
        .post(origin.join(ACCOUNT_MCP_PATH).expect("fixed path"))
        .header("Authorization", auth)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json, text/event-stream")
        .body(LIST_VAULTS_BODY)
        .send()
        .await
        .map_err(|_| refusal("unreachable", "The hub didn't answer."))?;
    let status = res.status().as_u16();
    let body = res.text().await.unwrap_or_default();
    match status {
        200 => vault_names(&body).ok_or_else(|| refusal("no_list", "The hub didn't list your vaults.")),
        401 if body.contains("not linked") || body.contains("unknown_pubkey") => Err(refusal("unknown_key", "This hub doesn't know your key yet.")),
        429 => Err(refusal("refused", "The hub asks to wait a moment before trying again.")),
        500..=599 => Err(refusal("unreachable", format!("The hub didn't answer ({status}). Try again in a moment."))),
        // no account MCP, or one that doesn't take a key: the app signs in to list them instead
        _ => Err(refusal("no_list", "This hub doesn't list vaults for a key.")),
    }
}

#[derive(Serialize)]
pub struct HubVaults {
    vaults: Vec<String>,
}

/// The vaults this device's key may reach on `hub`: one request the shell signs itself (the key never leaves it).
#[tauri::command]
pub async fn hub_vaults<R: Runtime>(app: AppHandle<R>, keys: State<'_, KeyState>, hub: String) -> Result<HubVaults, Refusal> {
    let origin = hub_origin(&hub)?;
    let held = keys.get(&app).await.map_err(|m| refusal("no_key", m))?.ok_or_else(|| refusal("no_key", "This device has no key."))?;
    Ok(HubVaults { vaults: list_vaults(&origin, &held).await? })
}

/// A same-hub path to go to after signing in (the authorize address), as the hub's `next` takes it.
pub fn next_path(origin: &url::Url, next: &str) -> Result<String, Refusal> {
    let u = origin.join(next).map_err(|_| refusal("bad_hub", "The sign-in's next step isn't on the hub."))?;
    if u.origin() != origin.origin() {
        return Err(refusal("bad_hub", "The sign-in's next step isn't on the hub."));
    }
    Ok(match u.query() {
        Some(q) => format!("{}?{}", u.path(), q),
        None => u.path().to_string(),
    })
}

/// The event to sign for a challenge: kind 27235, `u` = the hub's verify address on the origin the app signs in to,
/// `method` POST, the challenge. Only the statement (the words a signer shows) comes from the hub's template, and it
/// must name this hub. Behind a proxy (tailscale serve) a 0.8 hub writes its template with the address it sees itself
/// at, `http://` on the same host, while its verify step answers only to its public `https://` address; the statement
/// is then re-headed with the public address, which is the statement the hub checks for (`signInStatement(origin)`).
pub fn sign_in_event(origin: &url::Url, challenge: &Value) -> Result<EventBuilder, Refusal> {
    let bad = || refusal("refused", "The hub's sign-in challenge wasn't one this app can sign.");
    let nonce = challenge.get("challenge").and_then(Value::as_str).ok_or_else(bad)?;
    if nonce.len() < 32 || nonce.len() > 128 || !nonce.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(bad());
    }
    let template = challenge.get("event_template").ok_or_else(bad)?;
    let content = template.get("content").and_then(Value::as_str).ok_or_else(bad)?;
    if template.get("kind").and_then(Value::as_u64) != Some(SIGN_IN_KIND as u64) || content.len() > 2000 {
        return Err(bad());
    }
    let me = origin.origin().ascii_serialization();
    let named = template
        .get("tags")
        .and_then(Value::as_array)
        .and_then(|tags| tags.iter().find(|t| t.get(0).and_then(Value::as_str) == Some("u")))
        .and_then(|t| t.get(1))
        .and_then(Value::as_str)
        .and_then(|u| url::Url::parse(u).ok())
        .ok_or_else(bad)?;
    // the template must be this hub's: same host and port, the verify path (the scheme may be the proxy's)
    if named.host_str() != origin.host_str() || named.port() != origin.port() || !matches!(named.scheme(), "http" | "https") || named.path() != VERIFY_PATH {
        return Err(bad());
    }
    let them = named.origin().ascii_serialization();
    let rest = content.strip_prefix(&format!("{them} ")).ok_or_else(bad)?;
    let statement = format!("{me} {rest}");
    let verify = format!("{me}{VERIFY_PATH}");
    let tag = |k: &str, v: &str| Tag::parse([k, v]).map_err(|_| bad());
    Ok(EventBuilder::new(Kind::from(SIGN_IN_KIND), statement).tags([tag("u", &verify)?, tag("method", "POST")?, tag("challenge", nonce)?]))
}

fn client() -> Result<reqwest::Client, Refusal> {
    let mut roots = rustls::RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let provider = rustls::crypto::CryptoProvider::get_default().cloned().unwrap_or_else(|| std::sync::Arc::new(rustls::crypto::ring::default_provider()));
    let tls = rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|_| refusal("unreachable", "Secure connections aren't available."))?
        .with_root_certificates(roots)
        .with_no_client_auth();
    reqwest::Client::builder()
        .tls_backend_preconfigured(tls)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| refusal("unreachable", "Secure connections aren't available."))
}

/// Ask the hub for a challenge, sign it with `keys`, and hand it back: the hub's session, or why not.
pub async fn sign_in(origin: &url::Url, next: &str, keys: &nostr::Keys) -> Result<Session, Refusal> {
    let http = client()?;
    let unreachable = |_| refusal("unreachable", "The hub didn't answer.");
    let res = http.get(origin.join(CHALLENGE_PATH).expect("fixed path")).header("Accept", "application/json").send().await.map_err(unreachable)?;
    let status = res.status();
    let challenge: Option<Value> = res.json().await.ok().filter(|v: &Value| v.get("challenge").is_some() && v.get("event_template").is_some());
    let challenge = match (status.as_u16(), challenge) {
        (200, Some(c)) => c,
        (429, _) => return Err(refusal("refused", "The hub asks to wait a moment before trying again.")),
        // no such route, a page that isn't the door's answer, a redirect to a login, or something in front of the hub
        // that wants its own sign-in: no key door here (an older hub, Cloud)
        (200 | 300..=399 | 401 | 403 | 404 | 405 | 410, _) => return Err(refusal("no_door", "This hub doesn't take a key to sign in.")),
        (s, _) => return Err(refusal("unreachable", format!("The hub didn't answer the key sign-in ({s}). Try again in a moment."))),
    };
    let event = sign_in_event(origin, &challenge)?.sign_with_keys(keys).map_err(|_| refusal("refused", "The key couldn't sign."))?;
    let res = http
        .post(origin.join(VERIFY_PATH).expect("fixed path"))
        .header("Accept", "application/json")
        .json(&json!({ "event": event, "next": next }))
        .send()
        .await
        .map_err(unreachable)?;
    let status = res.status();
    let set_cookies: Vec<String> = res.headers().get_all("set-cookie").iter().filter_map(|v| v.to_str().ok().map(str::to_string)).collect();
    let body: Value = res.json().await.unwrap_or(Value::Null);
    let error = body.get("error").and_then(Value::as_str).unwrap_or_default();
    if status.as_u16() == 401 && error == "unknown_pubkey" {
        return Err(refusal("unknown_key", "This hub doesn't know your key yet."));
    }
    if !status.is_success() {
        let said = body.get("error_description").and_then(Value::as_str).unwrap_or(error);
        return Err(refusal("refused", format!("The hub refused the key ({}{}).", status.as_u16(), if said.is_empty() { String::new() } else { format!(": {}", said.chars().take(120).collect::<String>()) })));
    }
    let redirect = body.get("redirect").and_then(Value::as_str).unwrap_or("/");
    if on_hub(origin, redirect).is_none() || set_cookies.is_empty() {
        return Err(refusal("refused", "The hub's answer wasn't a sign-in."));
    }
    Ok(Session { set_cookies, redirect: redirect.to_string() })
}

/// A path the hub names, as an address on the hub itself (`/\\other.example` and the like resolve elsewhere: refused).
pub fn on_hub(origin: &url::Url, path: &str) -> Option<url::Url> {
    if !path.starts_with('/') {
        return None;
    }
    origin.join(path).ok().filter(|u| u.origin() == origin.origin())
}

#[derive(Serialize)]
pub struct SignedIn {
    /// the hub address to open next (the authorize page, or the hub's second-factor step)
    go: String,
}

/// Sign in to `hub` with this device's key and put the session in the calling webview, then say where to go: `next`
/// (the authorize address the app built) or the hub's second-factor step on the way there.
#[tauri::command]
pub async fn key_sign_in<R: Runtime>(app: AppHandle<R>, webview: Webview<R>, keys: State<'_, KeyState>, hub: String, next: String) -> Result<SignedIn, Refusal> {
    let origin = hub_origin(&hub)?;
    let next = next_path(&origin, &next)?;
    let held = keys.get(&app).await.map_err(|m| refusal("no_key", m))?.ok_or_else(|| refusal("no_key", "This device has no key."))?;
    let session = sign_in(&origin, &next, &held).await?;
    for raw in &session.set_cookies {
        plant_cookie(&webview, &origin, raw).await.map_err(|_| refusal("refused", "The hub's session couldn't be kept in the app."))?;
    }
    let go = on_hub(&origin, &session.redirect).ok_or_else(|| refusal("refused", "The hub's answer wasn't a sign-in."))?;
    Ok(SignedIn { go: go.to_string() })
}

/// One of the hub's cookies as the webview should keep it: for this hub's host only, whatever the header said.
pub fn host_only(raw: &str) -> Result<tauri::webview::cookie::Cookie<'static>, ()> {
    let mut c = tauri::webview::cookie::Cookie::parse(raw.to_string()).map_err(|_| ())?;
    c.unset_domain();
    if c.path().is_none() {
        c.set_path("/");
    }
    Ok(c)
}

/// Keep one of the hub's cookies in the webview, for the hub only.
async fn plant_cookie<R: Runtime>(webview: &Webview<R>, origin: &url::Url, raw: &str) -> Result<(), ()> {
    #[allow(unused_mut)]
    let mut c = host_only(raw)?;
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        // CookieManager takes a Set-Cookie line for a URL; with no Domain it keeps it for that URL's host only
        let plugin = webview.app_handle().try_state::<crate::android::KeyPluginHandle<R>>().map(|h| h.0.clone()).ok_or(())?;
        plugin
            .run_mobile_plugin_async::<Value>("setCookie", json!({ "url": origin.as_str(), "cookie": c.to_string() }))
            .await
            .map(|_| ())
            .map_err(|_| ())
    }
    #[cfg(not(target_os = "android"))]
    {
        // wry wants a domain to file the cookie under: the hub's host, exactly (libsoup keeps it host-only)
        c.set_domain(origin.host_str().ok_or(())?.to_string());
        webview.set_cookie(c).map_err(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cookies_stay_with_the_hub() {
        let c = host_only("parachute_hub_session=abc; HttpOnly; Secure; SameSite=Lax; Path=/; Domain=example; Max-Age=60").unwrap();
        assert_eq!(c.domain(), None);
        let line = c.to_string();
        assert!(line.starts_with("parachute_hub_session=abc") && line.contains("HttpOnly") && line.contains("Secure") && !line.contains("Domain"), "{line}");
        let s = Session { set_cookies: vec!["parachute_hub_session=secretvalue; Path=/".into()], redirect: "/".into() };
        assert!(!format!("{s:?}").contains("secretvalue"));
    }

    #[test]
    fn signs_only_the_list_of_vaults() {
        let o = hub_origin("https://hub.example/vault/notes").unwrap();
        let k = nostr::Keys::generate();
        let ev = list_vaults_event(&o, "n1").unwrap().sign_with_keys(&k).unwrap();
        assert_eq!(ev.kind, Kind::from(27235));
        assert_eq!(ev.content, "");
        let tags: Vec<Vec<String>> = ev.tags.iter().map(|t| t.as_slice().to_vec()).collect();
        // the hub's own account MCP, on its origin, whatever address was typed
        assert!(tags.contains(&vec!["u".into(), "https://hub.example/account/mcp".into()]), "{tags:?}");
        assert!(tags.contains(&vec!["method".into(), "POST".into()]));
        assert!(tags.contains(&vec!["nonce".into(), "n1".into()]));
        // the hash of the one fixed body (sha256 hex), so the signature covers what is asked and nothing else
        let payload = tags.iter().find(|t| t[0] == "payload").unwrap()[1].clone();
        assert_eq!(payload, nostr::hashes::sha256::Hash::hash(LIST_VAULTS_BODY.as_bytes()).to_string());
        assert_eq!(payload.len(), 64);
        assert_eq!(tags.len(), 4);
        assert!(ev.verify().is_ok());
        let other = list_vaults_event(&o, "n2").unwrap().sign_with_keys(&k).unwrap();
        assert_ne!(ev.id, other.id, "two asks are two events");
    }

    #[test]
    fn reads_the_list_of_vaults() {
        let inner = r#"{"covered":"listed","vaults":[{"name":"work","url":"x"},{"name":"kim"},{"name":"Bad Name"},{"name":"kim"},{"nope":1}]}"#;
        let body = json!({ "jsonrpc": "2.0", "id": 1, "result": { "content": [{ "type": "text", "text": inner }] } }).to_string();
        assert_eq!(vault_names(&body).unwrap(), vec!["kim".to_string(), "work".to_string()]);
        assert_eq!(vault_names(&format!("event: message\ndata: {body}\n\n")).unwrap(), vec!["kim".to_string(), "work".to_string()]);
        assert!(vault_names(r#"{"jsonrpc":"2.0","id":1,"error":{"code":-1}}"#).is_none());
        assert!(vault_names(r#"{"jsonrpc":"2.0","id":1,"result":{"isError":true,"content":[]}}"#).is_none());
        assert!(vault_names("not json").is_none());
    }

    #[test]
    fn hubs() {
        assert_eq!(hub_origin("https://hub.example/vault/x").unwrap().as_str(), "https://hub.example/");
        assert!(hub_origin("http://localhost:19390").is_ok());
        assert!(hub_origin("http://hub.example").is_err(), "plain http only on this machine");
        assert!(hub_origin("ftp://hub.example").is_err());
        assert!(hub_origin("nonsense").is_err());
    }

    #[test]
    fn next_stays_on_the_hub() {
        let o = hub_origin("https://hub.example").unwrap();
        assert_eq!(next_path(&o, "https://hub.example/oauth/authorize?a=1&b=2").unwrap(), "/oauth/authorize?a=1&b=2");
        assert_eq!(next_path(&o, "/oauth/authorize").unwrap(), "/oauth/authorize");
        assert!(next_path(&o, "https://other.example/oauth/authorize").is_err());
        assert!(next_path(&o, "//other.example/x").is_err());
        assert!(on_hub(&o, "/oauth/authorize?x=1").is_some());
        for away in ["//other.example/x", "/\\other.example/x", "https://other.example/", "other"] {
            assert!(on_hub(&o, away).is_none(), "{away}");
        }
    }

    fn challenge(u: &str, kind: u64, content: &str) -> Value {
        json!({ "challenge": "ab".repeat(32), "expires_at": "x", "event_template": { "kind": kind, "content": content,
            "tags": [["u", u], ["method", "GET"], ["challenge", "cd".repeat(32)], ["extra", "x"]] } })
    }

    #[test]
    fn signs_only_this_hubs_sign_in() {
        let o = hub_origin("https://hub.example").unwrap();
        let k = nostr::Keys::generate();
        let statement = "https://hub.example asks you to sign in to Parachute with your Nostr key.";
        let verify = "https://hub.example/api/auth/nostr/verify";
        let ev = sign_in_event(&o, &challenge(verify, 27235, statement)).unwrap().sign_with_keys(&k).unwrap();
        assert_eq!(ev.kind, Kind::from(27235));
        let tags: Vec<Vec<String>> = ev.tags.iter().map(|t| t.as_slice().to_vec()).collect();
        // only the hub's address is taken from its template: method, challenge and the rest are the app's own
        assert!(tags.contains(&vec!["u".into(), verify.into()]));
        assert!(tags.contains(&vec!["method".into(), "POST".into()]));
        assert!(tags.contains(&vec!["challenge".into(), "ab".repeat(32)]), "the challenge the hub issued, not a tag it slipped in");
        assert_eq!(tags.len(), 3);
        assert!(sign_in_event(&o, &challenge(verify, 1, statement)).is_err(), "another kind");
        assert!(sign_in_event(&o, &challenge(verify, 27235, "https://other.example asks you to sign in")).is_err(), "another hub's words");
        assert!(sign_in_event(&o, &challenge("https://other.example/api/auth/nostr/verify", 27235, "https://other.example asks")).is_err(), "another hub");
        assert!(sign_in_event(&o, &challenge("https://hub.example/api/other", 27235, statement)).is_err(), "another path");
        // behind a proxy the hub sees itself as http on the same host: signed for its public address, words re-headed
        let proxied = sign_in_event(&o, &challenge("http://hub.example/api/auth/nostr/verify", 27235, "http://hub.example asks you to sign in to Parachute with your Nostr key.")).unwrap().sign_with_keys(&k).unwrap();
        assert_eq!(proxied.tags.iter().find(|t| t.as_slice()[0] == "u").unwrap().as_slice()[1], verify);
        assert_eq!(proxied.content, statement);
        assert!(sign_in_event(&o, &challenge("http://hub.example/api/auth/nostr/verify", 27235, statement)).is_err(), "words must name the template's address");
        assert!(sign_in_event(&o, &challenge("https://hub.example:8443/api/auth/nostr/verify", 27235, "https://hub.example:8443 asks")).is_err(), "another port");
        let mut bad = challenge(verify, 27235, statement);
        bad["challenge"] = json!("not hex");
        assert!(sign_in_event(&o, &bad).is_err());
    }
}
