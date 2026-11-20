//! The native half of the service broker (docs/design/SERVICES.md): every use of the key, and every signed request, for
//! an applet that talks to servers. The web side registers an allowed applet's declared services for its frame's session
//! (`svc_open`); every later call names only the session and a service id. Each call is checked here again against that
//! registration (kinds, tags, path under the prefix, the declared relay, hubs), and every auth event is built here from
//! what is actually being sent. A line is written to the applet's log for each signature made.
//!
//! The core is [`Broker`]: plain methods over `&Keys` and a data directory, so tests drive it without an app. The
//! `svc_*` commands at the bottom are thin wrappers that take the key from [`KeyState`].
//!
//! Errors are `{ code, message }`. Codes: `no_key`, `no_session`, `not_granted` (no such service in the session),
//! `out_of_scope` (a kind, tag, path, header, method, size or file outside the declaration), `bad_service` (a
//! declaration Rust refuses), `bad_event` (a private note that isn't the person's own, or doesn't open), `no_token`,
//! `too_large`, `unreachable`, `failed` (the server answered an upload or media read with an error status), `storage`,
//! `refused` (the key couldn't sign or seal),
//! and the hub guards: `hub_known` (a hub this device signed in to), `hub_listed` (on the web side's list), `hub_probe`
//! (it answers as a hub), `hub_unsure` (the probe couldn't finish: nothing signed this time), `hub_path` (a path under
//! /account/, /api/auth/ or /vault/).

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use nostr::base64::engine::general_purpose::STANDARD as B64;
use nostr::base64::Engine;
use nostr::hashes::{sha256, Hash};
use nostr::nips::nip44;
use nostr::nips::nip44::v2::ConversationKey;
use nostr::{Event, EventBuilder, JsonUtil, Keys, Kind, Tag};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, Runtime, State};
use url::Url;
use zeroize::Zeroizing;

use crate::key::KeyState;

/// Kinds no applet may have signed, whatever its service declares (docs/design/SERVICES.md "Kinds the shell never signs").
/// Every other kind an applet's relay service lists in `publish` is signed, and only there: the manifest is the
/// declaration, its card names each kind, and widening `publish` changes the grant's key, so the person is asked again.
/// These are refused because signing one would hand over the person's identity, their money, an authority they hold
/// (admin, owner, approver) or one of the shell's own protocols. When it wasn't clear whether a kind was dangerous, it
/// is here: a later version can take one off when an applet needs it.
pub const DENIED_KINDS: [u16; 31] = [
    0,     // the profile: who the person is, everywhere
    3,     // the contact list: the people they follow, overwritten whole
    8,     // a badge award (NIP-58): the person vouching for others as an issuer
    13,    // a seal (NIP-59): the shell seals its approval answers with the person's key (approvals/wrap.rs)
    62,    // a request to vanish (NIP-62): asks relays to delete everything the person ever posted
    443,   // an MLS key package (Marmot, NIP-EE) and its addressable twin: a key of the applet's choosing that others'
    30443, // encrypted groups would invite as the person
    1776,  // a key migration (NIP-41, draft): the person's identity moving to another key
    1777,
    2022,  // a coinjoin (Joinstr): money
    1021,  // an auction bid and its confirmation (NIP-15): money owed
    1022,
    1059,  // a gift wrap (NIP-59): the shell's sealed messages travel in these (approvals/wrap.rs)
    4550,  // a community moderator's approval of a post (NIP-72)
    7374,  // a Cashu wallet's quote, token and history (NIP-60): money
    7375,
    7376,
    9321,  // a nutzap (NIP-61): money
    9734,  // a zap request (NIP-57): money
    9735,  // a zap receipt (NIP-57)
    30078, // the person's private notes: the shell signs these only sealed, through `private`
    30350, // a push lease (Buzz NIP-PL): where the person's notifications go
    30402, // a classified listing and its draft (NIP-99): an offer to sell
    30403,
    34128, // a site's file and its manifest (NIP-5A, nsite): the person's website
    35128,
    34550, // a community's definition (NIP-72): who moderates it
    37375, // a Cashu wallet (NIP-60, the first draft): money
    38383, // a peer-to-peer trade order (NIP-69): money
    // 30479 (an approval of a security change) and 30480 (the person's list of keys, approve.rs) are here by name,
    // so no change to the ranges below could let them through
    crate::approve::APPROVAL_KIND,
    crate::approve::KEYS_KIND,
];
/// Ranges no applet may have signed, ends included.
/// - 1630 to 1633, a git maintainer's status on a patch or issue (NIP-34): open, merged, closed, draft.
/// - 5000 to 7000, data vending (NIP-90): job requests carry a bid the person then owes; results and feedback ask for
///   payment.
/// - 9000 to 9099, running a room or a relay: NIP-29 (9000 and 9001 add and remove members, 9005 deletes other
///   people's posts, which kind 5 may not, 9008 deletes a room), Buzz's relay membership (9030 to 9033), its archiving
///   of an identity (9035, 9036) and its moderation (9040 to 9044: ban, timeout).
/// - 10000 to 19999, replaceable events (NIP-01): the one copy of a setting every Nostr app of the person's reads, and
///   a new one replaces it whole: their relays (10002), mutes (10000), DM relays (10050), file servers (10063), nutzap
///   details (10019), wallet connect (13194), Cashu wallet (17375) and Buzz agent profile (10100).
/// - 20000 to 29999, ephemeral events, except typing (20002): where Nostr signs people in and lets other programs act
///   for them: a relay's AUTH (22242), NIP-98 HTTP auth (27235, which would sign the applet in to the person's hub or
///   gateway as them), Blossom auth (24242), remote signing (NIP-46, 24133), wallet connect (23194 to 23197), Buzz
///   pairing (24134) and identity binding (24243), and NIP-43 joins (28934 to 28936).
/// - 30017 to 30020, a market's stalls, products and auctions (NIP-15): offers to sell.
/// - 30174 to 30179, Buzz's agents, personas and teams the person owns (an agent's definition and memory).
/// - 30617 and 30618, a git repository's announcement and state (NIP-34): Buzz creates repositories from the first and
///   reads branch protection from it; the second says where each branch points.
/// - 30620 to 30622, Buzz's workflow definitions, projects and DM visibility.
/// - 40000 to 49999, except edits (40003): Buzz's commands, signed by the person as an order: DMs opened and members
///   added (41010 to 41012), agent jobs (43001 to 43006), workflows triggered and their approvals granted or denied
///   (46001 to 46031), the shell's own approval desk (46040 to 46042: a secret delivered, a secret forgotten, an
///   approval card's answer, approvals/) and admin (48000 to 48999).
pub const DENIED_RANGES: [(u16, u16); 10] = [
    (1630, 1633),
    (5000, 7000),
    (9000, 9099),
    (10000, 19999),
    (20000, 29999),
    (30017, 30020),
    (30174, 30179),
    (30617, 30618),
    (30620, 30622),
    (40000, 49999),
];
/// Kinds a denied range keeps for applets: typing and edits.
pub const RANGE_EXCEPTIONS: [u16; 2] = [TYPING_KIND, 40003];

/// Is this kind one no applet may have signed, declared or not.
pub fn denied_kind(kind: u16) -> bool {
    DENIED_KINDS.contains(&kind) || (!RANGE_EXCEPTIONS.contains(&kind) && DENIED_RANGES.iter().any(|(a, b)| (*a..=*b).contains(&kind)))
}
/// Tags an applet's event may not carry: they are what sign-ins and signed requests are made of.
pub const AUTH_TAGS: [&str; 7] = ["u", "method", "payload", "challenge", "relay", "server", "expiration"];
pub const METHODS: [&str; 6] = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"];
pub const REQUEST_HEADERS: [&str; 5] = ["content-type", "accept", "if-match", "if-none-match", "range"];
pub const RESPONSE_HEADERS: [&str; 5] = ["content-type", "content-length", "etag", "last-modified", "location"];
/// Paths nothing is signed for, on any origin: a hub's account, its sign-in door and its vaults.
pub const HUB_PATHS: [&str; 3] = ["/account", "/api/auth", "/vault"];
pub const MAX_BYTES: usize = 25 * 1024 * 1024;
pub const MAX_CONTENT: usize = 64 * 1024;
pub const MAX_PRIVATE_TEXT: usize = 32 * 1024;
pub const MAX_TOKEN: usize = 4096;
pub const LOG_LINES: usize = 500;
const MAX_SERVICES: usize = 6;
/// A file of up to 25 MB on a phone's connection takes longer than a request's 30 seconds.
const MEDIA_TIMEOUT: Duration = Duration::from_secs(300);
const MAX_SESSIONS: usize = 256;
const PRIVATE_KIND: u16 = 30078;
const TYPING_KIND: u16 = 20002;
const RELAY_AUTH_KIND: u16 = 22242;
const HTTP_AUTH_KIND: u16 = 27235;
const BLOSSOM_KIND: u16 = 24242;
const TOKEN_SALT: &[u8] = b"parachute-service-tokens-v1";
const TOKENS_FILE: &str = "service-tokens.json";
const LOG_DIR: &str = "service-log";

/// The same `{ code, message }` the key door answers with.
pub use crate::door::Refusal;

fn no(code: &'static str, message: impl Into<String>) -> Refusal {
    Refusal { code, message: message.into() }
}
fn scope(message: impl Into<String>) -> Refusal {
    no("out_of_scope", message)
}
fn bad(message: impl Into<String>) -> Refusal {
    no("bad_service", message)
}

// ── the declaration ──

#[derive(Clone, Debug, PartialEq)]
pub struct PrivateEntry {
    pub d: String,
    pub t: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Auth {
    None,
    Nip98,
    Token,
}

/// `approve` on an http service (docs/design/KEYRING.md): a JSON body whose `field` is one of `ops` is signed with the
/// approval key; the everyday key signs only a JSON body whose `field` is a string not in `ops`.
#[derive(Clone, Debug, PartialEq)]
pub struct Approve {
    pub field: String,
    pub ops: Vec<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum ServiceKind {
    /// `rooms`: the NIP-29 ids it is limited to (empty: every room); `approvals`: the keys (hex) whose cards and secret
    /// requests it may answer with the approval key (empty: none).
    Relay { publish: Vec<u16>, media: bool, private: Vec<PrivateEntry>, rooms: Vec<String>, approvals: Vec<String> },
    /// `join` (docs/design/KEYRING.md "Joining a network"): a JSON body whose `field` is one of its ops asks to join a
    /// private network, signed with the person's key only after this device's `join` level (levels.rs).
    Http { auth: Auth, approve: Option<Approve>, join: Option<Approve> },
}

/// One declared service, normalised: `url` as the web side shows and keys it (a relay's without its trailing `/`, an
/// http prefix with it), and `origin` the https (or http) origin requests and the hub guard use (a relay's media server).
#[derive(Clone, Debug, PartialEq)]
pub struct Service {
    pub id: String,
    pub url: String,
    pub origin: Url,
    pub kind: ServiceKind,
}

fn is_loopback(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "[::1]")
}

/// Characters a person can't see, or that turn text around: never in an address or a name.
fn hidden(c: char) -> bool {
    c.is_control() || matches!(c, '\u{ad}' | '\u{200b}'..='\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{2060}'..='\u{2064}' | '\u{2066}'..='\u{2069}' | '\u{feff}')
}

/// `scheme://host[:port]`, the host without a trailing dot, the port only when it isn't the scheme's default: how origins
/// are compared everywhere here.
pub fn origin_key(u: &Url) -> String {
    let host = u.host_str().unwrap_or("").trim_end_matches('.');
    match u.port() {
        Some(p) => format!("{}://{host}:{p}", u.scheme()),
        None => format!("{}://{host}", u.scheme()),
    }
}

/// A service's address made plain, as `src/applet/services.ts normalUrl`: one secure scheme, or the plain one to this
/// device only; no user, password, query or fragment; a path of plain segments; the host without its trailing dot.
pub(crate) fn normal_url(raw: &Value, secure: &str, plain: &str, prefix: bool) -> Result<Url, String> {
    let raw = raw.as_str().ok_or("url must be one plain address")?;
    if raw.is_empty() || raw.encode_utf16().count() > 300 || raw.chars().any(|c| hidden(c) || c.is_whitespace() || c == '\\') {
        return Err("url must be one plain address".into());
    }
    let mut u = Url::parse(raw).map_err(|_| "url must be an address")?;
    if !u.username().is_empty() || u.password().is_some() || u.query().is_some() || u.fragment().is_some() || raw.contains(['?', '#', '@']) {
        return Err("url can't have a name, password, query or fragment".into());
    }
    let host = u.host_str().unwrap_or("").trim_end_matches('.').to_string();
    if host.is_empty() {
        return Err("url needs a host".into());
    }
    if !(u.scheme() == secure || (u.scheme() == plain && is_loopback(&host))) {
        return Err(format!("url must be {secure} (or {plain} to this device)"));
    }
    // the path as written, before the parser could fold a dot segment or an encoded character into another path
    let after = &raw[raw.find("://").map(|i| i + 3).unwrap_or(0)..];
    let written = after.find('/').map(|i| &after[i..]).unwrap_or("/");
    if plain_path(written).is_err() {
        return Err("url's path must be plain".into());
    }
    if prefix && !u.path().ends_with('/') {
        return Err("an http service's url ends in / (it is a prefix)".into());
    }
    if u.host_str() != Some(host.as_str()) {
        u.set_host(Some(&host)).map_err(|_| "url needs a host")?;
    }
    Ok(u)
}

/// A path (before any query) with no raw `.`/`..` segment and no encoded `.`, `/`, `\` or `%`.
fn plain_path(p: &str) -> Result<(), ()> {
    let lower = p.to_ascii_lowercase();
    if ["%2e", "%2f", "%5c", "%25"].iter().any(|e| lower.contains(e)) || p.split('/').any(|s| s == "." || s == "..") {
        return Err(());
    }
    Ok(())
}

fn kebab(id: &str) -> bool {
    !id.is_empty() && id.len() <= 40 && id.split('-').all(|part| !part.is_empty() && part.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit()))
}

/// `^[a-z0-9][a-z0-9_.-]{0,38}:$`
fn d_prefix_ok(d: &str) -> bool {
    let b = d.as_bytes();
    (2..=40).contains(&b.len())
        && (b[0].is_ascii_lowercase() || b[0].is_ascii_digit())
        && b[b.len() - 1] == b':'
        && b[1..b.len() - 1].iter().all(|&c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, b'_' | b'.' | b'-'))
}

/// `^[a-z0-9][a-z0-9_-]{0,39}$`
fn t_word_ok(t: &str) -> bool {
    let b = t.as_bytes();
    (1..=40).contains(&b.len()) && (b[0].is_ascii_lowercase() || b[0].is_ascii_digit()) && b.iter().all(|&c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, b'_' | b'-'))
}

fn only_keys(o: &serde_json::Map<String, Value>, allowed: &[&str]) -> bool {
    o.keys().all(|k| allowed.contains(&k.as_str()))
}

/// One service as the web side parsed it (`src/applet/services.ts`), checked again here. Anything wrong refuses it.
fn is_hex_key(k: &str) -> bool {
    k.len() == 64 && k.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// A short list (`min` to 4) of public keys, 64 lowercase hex each, each once; sorted.
fn hex_keys(x: Option<&Value>, min: usize) -> Option<Vec<String>> {
    let xs = x?.as_array()?;
    if xs.len() < min || xs.len() > 4 {
        return None;
    }
    let mut out: Vec<String> = Vec::new();
    for k in xs {
        let k = k.as_str().filter(|k| is_hex_key(k))?;
        if out.iter().any(|o| o == k) {
            return None;
        }
        out.push(k.to_string());
    }
    out.sort();
    Some(out)
}

/// A room id as Buzz names one (a NIP-29 group id): letters, digits, `-` and `_`, 1 to 64.
pub fn room_id_ok(id: &str) -> bool {
    (1..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// `rooms`: 1 to 12 `{id, name}`, each id once. Only the ids are kept: they are what is enforced.
fn parse_rooms(x: Option<&Value>) -> Result<Vec<String>, String> {
    let Some(x) = x else { return Ok(Vec::new()) };
    let xs = x.as_array().filter(|xs| (1..=12).contains(&xs.len())).ok_or("rooms is a list of 1 to 12")?;
    let mut out: Vec<String> = Vec::new();
    for r in xs {
        let r = r.as_object().filter(|r| only_keys(r, &["id", "name"])).ok_or("a room is {id, name}")?;
        let id = r.get("id").and_then(Value::as_str).filter(|id| room_id_ok(id)).ok_or("a room's id is as the relay names it")?;
        let name = r.get("name").and_then(Value::as_str).ok_or("a room has a name")?;
        if name.trim().is_empty() || name.chars().count() > 40 || name.chars().any(|c| hidden(c) || c == '\n' || c == '\t' || c == '«' || c == '»') {
            return Err("a room's name is one short line".into());
        }
        if out.iter().any(|o| o == id) {
            return Err("rooms names a room twice".into());
        }
        out.push(id.to_string());
    }
    out.sort();
    Ok(out)
}

fn field_ok(f: &str) -> bool {
    let b = f.as_bytes();
    (1..=40).contains(&b.len()) && b[0].is_ascii_lowercase() && b.iter().all(|c| c.is_ascii_alphanumeric() || *c == b'_')
}

fn op_ok(o: &str) -> bool {
    let b = o.as_bytes();
    (1..=40).contains(&b.len()) && b[0].is_ascii_lowercase() && b.iter().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || b"._-".contains(c))
}

pub fn parse_service(x: &Value) -> Result<Service, Refusal> {
    let o = x.as_object().ok_or_else(|| bad("each service is an object"))?;
    let id = o.get("id").and_then(Value::as_str).filter(|id| kebab(id)).ok_or_else(|| bad("a service's id is short kebab-case"))?.to_string();
    match o.get("kind").and_then(Value::as_str) {
        Some("nostr-relay") => {
            if !only_keys(o, &["id", "kind", "url", "publish", "media", "private", "rooms", "approvals", "notify"]) {
                return Err(bad(format!("{id}: a relay is {{id, kind, url, publish?, media?, private?, rooms?, approvals?, notify?}}")));
            }
            let u = normal_url(o.get("url").unwrap_or(&Value::Null), "wss", "ws", false).map_err(|e| bad(format!("{id}: {e}")))?;
            let mut publish: Vec<u16> = Vec::new();
            match o.get("publish") {
                None => {}
                Some(Value::Array(ks)) if ks.len() <= 16 => {
                    for k in ks {
                        let k = k.as_u64().filter(|k| *k <= u16::MAX as u64).map(|k| k as u16);
                        match k {
                            Some(k) if denied_kind(k) => return Err(bad(format!("{id}: no applet may publish kind {k}: it would sign as you in a way the shell keeps for itself"))),
                            Some(k) if !publish.contains(&k) => publish.push(k),
                            _ => return Err(bad(format!("{id}: publish is a list of kinds, each once"))),
                        }
                    }
                }
                _ => return Err(bad(format!("{id}: publish is a short list of kinds"))),
            }
            publish.sort_unstable();
            let media = match o.get("media") {
                None => false,
                Some(Value::Bool(b)) => *b,
                _ => return Err(bad(format!("{id}: media is true or false"))),
            };
            let mut private: Vec<PrivateEntry> = Vec::new();
            match o.get("private") {
                None => {}
                Some(Value::Array(ps)) if ps.len() <= 2 => {
                    for p in ps {
                        let p = p.as_object().filter(|p| only_keys(p, &["kind", "d", "t"]) && p.get("kind").and_then(Value::as_u64) == Some(PRIVATE_KIND as u64));
                        let p = p.ok_or_else(|| bad(format!("{id}: a private entry is {{kind: 30078, d, t}}")))?;
                        let d = p.get("d").and_then(Value::as_str).filter(|d| d_prefix_ok(d)).ok_or_else(|| bad(format!("{id}: a private entry's d is a short prefix ending in :")))?;
                        let t = p.get("t").and_then(Value::as_str).filter(|t| t_word_ok(t)).ok_or_else(|| bad(format!("{id}: a private entry's t is one short word")))?;
                        if private.iter().any(|e| d.starts_with(&e.d) || e.d.starts_with(d)) {
                            return Err(bad(format!("{id}: two private entries overlap")));
                        }
                        private.push(PrivateEntry { d: d.to_string(), t: t.to_string() });
                    }
                }
                _ => return Err(bad(format!("{id}: private is a short list"))),
            }
            let rooms = parse_rooms(o.get("rooms")).map_err(|e| bad(format!("{id}: {e}")))?;
            let approvals = match o.get("approvals") {
                None => Vec::new(),
                Some(Value::Object(a)) if only_keys(a, &["from"]) => hex_keys(a.get("from"), 1).ok_or_else(|| bad(format!("{id}: approvals.from is a list of 1 to 4 public keys (hex)")))?,
                _ => return Err(bad(format!("{id}: approvals is {{from: [keys]}}"))),
            };
            match o.get("notify") {
                None => {}
                Some(Value::Object(n)) if only_keys(n, &["mentions", "from", "gateway"]) => {
                    let mentions = match n.get("mentions") {
                        None => false,
                        Some(Value::Bool(b)) => *b,
                        _ => return Err(bad(format!("{id}: notify.mentions is true or false"))),
                    };
                    let from = match n.get("from") {
                        None => Vec::new(),
                        f => hex_keys(f, 0).ok_or_else(|| bad(format!("{id}: notify.from is a list of at most 4 public keys (hex)")))?,
                    };
                    if !mentions && from.is_empty() {
                        return Err(bad(format!("{id}: notify says what to tell you about")));
                    }
                    // the push gateway (docs/design/SERVICES.md): an http service's kind of address; push_register
                    // checks it again, and that it isn't a hub, before it signs anything for it (notify.rs)
                    if let Some(g) = n.get("gateway") {
                        normal_url(g, "https", "http", true).map_err(|e| bad(format!("{id}: notify.gateway: {e}")))?;
                    }
                }
                _ => return Err(bad(format!("{id}: notify is {{mentions?, from?, gateway?}}"))),
            }
            let url = u.as_str().strip_suffix('/').unwrap_or(u.as_str()).to_string();
            let twin = format!("{}://{}", if u.scheme() == "wss" { "https" } else { "http" }, origin_key(&u).split_once("://").map(|x| x.1).unwrap_or(""));
            let origin = Url::parse(&twin).map_err(|_| bad(format!("{id}: url must be an address")))?;
            Ok(Service { id, url, origin, kind: ServiceKind::Relay { publish, media, private, rooms, approvals } })
        }
        Some("http") => {
            if !only_keys(o, &["id", "kind", "url", "auth", "approve", "join"]) {
                return Err(bad(format!("{id}: an http service is {{id, kind, url, auth?, approve?, join?}}")));
            }
            let u = normal_url(o.get("url").unwrap_or(&Value::Null), "https", "http", true).map_err(|e| bad(format!("{id}: {e}")))?;
            let auth = match o.get("auth").map(|a| a.as_str()) {
                None | Some(Some("none")) => Auth::None,
                Some(Some("nip98")) => Auth::Nip98,
                Some(Some("token")) => Auth::Token,
                _ => return Err(bad(format!("{id}: auth is none, nip98 or token"))),
            };
            let ops_line = |name: &str| -> Result<Option<Approve>, Refusal> {
                match o.get(name) {
                    None => Ok(None),
                    Some(Value::Object(a)) if only_keys(a, &["field", "ops"]) && auth == Auth::Nip98 => {
                        let field = a.get("field").and_then(Value::as_str).filter(|f| field_ok(f)).ok_or_else(|| bad(format!("{id}: {name}.field is the JSON body's field that names the op")))?;
                        let ops = a.get("ops").and_then(Value::as_array).filter(|xs| (1..=4).contains(&xs.len())).ok_or_else(|| bad(format!("{id}: {name}.ops is a short list")))?;
                        let mut out: Vec<String> = Vec::new();
                        for x in ops {
                            match x.as_str().filter(|x| op_ok(x)) {
                                Some(x) if !out.iter().any(|o| o == x) => out.push(x.to_string()),
                                _ => return Err(bad(format!("{id}: {name}.ops are op names, each once"))),
                            }
                        }
                        out.sort();
                        Ok(Some(Approve { field: field.to_string(), ops: out }))
                    }
                    _ => Err(bad(format!("{id}: {name} is {{field, ops}}, on an http service signed with nip98"))),
                }
            };
            let approve = ops_line("approve")?;
            let join = ops_line("join")?;
            // one op, one meaning: a body can't be both an approval and a join
            if let (Some(a), Some(j)) = (&approve, &join) {
                if a.field != j.field || a.ops.iter().any(|op| j.ops.contains(op)) {
                    return Err(bad(format!("{id}: approve and join name their ops in one field, each op in one of them")));
                }
            }
            let origin = Url::parse(&origin_key(&u)).map_err(|_| bad(format!("{id}: url must be an address")))?;
            Ok(Service { id, url: u.as_str().to_string(), origin, kind: ServiceKind::Http { auth, approve, join } })
        }
        _ => Err(bad(format!("{id}: kind is nostr-relay or http"))),
    }
}

// ── what the applet asks to have signed ──

/// An event the applet asks to publish: a kind its service declared there and not one the shell keeps
/// ([`denied_kind`]), plain tags none of which is shaped like auth or the shell's enrollment, and for a deletion only
/// `e` (and `h`) tags. Returns (kind, content, tags).
/// With `rooms`, the event carries exactly one `h` tag, one of them. Text that reads as a command approval for a bot
/// (Hermes's `/approve`, `/deny`) is signed only when `may_approve` (the applet holds the approvals grant there).
pub fn check_template(publish: &[u16], rooms: &[String], may_approve: bool, raw: &Value) -> Result<(u16, String, Vec<Vec<String>>), Refusal> {
    let o = raw.as_object().filter(|o| only_keys(o, &["kind", "content", "tags"])).ok_or_else(|| scope("an event is {kind, content, tags}"))?;
    let kind = o.get("kind").and_then(Value::as_u64).filter(|k| *k <= u16::MAX as u64).map(|k| k as u16);
    let kind = kind.filter(|k| !denied_kind(*k) && publish.contains(k)).ok_or_else(|| scope(format!("it may not publish kind {} there", o.get("kind").unwrap_or(&Value::Null))))?;
    let content = match o.get("content") {
        None => String::new(),
        Some(Value::String(s)) if s.len() <= MAX_CONTENT => s.clone(),
        _ => return Err(scope("content is text, at most 64 KiB")),
    };
    let raw_tags = match o.get("tags") {
        None => Vec::new(),
        Some(Value::Array(t)) if t.len() <= 100 => t.clone(),
        _ => return Err(scope("tags are a list of at most 100")),
    };
    let mut tags: Vec<Vec<String>> = Vec::with_capacity(raw_tags.len());
    for t in &raw_tags {
        let t: Vec<String> = t
            .as_array()
            .filter(|t| (1..=12).contains(&t.len()))
            .and_then(|t| t.iter().map(|v| v.as_str().filter(|s| s.encode_utf16().count() <= 1024).map(str::to_string)).collect::<Option<Vec<_>>>())
            .ok_or_else(|| scope("a tag is a short list of words"))?;
        if AUTH_TAGS.contains(&t[0].as_str()) {
            return Err(scope(format!("a {} tag is for sign-ins, not posts", t[0])));
        }
        // the approval key's enrollment with Uni is a kind 9 with this tag (approvals/seal.rs); while the approval key
        // is the everyday key, an applet's would enroll a sealing key of its own choosing
        if t[0] == "t" && t.get(1).is_some_and(|v| v == crate::approvals::ENROLL_TAG) {
            return Err(scope("that t tag is the shell's own"));
        }
        if kind == 5 && t[0] != "e" && t[0] != "h" {
            return Err(scope("a deletion names its events by e tags only"));
        }
        if t[0] == "e" && !t.get(1).is_some_and(|v| is_hex64(v)) {
            return Err(scope("an e tag names an event id"));
        }
        tags.push(t);
    }
    if kind == 5 && !tags.iter().any(|t| t[0] == "e") {
        return Err(scope("a deletion names the events it deletes"));
    }
    if !rooms.is_empty() {
        let hs: Vec<&Vec<String>> = tags.iter().filter(|t| t[0] == "h").collect();
        if hs.len() != 1 || !hs[0].get(1).is_some_and(|h| rooms.contains(h)) {
            return Err(scope("it may post only in its rooms there"));
        }
    }
    // any kind: a bot may read whatever it is shown in a room, edits and new kinds as well as messages
    if !may_approve && is_command_approval(&content) {
        return Err(no("not_granted", "Answering a bot's approval needs the approvals grant."));
    }
    Ok((kind, content, tags))
}

/// Which key signs a request to an http service (docs/design/KEYRING.md).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Role {
    Everyday,
    /// The approval key, for this op.
    Approval(String),
    /// The person's key, for this join op, after the `join` level (levels.rs).
    Join(String),
}

/// A JSON object whose top-level keys are each named once (serde_json would keep the last of two silently).
struct UniqueObject(serde_json::Map<String, Value>);

impl<'de> Deserialize<'de> for UniqueObject {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> serde::de::Visitor<'de> for V {
            type Value = UniqueObject;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("a JSON object")
            }
            fn visit_map<A: serde::de::MapAccess<'de>>(self, mut a: A) -> Result<UniqueObject, A::Error> {
                let mut m = serde_json::Map::new();
                while let Some((k, v)) = a.next_entry::<String, Value>()? {
                    if m.insert(k, v).is_some() {
                        return Err(serde::de::Error::custom("a key is named twice"));
                    }
                }
                Ok(UniqueObject(m))
            }
        }
        d.deserialize_map(V)
    }
}

/// For a service with `approve` (docs/design/KEYRING.md): the approval key for a body that is a JSON object whose
/// `field` is one of `ops`; the everyday key for no body, a JSON body that isn't an object, or an object without that
/// field or with another string there. Anything a server might read differently from this is refused, so the split
/// fails closed: a body that isn't JSON as serde reads it (a gateway's parser may take a byte-order mark, NaN or another
/// encoding), a key named twice (most parsers keep the last), or the field holding anything but a string. Without
/// `approve`, the everyday key.
pub fn http_role(approve: Option<&Approve>, body: Option<&[u8]>) -> Result<Role, Refusal> {
    let Some(a) = approve else { return Ok(Role::Everyday) };
    let body = match body {
        None => return Ok(Role::Everyday),
        Some(b) if b.is_empty() => return Ok(Role::Everyday),
        Some(b) => b,
    };
    let refused = || scope(format!("a request to this service with a body is plain JSON, its {} named once, as text", a.field));
    if !body.first().is_some_and(|c| matches!(c, b'{' | b'[' | b'"' | b't' | b'f' | b'n' | b'-' | b'0'..=b'9' | b' ' | b'\n' | b'\r' | b'\t')) {
        return Err(refused());
    }
    let obj: UniqueObject = match serde_json::from_slice::<UniqueObject>(body) {
        Ok(o) => o,
        // not an object: valid JSON of another shape is everyday; anything else is refused
        Err(_) => return serde_json::from_slice::<Value>(body).ok().filter(|v| !v.is_object()).map(|_| Role::Everyday).ok_or_else(refused),
    };
    match obj.0.get(&a.field) {
        None => Ok(Role::Everyday),
        Some(Value::String(op)) if a.ops.iter().any(|o| o == op) => Ok(Role::Approval(op.clone())),
        Some(Value::String(_)) => Ok(Role::Everyday),
        Some(_) => Err(refused()),
    }
}

/// Which key and gate a request takes, with both lines: an approve op, a join op (`Role::Join`), or the everyday key.
/// Each split fails closed as `http_role` does.
pub fn roles(approve: Option<&Approve>, join: Option<&Approve>, body: Option<&[u8]>) -> Result<Role, Refusal> {
    match http_role(approve, body)? {
        Role::Everyday => match http_role(join, body)? {
            Role::Approval(op) => Ok(Role::Join(op)),
            r => Ok(r),
        },
        r => Ok(r),
    }
}

/// Characters a bot's parser may drop before a command: Unicode white space, C0 and C1 controls, and the invisible
/// format characters (zero-width, bidi marks, word joiners, the byte-order mark).
fn droppable(c: char) -> bool {
    c.is_whitespace() || c.is_control() || matches!(c, '\u{200b}'..='\u{200f}' | '\u{2028}'..='\u{202f}' | '\u{2060}'..='\u{206f}' | '\u{feff}' | '\u{00ad}' | '\u{034f}' | '\u{180e}')
}

/// Text a bot may take as the owner's approval (Hermes's `/approve`, `/deny`), read as leniently as such a bot reads
/// it: what it drops before a command (droppable characters, then a leading mention: `@name`, `nostr:npub1…`,
/// `npub1…`, a 64-hex key, each with `:` or `,` after it) is dropped here too, case ignored. Same rule as
/// applet/services.ts `isCommandApproval`. Bare words a bot may take while it waits ("yes", "ok") are not caught:
/// that would stop ordinary chat; KEYRING.md says so.
pub fn is_command_approval(content: &str) -> bool {
    let mut t: &str = content;
    for _ in 0..8 {
        t = t.trim_start_matches(droppable);
        // a word ends at a droppable character, `:` or `,`; a `nostr:` prefix is part of its word
        let skip = if t.to_lowercase().starts_with("nostr:") { 6 } else { 0 };
        let word_end = t[skip..].find(|c: char| droppable(c) || c == ':' || c == ',').map(|i| i + skip).unwrap_or(t.len());
        let word = &t[..word_end];
        let lower = word.to_lowercase();
        let mention = lower.starts_with('@')
            || lower.starts_with("nostr:npub1")
            || lower.starts_with("npub1")
            || (word.len() == 64 && word.bytes().all(|b| b.is_ascii_hexdigit()));
        if !mention || word.is_empty() {
            break;
        }
        t = t[word_end..].trim_start_matches(|c: char| droppable(c) || c == ':' || c == ',');
    }
    let t = t.to_lowercase();
    t.starts_with("/approve") || t.starts_with("/deny")
}

fn is_hex64(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn tag(parts: &[&str]) -> Result<Tag, Refusal> {
    Tag::parse(parts.iter().map(|s| s.to_string())).map_err(|_| scope("a tag couldn't be made"))
}

fn sign(keys: &Keys, builder: EventBuilder) -> Result<Event, Refusal> {
    builder.sign_with_keys(keys).map_err(|_| no("refused", "The key couldn't sign."))
}

/// The applet's event, signed as checked: tags exactly as given (a reaction to one's own post keeps its `p`).
pub fn sign_template(keys: &Keys, kind: u16, content: &str, tags: &[Vec<String>]) -> Result<Event, Refusal> {
    let tags = tags.iter().map(|t| Tag::parse(t.clone()).map_err(|_| scope("a tag couldn't be made"))).collect::<Result<Vec<_>, _>>()?;
    sign(keys, EventBuilder::new(Kind::from(kind), content).tags(tags).allow_self_tagging())
}

/// NIP-42: kind 22242 for the declared relay URL and the relay's challenge (1–256 printable ASCII characters).
pub fn relay_auth_event(keys: &Keys, relay: &str, challenge: &str) -> Result<Event, Refusal> {
    if challenge.is_empty() || challenge.len() > 256 || !challenge.bytes().all(|b| (0x20..=0x7e).contains(&b)) {
        return Err(scope("a relay's challenge is a short line"));
    }
    sign(keys, EventBuilder::new(Kind::from(RELAY_AUTH_KIND), "").tags([tag(&["relay", relay])?, tag(&["challenge", challenge])?]))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn random_nonce() -> String {
    hex(&nostr::secp256k1::rand::random::<[u8; 16]>())
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    sha256::Hash::hash(bytes).to_string()
}

/// NIP-98 for one request: kind 27235, `u` the exact URL sent, `method`, a random `nonce`, and `payload` the body's
/// sha256 when there is a body.
pub fn nip98_event(keys: &Keys, url: &Url, method: &str, body: Option<&[u8]>) -> Result<Event, Refusal> {
    nip98_with(keys, url, method, body, None)
}

/// The tag only a join op's NIP-98 carries (docs/design/KEYRING.md "Joining a network"): the everyday path never adds
/// it, and no applet signs kind 27235 itself, so an enroller that requires it knows this device's join level passed.
pub const JOIN_MARK: [&str; 2] = ["parachute", "join"];

/// NIP-98 for a join op: the same event with `JOIN_MARK` and the op.
pub fn nip98_join_event(keys: &Keys, url: &Url, method: &str, body: Option<&[u8]>, op: &str) -> Result<Event, Refusal> {
    nip98_with(keys, url, method, body, Some(op))
}

fn nip98_with(keys: &Keys, url: &Url, method: &str, body: Option<&[u8]>, join: Option<&str>) -> Result<Event, Refusal> {
    let mut tags = vec![tag(&["u", url.as_str()])?, tag(&["method", method])?, tag(&["nonce", &random_nonce()])?];
    if let Some(b) = body {
        tags.push(tag(&["payload", &sha256_hex(b)])?);
    }
    if let Some(op) = join {
        tags.push(tag(&[JOIN_MARK[0], JOIN_MARK[1], op])?);
    }
    sign(keys, EventBuilder::new(Kind::from(HTTP_AUTH_KIND), "").tags(tags))
}

pub fn authorization(ev: &Event) -> String {
    format!("Nostr {}", B64.encode(ev.as_json()))
}

/// The two Blossom verbs the shell signs; there is no way to say delete or list.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Blossom {
    Upload,
    Get,
}

/// Kind 24242 for one blob: `t` the verb, `x` its hash, `server` the media server's host, five minutes to live.
pub fn blossom_event(keys: &Keys, verb: Blossom, sha256: &str, server: &str) -> Result<Event, Refusal> {
    let (t, content) = match verb {
        Blossom::Upload => ("upload", "Upload"),
        Blossom::Get => ("get", "Get"),
    };
    let expiration = (nostr::Timestamp::now().as_secs() + 300).to_string();
    sign(keys, EventBuilder::new(Kind::from(BLOSSOM_KIND), content).tags([tag(&["t", t])?, tag(&["x", sha256])?, tag(&["server", server])?, tag(&["expiration", &expiration])?]))
}

/// The address of a request to an http service: its url followed by `path` as written (one leading `/` dropped, joined
/// as text, never resolved), which must land under the url's prefix on its origin. A query is allowed.
pub fn request_url(base: &str, path: &str) -> Result<Url, Refusal> {
    if path.encode_utf16().count() > 2000 || path.chars().any(|c| c <= ' ' || c == '\u{7f}' || c == '\\' || c == '#') {
        return Err(scope("a path is plain text"));
    }
    let before_query = path.split('?').next().unwrap_or("");
    plain_path(before_query).map_err(|_| scope("a path's segments must be plain"))?;
    let full = format!("{base}{}", path.strip_prefix('/').unwrap_or(path));
    let u = Url::parse(&full).map_err(|_| scope("not an address"))?;
    let b = Url::parse(base).map_err(|_| scope("not an address"))?;
    if origin_key(&u) != origin_key(&b) || !u.path().starts_with(b.path()) || !u.username().is_empty() || u.password().is_some() || u.fragment().is_some() {
        return Err(scope("outside what it may reach"));
    }
    Ok(u)
}

/// Is this a path nothing is signed for, on any origin (a hub's account, sign-in door or vaults)? Checked as a server
/// that decodes escapes and folds repeated slashes would route it: `//account/x` and `/%61ccount/x` are `/account/x`.
pub fn hub_path(path: &str) -> bool {
    let decoded = percent_decode(path).to_ascii_lowercase();
    let mut p = String::with_capacity(decoded.len());
    for c in decoded.chars() {
        if !(c == '/' && p.ends_with('/')) {
            p.push(c);
        }
    }
    HUB_PATHS.iter().any(|h| p == *h || p.starts_with(&format!("{h}/")) || p.starts_with(&format!("{h};")))
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        let h = |c: u8| (c as char).to_digit(16).map(|d| d as u8);
        if b[i] == b'%' && i + 2 < b.len() {
            if let (Some(x), Some(y)) = (h(b[i + 1]), h(b[i + 2])) {
                out.push(x * 16 + y);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn decode_body(b64: &str) -> Result<Vec<u8>, Refusal> {
    if b64.len() > MAX_BYTES.div_ceil(3) * 4 + 4 {
        return Err(no("too_large", "at most 25 MB"));
    }
    let bytes = B64.decode(b64).map_err(|_| scope("a body is base64"))?;
    if bytes.len() > MAX_BYTES {
        return Err(no("too_large", "at most 25 MB"));
    }
    Ok(bytes)
}

/// A media type as a header can carry it.
fn media_type_ok(t: &str) -> bool {
    !t.is_empty() && t.len() <= 200 && t.contains('/') && t.bytes().all(|b| (0x20..=0x7e).contains(&b))
}

// ── sealing (NIP-44 v2) ──

/// NIP-44 v2 to oneself: what a private note holds.
pub fn seal_to_self(keys: &Keys, text: &str) -> Result<String, Refusal> {
    nip44::encrypt(keys.secret_key(), &keys.public_key(), text, nip44::Version::V2).map_err(|_| no("refused", "The note couldn't be sealed."))
}

pub fn open_from_self(keys: &Keys, payload: &str) -> Result<String, Refusal> {
    nip44::decrypt(keys.secret_key(), &keys.public_key(), payload).map_err(|_| no("bad_event", "The note doesn't open with your key."))
}

/// The key a token is sealed with: derived from the secret key for this purpose only, per applet and service. HKDF-SHA256,
/// salt `parachute-service-tokens-v1`, info `subject \0 id \0 url`.
pub fn token_key(keys: &Keys, subject: &str, id: &str, url: &str) -> ConversationKey {
    let secret = Zeroizing::new(keys.secret_key().secret_bytes());
    let prk = nostr::util::hkdf::extract(TOKEN_SALT, secret.as_slice());
    let info = format!("{subject}\0{id}\0{url}");
    let okm = Zeroizing::new(nostr::util::hkdf::expand(prk.as_byte_array(), info.as_bytes(), 32));
    let mut bytes = Zeroizing::new([0u8; 32]);
    bytes.copy_from_slice(&okm);
    ConversationKey::new(*bytes)
}

pub fn seal_token(keys: &Keys, subject: &str, id: &str, url: &str, token: &str) -> Result<String, Refusal> {
    let ck = token_key(keys, subject, id, url);
    nip44::v2::encrypt_to_bytes(&ck, token.as_bytes()).map(|b| B64.encode(b)).map_err(|_| no("storage", "The token couldn't be sealed."))
}

pub fn open_token(keys: &Keys, subject: &str, id: &str, url: &str, sealed: &str) -> Option<Zeroizing<String>> {
    let ck = token_key(keys, subject, id, url);
    let bytes = B64.decode(sealed).ok()?;
    let plain = nip44::v2::decrypt_to_bytes(&ck, &bytes).ok()?;
    String::from_utf8(plain).ok().map(Zeroizing::new)
}

fn token_slot(subject: &str, id: &str, url: &str) -> String {
    sha256_hex(format!("{subject}\0{id}\0{url}").as_bytes())
}

/// A grant subject or applet name: short, no NUL (the derivation's separator) and nothing hidden.
fn name_ok(s: &str, max: usize) -> bool {
    !s.is_empty() && s.len() <= max && !s.chars().any(hidden)
}

// ── the log ──

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct LogLine {
    /// unix seconds
    pub at: u64,
    pub applet: String,
    pub service: String,
    pub what: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub count: Option<u32>,
}

// ── files in the app's data directory ──

pub(crate) fn read_json<T: for<'de> Deserialize<'de> + Default>(path: &Path) -> T {
    std::fs::read(path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

/// Write whole, through a temporary file, so a crash leaves the old file or the new one.
pub(crate) fn write_json<T: Serialize>(path: &Path, value: &T) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension(format!("tmp{}", std::process::id()));
    std::fs::write(&tmp, serde_json::to_vec(value).map_err(std::io::Error::other)?)?;
    std::fs::rename(&tmp, path)
}

// ── the broker ──

struct Session {
    applet: String,
    subject: String,
    services: HashMap<String, Service>,
    hubs: HashSet<String>,
    opened: u64,
}

/// An approvals call's applet: its grant subject, and its relay service's rooms (empty: all) and approvers (hex).
pub(crate) struct Grantee {
    pub subject: String,
    pub rooms: Vec<String>,
    pub from: Vec<String>,
}

/// What a call needs from its session, copied out so no lock is held across a request.
struct Call {
    applet: String,
    subject: String,
    service: Service,
    hubs: HashSet<String>,
}

#[derive(Deserialize, Debug, Clone)]
pub struct Applet {
    pub name: String,
    pub subject: String,
}

#[derive(Serialize, Debug)]
pub struct Opened {
    pub pubkey: String,
}

#[derive(Deserialize, Debug, Clone, Default)]
pub struct HttpReq {
    pub method: String,
    pub path: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub body: Option<String>,
}

#[derive(Serialize, Debug)]
pub struct HttpRes {
    pub status: u16,
    pub headers: BTreeMap<String, String>,
    /// base64
    pub body: String,
    /// An approve op an earlier unlock covered (keyring.rs grace): the shell says so over the applet.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub graced: bool,
}

#[derive(Serialize, Debug)]
pub struct Media {
    #[serde(rename = "type")]
    pub media_type: String,
    /// base64
    pub body: String,
}

pub struct Broker {
    dir: PathBuf,
    sessions: Mutex<HashMap<String, Session>>,
    /// origin → answers as a hub; only definite answers are kept (for this run)
    probes: Mutex<HashMap<String, bool>>,
    files: Mutex<()>,
    opened: std::sync::atomic::AtomicU64,
    http: reqwest::Client,
    probe_http: reqwest::Client,
}

impl Broker {
    /// A broker keeping its files (tokens, the log; the hubs signed in to are door.rs's) in `dir`.
    pub fn new(dir: PathBuf) -> Result<Self, Refusal> {
        let client = |secs| crate::door::http_client(Duration::from_secs(secs)).map_err(|_| no("unreachable", "Secure connections aren't available."));
        Ok(Broker {
            dir,
            sessions: Mutex::new(HashMap::new()),
            probes: Mutex::new(HashMap::new()),
            files: Mutex::new(()),
            opened: std::sync::atomic::AtomicU64::new(0),
            http: client(30)?,
            probe_http: client(10)?,
        })
    }

    /// Register an allowed applet's services for a frame's session (a session id already open is replaced). Every
    /// service is checked again; one Rust refuses, or one on a hub this device knows or the web side lists, refuses all.
    pub fn open(&self, keys: &Keys, session: &str, applet: &Applet, services: &[Value], hubs: &[String]) -> Result<Opened, Refusal> {
        if !name_ok(session, 128) || !name_ok(&applet.name, 200) || !name_ok(&applet.subject, 512) {
            return Err(bad("a session, applet name or subject that isn't plain"));
        }
        if services.len() > MAX_SERVICES {
            return Err(bad("at most 6 services"));
        }
        if hubs.len() > 1000 {
            return Err(bad("at most 1000 hubs on the list"));
        }
        let mut listed = HashSet::new();
        for h in hubs {
            let u = Url::parse(h).ok().filter(|u| matches!(u.scheme(), "http" | "https") && u.host_str().is_some()).ok_or_else(|| bad("a hub on the list isn't an address"))?;
            listed.insert(origin_key(&u));
        }
        let known: HashSet<String> = crate::door::signed_in_hubs(&self.dir).into_iter().collect();
        let mut by_id = HashMap::new();
        for raw in services {
            let s = parse_service(raw)?;
            let o = origin_key(&s.origin);
            if known.contains(&o) {
                return Err(no("hub_known", format!("{}: that address is a Parachute hub this device signs in to", s.id)));
            }
            if listed.contains(&o) {
                return Err(no("hub_listed", format!("{}: that address is one of your Parachute hubs", s.id)));
            }
            if by_id.insert(s.id.clone(), s).is_some() {
                return Err(bad("a service id is named twice"));
            }
        }
        let mut sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        if sessions.len() >= MAX_SESSIONS && !sessions.contains_key(session) {
            // frames that ended without closing (a reload of the web side): the oldest goes
            if let Some(oldest) = sessions.iter().min_by_key(|(_, s)| s.opened).map(|(k, _)| k.clone()) {
                sessions.remove(&oldest);
            }
        }
        let opened = self.opened.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        sessions.insert(session.to_string(), Session { applet: applet.name.clone(), subject: applet.subject.clone(), services: by_id, hubs: listed, opened });
        Ok(Opened { pubkey: keys.public_key().to_hex() })
    }

    pub fn close(&self, session: &str) {
        self.sessions.lock().unwrap_or_else(|e| e.into_inner()).remove(session);
    }

    fn call(&self, session: &str, service: &str) -> Result<Call, Refusal> {
        let sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        let s = sessions.get(session).ok_or_else(|| no("no_session", "This applet's session isn't open."))?;
        let svc = s.services.get(service).ok_or_else(|| no("not_granted", format!("{service} isn't one of this applet's services")))?;
        Ok(Call { applet: s.applet.clone(), subject: s.subject.clone(), service: svc.clone(), hubs: s.hubs.clone() })
    }

    fn relay(call: &Call) -> Result<(&Vec<u16>, bool, &Vec<PrivateEntry>), Refusal> {
        match &call.service.kind {
            ServiceKind::Relay { publish, media, private, .. } => Ok((publish, *media, private)),
            ServiceKind::Http { .. } => Err(scope(format!("{} isn't a relay", call.service.id))),
        }
    }

    /// What an approvals call needs from its session (docs/design/KEYRING.md): the applet's grant subject, and the
    /// relay service's rooms and approvers. Refused when that service has no approvals line.
    pub(crate) fn approvals_of(&self, session: &str, service: &str) -> Result<Grantee, Refusal> {
        let call = self.call(session, service)?;
        match &call.service.kind {
            ServiceKind::Relay { rooms, approvals, .. } if !approvals.is_empty() => Ok(Grantee { subject: call.subject.clone(), rooms: rooms.clone(), from: approvals.clone() }),
            ServiceKind::Relay { .. } => Err(no("not_granted", "It may not answer approvals there.")),
            ServiceKind::Http { .. } => Err(scope(format!("{service} isn't a relay"))),
        }
    }

    /// The host a service talks to, as the unlock prompt names it.
    pub(crate) fn host_of(&self, session: &str, service: &str) -> Result<String, Refusal> {
        let call = self.call(session, service)?;
        Ok(call.service.origin.host_str().unwrap_or("").to_string())
    }

    /// The applet's grant subject for a session (an unlock's grace belongs to it).
    pub(crate) fn subject_of(&self, session: &str) -> Result<String, Refusal> {
        let sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        sessions.get(session).map(|s| s.subject.clone()).ok_or_else(|| no("no_session", "This applet's session isn't open."))
    }

    /// The signing log, for a signature made outside this file (an approval's seal, cards.rs).
    pub(crate) fn log_for(&self, session: &str, service: &str, what: String, id: Option<String>) -> Result<(), Refusal> {
        let call = self.call(session, service)?;
        self.log(&call, what, id, false)
    }

    /// Write a line for a signature just made. Typing within a minute of the same line folds into it with a count.
    fn log(&self, call: &Call, what: String, id: Option<String>, fold: bool) -> Result<(), Refusal> {
        let _g = self.files.lock().unwrap_or_else(|e| e.into_inner());
        let path = self.log_path(&call.subject);
        let mut lines: Vec<LogLine> = read_json(&path);
        let at = nostr::Timestamp::now().as_secs();
        let folded = fold
            && lines.last_mut().is_some_and(|last| {
                let same = last.applet == call.applet && last.service == call.service.id && last.what == what && at.saturating_sub(last.at) < 60;
                if same {
                    last.count = Some(last.count.unwrap_or(1).saturating_add(1));
                    last.id = id.clone();
                }
                same
            });
        if !folded {
            lines.push(LogLine { at, applet: call.applet.clone(), service: call.service.id.clone(), what, id, count: None });
        }
        if lines.len() > LOG_LINES {
            lines.drain(..lines.len() - LOG_LINES);
        }
        write_json(&path, &lines).map_err(|_| no("storage", "The log couldn't be written, so nothing was signed."))
    }

    /// A line for a signature made for an applet outside a frame's session: its push gateway registration (notify.rs).
    pub(crate) fn log_outside(&self, subject: &str, applet: &str, service: &str, what: String, id: Option<String>) -> Result<(), Refusal> {
        let _g = self.files.lock().unwrap_or_else(|e| e.into_inner());
        let path = self.log_path(subject);
        let mut lines: Vec<LogLine> = read_json(&path);
        lines.push(LogLine { at: nostr::Timestamp::now().as_secs(), applet: applet.to_string(), service: service.to_string(), what, id, count: None });
        if lines.len() > LOG_LINES {
            lines.drain(..lines.len() - LOG_LINES);
        }
        write_json(&path, &lines).map_err(|_| no("storage", "The log couldn't be written, so nothing was signed."))
    }

    fn log_path(&self, subject: &str) -> PathBuf {
        self.dir.join(LOG_DIR).join(format!("{}.json", sha256_hex(subject.as_bytes())))
    }

    /// The lines kept for an applet (by its grant subject), oldest first.
    pub fn log_lines(&self, subject: &str) -> Vec<LogLine> {
        let _g = self.files.lock().unwrap_or_else(|e| e.into_inner());
        read_json(&self.log_path(subject))
    }

    /// Before anything is signed for a request to `url`: not a hub this device signed in to, not one the web side
    /// lists, not a hub's own path, and not an origin that answers as a hub (asked once per run; no answer = no).
    pub async fn guard(&self, hubs: &HashSet<String>, url: &Url) -> Result<(), Refusal> {
        let origin = origin_key(url);
        if crate::door::signed_in_hubs(&self.dir).contains(&origin) {
            return Err(no("hub_known", "That is a Parachute hub this device signs in to: nothing is signed for it."));
        }
        if hubs.contains(&origin) {
            return Err(no("hub_listed", "That is one of your Parachute hubs: nothing is signed for it."));
        }
        if hub_path(url.path()) {
            return Err(no("hub_path", "Nothing is signed for an account, sign-in or vault path."));
        }
        self.probe(&origin).await
    }

    async fn probe(&self, origin: &str) -> Result<(), Refusal> {
        let known = self.probes.lock().unwrap_or_else(|e| e.into_inner()).get(origin).copied();
        let is_hub = match known {
            Some(h) => h,
            None => {
                let unsure = || no("hub_unsure", "Couldn't tell whether that server is a Parachute hub, so nothing was signed. Try again.");
                let mut hub = false;
                for p in ["/.well-known/parachute-account", "/.well-known/parachute.json"] {
                    let res = self.probe_http.get(format!("{origin}{p}")).header("accept", "application/json").send().await.map_err(|_| unsure())?;
                    let status = res.status().as_u16();
                    // a server in trouble or asking to wait hasn't answered: nothing is signed this time. 501 is an
                    // answer: it does no GET at all (the Uni app's mail gateway), and a hub serves these files on GET
                    // a redirect isn't followed, and isn't an answer either: a hub behind one would pass for none
                    if (status >= 500 && status != 501) || status == 429 || (300..400).contains(&status) {
                        return Err(unsure());
                    }
                    // 2xx with a JSON body: a hub. Other 4xx, 2xx with anything else: not on this path.
                    if (200..300).contains(&status) {
                        let body = read_capped(res, 256 * 1024).await.map_err(|_| unsure())?;
                        if serde_json::from_slice::<Value>(&body).is_ok() {
                            hub = true;
                            break;
                        }
                    }
                }
                self.probes.lock().unwrap_or_else(|e| e.into_inner()).insert(origin.to_string(), hub);
                hub
            }
        };
        if is_hub {
            Err(no("hub_probe", "That server answers as a Parachute hub: nothing is signed for it."))
        } else {
            Ok(())
        }
    }

    pub fn relay_auth(&self, keys: &Keys, session: &str, service: &str, challenge: &str) -> Result<Event, Refusal> {
        let call = self.call(session, service)?;
        Self::relay(&call)?;
        let ev = relay_auth_event(keys, &call.service.url, challenge)?;
        self.log(&call, "sign-in".into(), Some(ev.id.to_hex()), false)?;
        Ok(ev)
    }

    pub fn sign_event(&self, keys: &Keys, session: &str, service: &str, template: &Value) -> Result<Event, Refusal> {
        let call = self.call(session, service)?;
        let (publish, _, _) = Self::relay(&call)?;
        let (rooms, approvals) = match &call.service.kind {
            ServiceKind::Relay { rooms, approvals, .. } => (rooms, approvals),
            ServiceKind::Http { .. } => return Err(scope("not a relay")),
        };
        let (kind, content, tags) = check_template(publish, rooms, !approvals.is_empty(), template)?;
        let ev = sign_template(keys, kind, &content, &tags)?;
        self.log(&call, format!("kind {kind}"), Some(ev.id.to_hex()), kind == TYPING_KIND)?;
        Ok(ev)
    }

    /// Which key a request would be signed with (the command takes the device unlock before an approval).
    pub fn http_role(&self, session: &str, service: &str, req: &HttpReq) -> Result<Role, Refusal> {
        let call = self.call(session, service)?;
        match &call.service.kind {
            ServiceKind::Http { auth: Auth::Nip98, approve, join } => {
                let body = req.body.as_deref().map(decode_body).transpose()?;
                roles(approve.as_ref(), join.as_ref(), body.as_deref())
            }
            ServiceKind::Http { .. } => Ok(Role::Everyday),
            ServiceKind::Relay { .. } => Err(scope(format!("{service} isn't an http service"))),
        }
    }

    /// Send a request, signed (for nip98) with `keys` in `role`: the role is worked out again here from what is sent,
    /// and must be the one the caller took the keys for.
    pub async fn http(&self, keys: &Keys, role: &Role, session: &str, service: &str, req: &HttpReq) -> Result<HttpRes, Refusal> {
        let call = self.call(session, service)?;
        let (auth, approve, join) = match &call.service.kind {
            ServiceKind::Http { auth, approve, join } => (*auth, approve.clone(), join.clone()),
            ServiceKind::Relay { .. } => return Err(scope(format!("{service} isn't an http service"))),
        };
        let method = req.method.to_ascii_uppercase();
        if !METHODS.contains(&method.as_str()) {
            return Err(scope("the method is GET, HEAD, POST, PUT, PATCH or DELETE"));
        }
        let url = request_url(&call.service.url, &req.path)?;
        let mut headers = reqwest::header::HeaderMap::new();
        for (k, v) in &req.headers {
            let k = k.to_ascii_lowercase();
            if let Some(name) = REQUEST_HEADERS.iter().find(|h| **h == k) {
                let v = reqwest::header::HeaderValue::from_str(v).map_err(|_| scope(format!("{k} isn't a plain header value")))?;
                if headers.insert(*name, v).is_some() {
                    return Err(scope(format!("{k} is named twice")));
                }
            }
        }
        let body = req.body.as_deref().map(decode_body).transpose()?;
        match auth {
            Auth::Nip98 => {
                let worked_out = roles(approve.as_ref(), join.as_ref(), body.as_deref())?;
                if &worked_out != role {
                    return Err(no("refused", "That request is signed with another key."));
                }
                self.guard(&call.hubs, &url).await?;
                let ev = match role {
                    Role::Join(op) => nip98_join_event(keys, &url, &method, body.as_deref(), op)?,
                    _ => nip98_event(keys, &url, &method, body.as_deref())?,
                };
                let with = match role {
                    Role::Everyday => String::new(),
                    Role::Approval(op) => format!(" ({op}, approval key)"),
                    Role::Join(op) => format!(" ({op}, joining a network)"),
                };
                self.log(&call, format!("{method} {}{with}", url.path()), Some(ev.id.to_hex()), false)?;
                headers.insert(reqwest::header::AUTHORIZATION, reqwest::header::HeaderValue::from_str(&authorization(&ev)).map_err(|_| scope("auth"))?);
            }
            Auth::Token => {
                let token = self.token_get(keys, &call.subject, &call.service)?.ok_or_else(|| no("no_token", "Give it a token first."))?;
                let bearer = Zeroizing::new(format!("Bearer {}", token.as_str()));
                let mut v = reqwest::header::HeaderValue::from_str(&bearer).map_err(|_| no("no_token", "The token kept isn't usable."))?;
                v.set_sensitive(true);
                headers.insert(reqwest::header::AUTHORIZATION, v);
            }
            Auth::None => {}
        }
        let m = reqwest::Method::from_bytes(method.as_bytes()).map_err(|_| scope("method"))?;
        let mut rb = self.http.request(m, url).headers(headers);
        if let Some(b) = body {
            rb = rb.body(b);
        }
        let res = rb.send().await.map_err(|_| no("unreachable", "The server didn't answer."))?;
        let status = res.status().as_u16();
        let mut out = BTreeMap::new();
        for h in RESPONSE_HEADERS {
            if let Some(v) = res.headers().get(h).and_then(|v| v.to_str().ok()) {
                out.insert(h.to_string(), v.to_string());
            }
        }
        let body = read_capped(res, MAX_BYTES).await?;
        Ok(HttpRes { status, headers: out, body: B64.encode(body), graced: false })
    }

    fn media_server(call: &Call) -> Result<(), Refusal> {
        match Self::relay(call)? {
            (_, true, _) => Ok(()),
            _ => Err(scope(format!("{} has no media", call.service.id))),
        }
    }

    /// `host[:port]` of the relay's media server, as the `server` tag names it.
    fn server_tag(origin: &Url) -> String {
        origin_key(origin).split_once("://").map(|x| x.1.to_string()).unwrap_or_default()
    }

    /// Upload a file to the relay's media server (Blossom): PUT /upload, or /media/upload when that isn't there. The
    /// server's descriptor comes back as it said it.
    pub async fn upload(&self, keys: &Keys, session: &str, service: &str, body_b64: &str, media_type: &str) -> Result<Value, Refusal> {
        let call = self.call(session, service)?;
        Self::media_server(&call)?;
        let media_type = if media_type.is_empty() { "application/octet-stream" } else { media_type };
        if !media_type_ok(media_type) {
            return Err(scope("a file's type is a media type"));
        }
        let bytes = bytes::Bytes::from(decode_body(body_b64)?);
        let hash = sha256_hex(&bytes);
        let first = call.service.origin.join("/upload").map_err(|_| scope("upload"))?;
        self.guard(&call.hubs, &first).await?;
        let ev = blossom_event(keys, Blossom::Upload, &hash, &Self::server_tag(&call.service.origin))?;
        self.log(&call, "upload".into(), Some(ev.id.to_hex()), false)?;
        let auth = authorization(&ev);
        let mut res = None;
        for path in ["/upload", "/media/upload"] {
            let url = call.service.origin.join(path).map_err(|_| scope("upload"))?;
            let r = self
                .http
                .put(url)
                .header("authorization", &auth)
                .header("x-sha-256", &hash)
                .header("content-type", media_type)
                .body(bytes.clone())
                .timeout(MEDIA_TIMEOUT)
                .send()
                .await
                .map_err(|_| no("unreachable", "The media server didn't answer."))?;
            let s = r.status().as_u16();
            res = Some(r);
            if !(path == "/upload" && (s == 404 || s == 405)) {
                break;
            }
        }
        let res = res.ok_or_else(|| no("unreachable", "The media server didn't answer."))?;
        let status = res.status().as_u16();
        if !(200..300).contains(&status) {
            return Err(no("failed", format!("The media server refused the file ({status}).")));
        }
        let body = read_capped(res, 1024 * 1024).await?;
        serde_json::from_slice(&body).map_err(|_| no("failed", "The media server's answer wasn't a descriptor."))
    }

    /// A file from the relay's media server by its hash: GET /media/<sha256>.<ext>, signed for that hash only.
    pub async fn media(&self, keys: &Keys, session: &str, service: &str, sha256: &str, ext: &str) -> Result<Media, Refusal> {
        let call = self.call(session, service)?;
        Self::media_server(&call)?;
        if !is_hex64(sha256) || ext.is_empty() || ext.len() > 8 || !ext.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit()) {
            return Err(scope("a file is named by its sha256 and an extension"));
        }
        let url = call.service.origin.join(&format!("/media/{sha256}.{ext}")).map_err(|_| scope("media"))?;
        self.guard(&call.hubs, &url).await?;
        let ev = blossom_event(keys, Blossom::Get, sha256, &Self::server_tag(&call.service.origin))?;
        self.log(&call, "media".into(), Some(ev.id.to_hex()), false)?;
        let res = self.http.get(url).header("authorization", authorization(&ev)).timeout(MEDIA_TIMEOUT).send().await.map_err(|_| no("unreachable", "The media server didn't answer."))?;
        let status = res.status().as_u16();
        if status != 200 {
            return Err(no("failed", format!("The media server didn't give the file ({status}).")));
        }
        let media_type = res.headers().get("content-type").and_then(|v| v.to_str().ok()).filter(|t| media_type_ok(t)).unwrap_or("application/octet-stream").to_string();
        let body = read_capped(res, MAX_BYTES).await?;
        Ok(Media { media_type, body: B64.encode(body) })
    }

    /// Open one of the applet's private notes, read from the relay by the web side: only an event whose id and signature
    /// hold, written by the person, of kind 30078 with a declared entry's `t` and a `d` under that entry's prefix.
    pub fn private_open(&self, keys: &Keys, session: &str, service: &str, event: &Value) -> Result<String, Refusal> {
        let call = self.call(session, service)?;
        let (_, _, private) = Self::relay(&call)?;
        let ev: Event = serde_json::from_value(event.clone()).map_err(|_| no("bad_event", "That isn't an event."))?;
        ev.verify().map_err(|_| no("bad_event", "That event's id or signature doesn't hold."))?;
        if ev.pubkey != keys.public_key() || ev.kind != Kind::from(PRIVATE_KIND) {
            return Err(no("bad_event", "That isn't one of your own private notes."));
        }
        let first = |name: &str| ev.tags.iter().find(|t| t.as_slice().first().map(String::as_str) == Some(name)).and_then(|t| t.as_slice().get(1).cloned());
        let (t, d) = (first("t").unwrap_or_default(), first("d").unwrap_or_default());
        if !private.iter().any(|e| e.t == t && d.starts_with(&e.d)) {
            return Err(no("bad_event", "That note isn't one this applet keeps."));
        }
        open_from_self(keys, &ev.content)
    }

    /// Seal `text` to the person and sign it as one of the applet's private notes, under a declared `d` prefix.
    pub fn private_save(&self, keys: &Keys, session: &str, service: &str, d: &str, text: &str) -> Result<Event, Refusal> {
        let call = self.call(session, service)?;
        let (_, _, private) = Self::relay(&call)?;
        if d.chars().count() > 128 || d.chars().any(hidden) {
            return Err(scope("a note's d is a short line"));
        }
        let entry = private.iter().find(|e| d.starts_with(&e.d)).ok_or_else(|| scope("that d isn't under one of its prefixes"))?;
        if text.len() > MAX_PRIVATE_TEXT {
            return Err(no("too_large", "a private note is at most 32 KiB"));
        }
        let sealed = seal_to_self(keys, text)?;
        let ev = sign(keys, EventBuilder::new(Kind::from(PRIVATE_KIND), sealed).tags([tag(&["d", d])?, tag(&["t", &entry.t])?]))?;
        self.log(&call, format!("kind {PRIVATE_KIND}"), Some(ev.id.to_hex()), false)?;
        Ok(ev)
    }

    fn token_service(subject: &str, service: &Value) -> Result<Service, Refusal> {
        if !name_ok(subject, 512) {
            return Err(bad("a subject that isn't plain"));
        }
        let s = parse_service(service)?;
        match s.kind {
            ServiceKind::Http { auth: Auth::Token, .. } => Ok(s),
            _ => Err(scope(format!("{} doesn't use a token", s.id))),
        }
    }

    /// Keep (or with `None`, forget) the token for an applet's `token` service, sealed. It never comes back out.
    pub fn token_set(&self, keys: &Keys, subject: &str, service: &Value, token: Option<&str>) -> Result<(), Refusal> {
        let s = Self::token_service(subject, service)?;
        let slot = token_slot(subject, &s.id, &s.url);
        let sealed = match token {
            Some(t) => {
                if t.is_empty() || t.len() > MAX_TOKEN || !t.bytes().all(|b| (0x21..=0x7e).contains(&b)) {
                    return Err(scope("a token is one word of plain characters, at most 4096"));
                }
                Some(seal_token(keys, subject, &s.id, &s.url, t)?)
            }
            None => None,
        };
        let _g = self.files.lock().unwrap_or_else(|e| e.into_inner());
        let path = self.dir.join(TOKENS_FILE);
        let mut all: BTreeMap<String, String> = read_json(&path);
        match sealed {
            Some(v) => all.insert(slot, v),
            None => all.remove(&slot),
        };
        write_json(&path, &all).map_err(|_| no("storage", "The token couldn't be kept."))
    }

    /// Is a token kept for this applet's service that opens with this key?
    pub fn token_has(&self, keys: &Keys, subject: &str, service: &Value) -> Result<bool, Refusal> {
        let s = Self::token_service(subject, service)?;
        Ok(self.token_get(keys, subject, &s)?.is_some())
    }

    fn token_get(&self, keys: &Keys, subject: &str, s: &Service) -> Result<Option<Zeroizing<String>>, Refusal> {
        let _g = self.files.lock().unwrap_or_else(|e| e.into_inner());
        let all: BTreeMap<String, String> = read_json(&self.dir.join(TOKENS_FILE));
        Ok(all.get(&token_slot(subject, &s.id, &s.url)).and_then(|sealed| open_token(keys, subject, &s.id, &s.url, sealed)))
    }
}

/// A response body, refused past `cap` bytes whatever its length header says.
async fn read_capped(mut res: reqwest::Response, cap: usize) -> Result<Vec<u8>, Refusal> {
    if res.content_length().is_some_and(|n| n > cap as u64) {
        return Err(no("too_large", "The server's answer is too large."));
    }
    let mut out = Vec::new();
    while let Some(chunk) = res.chunk().await.map_err(|_| no("unreachable", "The server's answer broke off."))? {
        if out.len() + chunk.len() > cap {
            return Err(no("too_large", "The server's answer is too large."));
        }
        out.extend_from_slice(&chunk);
    }
    Ok(out)
}

// ── the commands ──

/// The broker for this app, made on first use in the app's data directory.
#[derive(Default)]
pub struct ServicesState(OnceLock<Broker>);

impl ServicesState {
    pub(crate) fn broker<R: Runtime>(&self, app: &AppHandle<R>) -> Result<&Broker, Refusal> {
        if let Some(b) = self.0.get() {
            return Ok(b);
        }
        let dir = app.path().app_data_dir().map_err(|_| no("storage", "The app's data folder isn't available."))?;
        let _ = self.0.set(Broker::new(dir)?);
        self.0.get().ok_or_else(|| no("storage", "The broker couldn't start."))
    }
}

pub(crate) async fn held<R: Runtime>(app: &AppHandle<R>, keys: &KeyState) -> Result<Keys, Refusal> {
    keys.get(app).await.map_err(|m| no("no_key", m))?.ok_or_else(|| no("no_key", "This device has no key."))
}

fn event_json(ev: &Event) -> Value {
    serde_json::to_value(ev).unwrap_or(Value::Null)
}

#[tauri::command]
pub async fn svc_open<R: Runtime>(app: AppHandle<R>, keys: State<'_, KeyState>, state: State<'_, ServicesState>, session: String, applet: Applet, services: Vec<Value>, hubs: Vec<String>) -> Result<Opened, Refusal> {
    let k = held(&app, &keys).await?;
    state.broker(&app)?.open(&k, &session, &applet, &services, &hubs)
}

#[tauri::command]
pub async fn svc_close<R: Runtime>(app: AppHandle<R>, state: State<'_, ServicesState>, session: String) -> Result<(), Refusal> {
    state.broker(&app)?.close(&session);
    Ok(())
}

#[tauri::command]
pub async fn svc_relay_auth<R: Runtime>(app: AppHandle<R>, keys: State<'_, KeyState>, state: State<'_, ServicesState>, session: String, service: String, challenge: String) -> Result<Value, Refusal> {
    let k = held(&app, &keys).await?;
    state.broker(&app)?.relay_auth(&k, &session, &service, &challenge).map(|e| event_json(&e))
}

#[tauri::command]
pub async fn svc_sign_event<R: Runtime>(app: AppHandle<R>, keys: State<'_, KeyState>, state: State<'_, ServicesState>, session: String, service: String, template: Value) -> Result<Value, Refusal> {
    let k = held(&app, &keys).await?;
    state.broker(&app)?.sign_event(&k, &session, &service, &template).map(|e| event_json(&e))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn svc_http<R: Runtime>(app: AppHandle<R>, keys: State<'_, KeyState>, ring: State<'_, crate::keyring::KeyringState>, levels: State<'_, crate::levels::LevelsState>, state: State<'_, ServicesState>, session: String, service: String, req: HttpReq, passcode: Option<String>) -> Result<HttpRes, Refusal> {
    let passcode = passcode.map(Zeroizing::new);
    let k = held(&app, &keys).await?;
    let broker = state.broker(&app)?;
    let role = broker.http_role(&session, &service, &req)?;
    match role {
        Role::Everyday => broker.http(&k, &role, &session, &service, &req).await,
        // the approval key, behind this device's approvals level (a grace this applet earned may cover the unlock:
        // these are routine)
        Role::Approval(ref op) => {
            let approval = ring.approval(&app, &k).await?;
            let subject = broker.subject_of(&session)?;
            let host = broker.host_of(&session, &service)?;
            let level = crate::levels::approvals_level(&levels.levels(&app).await?, false);
            let (what, reason) = (format!("{service}:{op}"), format!("Send {op} to {host}, signed with your approval key."));
            let graced = levels.gate(&app, level, passcode.as_ref().map(|p| p.as_str()), || ring.confirm(&app, &subject, &what, true, "Approve with your approval key", &reason)).await?;
            let mut res = broker.http(crate::approvals::for_approve_op(&approval), &role, &session, &service, &req).await?;
            if graced {
                broker.log_for(&session, &service, format!("{op}: within an unlock"), None)?;
                res.graced = true;
            }
            Ok(res)
        }
        // asking to join a private network: the person's key, behind this device's join level (the passcode, then the
        // unlock, by default), never a grace
        Role::Join(ref op) => {
            let subject = broker.subject_of(&session)?;
            let host = broker.host_of(&session, &service)?;
            let level = levels.levels(&app).await?.join;
            let (what, reason) = (format!("{service}:{op}"), format!("Ask {host} to let this device join ({op}), signed with your key."));
            levels.gate(&app, level, passcode.as_ref().map(|p| p.as_str()), || ring.confirm(&app, &subject, &what, false, "Join a network", &reason)).await?;
            broker.http(&k, &role, &session, &service, &req).await
        }
    }
}

#[tauri::command]
pub async fn svc_upload<R: Runtime>(app: AppHandle<R>, keys: State<'_, KeyState>, state: State<'_, ServicesState>, session: String, service: String, body: String, r#type: String) -> Result<Value, Refusal> {
    let k = held(&app, &keys).await?;
    state.broker(&app)?.upload(&k, &session, &service, &body, &r#type).await
}

#[tauri::command]
pub async fn svc_media<R: Runtime>(app: AppHandle<R>, keys: State<'_, KeyState>, state: State<'_, ServicesState>, session: String, service: String, sha256: String, ext: String) -> Result<Media, Refusal> {
    let k = held(&app, &keys).await?;
    state.broker(&app)?.media(&k, &session, &service, &sha256, &ext).await
}

#[tauri::command]
pub async fn svc_private_open<R: Runtime>(app: AppHandle<R>, keys: State<'_, KeyState>, state: State<'_, ServicesState>, session: String, service: String, event: Value) -> Result<String, Refusal> {
    let k = held(&app, &keys).await?;
    state.broker(&app)?.private_open(&k, &session, &service, &event)
}

#[tauri::command]
pub async fn svc_private_save<R: Runtime>(app: AppHandle<R>, keys: State<'_, KeyState>, state: State<'_, ServicesState>, session: String, service: String, d: String, text: String) -> Result<Value, Refusal> {
    let k = held(&app, &keys).await?;
    state.broker(&app)?.private_save(&k, &session, &service, &d, &text).map(|e| event_json(&e))
}

#[tauri::command]
pub async fn svc_token_set<R: Runtime>(app: AppHandle<R>, keys: State<'_, KeyState>, state: State<'_, ServicesState>, subject: String, service: Value, token: Option<String>) -> Result<(), Refusal> {
    let k = held(&app, &keys).await?;
    let token = token.map(Zeroizing::new);
    state.broker(&app)?.token_set(&k, &subject, &service, token.as_deref().map(String::as_str))
}

#[tauri::command]
pub async fn svc_token_has<R: Runtime>(app: AppHandle<R>, keys: State<'_, KeyState>, state: State<'_, ServicesState>, subject: String, service: Value) -> Result<bool, Refusal> {
    let k = held(&app, &keys).await?;
    state.broker(&app)?.token_has(&k, &subject, &service)
}

#[tauri::command]
pub async fn svc_log<R: Runtime>(app: AppHandle<R>, state: State<'_, ServicesState>, subject: String) -> Result<Vec<LogLine>, Refusal> {
    Ok(state.broker(&app)?.log_lines(&subject))
}

#[cfg(test)]
mod tests {
    #[test]
    fn no_applet_can_have_an_approval_or_a_key_list_signed() {
        // even a declaration that names them: they are on the shell's deny list
        for kind in [crate::approve::APPROVAL_KIND, crate::approve::KEYS_KIND] {
            let t = serde_json::json!({ "kind": kind, "content": "{}", "tags": [["d", "x"]] });
            assert!(check_template(&[9, 7, kind], &[], true, &t).is_err(), "kind {kind}");
            assert!(denied_kind(kind));
        }
        assert_ne!(PRIVATE_KIND, crate::approve::APPROVAL_KIND);
    }

    #[test]
    fn a_denied_kind_is_refused_even_when_declared() {
        let denied = [
            443, 30443, 1776, 1777, 2022, 34128, 35128,
            0, 3, 8, 13, 62, 1021, 1022, 1059, 4550, 7374, 7375, 7376, 9321, 9734, 9735, 30078, 30350, 30402, 30403, 30479,
            30480, 34550, 37375, 38383, 1630, 1631, 1633, 5000, 5999, 6000, 7000, 30017, 30020, 30617, 30618,
            9000, 9001, 9005, 9008, 9021, 9030, 9035, 9040, 9044, 9099, 10000, 10002, 10019, 10050, 10063, 10100, 13194, 17375, 19999,
            20000, 22242, 23194, 23195, 23196, 24133, 24134, 24242, 24243, 27235, 28934, 29999, 30174, 30177, 30179, 30620, 30622,
            40000, 40004, 41010, 43001, 46011, 46020, 46030, 46031, 46040, 46041, 46042, 48001, 49999,
        ];
        for kind in denied {
            assert!(denied_kind(kind), "kind {kind}");
            let declared = json!({ "id": "x", "kind": "nostr-relay", "url": "wss://relay.example", "publish": [9, kind] });
            assert_eq!(code(parse_service(&declared)), "bad_service", "kind {kind}: the declaration is refused");
            // and if one got past the parse, the template check still refuses it
            assert_eq!(code(check_template(&[9, kind], &[], true, &json!({ "kind": kind, "content": "" }))), "out_of_scope", "kind {kind}");
        }
        // the web side reads the same list (applet/services.ts): one list in Rust and TS
        let web: Value = serde_json::from_str(include_str!("../../src/applet/denied-kinds.json")).unwrap();
        let mut kinds = DENIED_KINDS.to_vec();
        kinds.sort_unstable();
        assert_eq!(web["kinds"], json!(kinds));
        assert_eq!(web["ranges"], json!(DENIED_RANGES.iter().map(|(a, b)| [*a, *b]).collect::<Vec<_>>()));
        assert_eq!(web["except"], json!(RANGE_EXCEPTIONS));
        // the kinds around the ranges, and typing inside one, are an applet's to declare
        for kind in [1, 5, 6, 7, 9, 16, 1111, 1617, 1621, 1629, 1634, 1984, 4999, 7001, 8999, 9100, 20002, 30000, 30016, 30021, 30023, 30173,
            30180, 30300, 30616, 30619, 30623, 39999, 40003, 50000, 65535]
        {
            assert!(!denied_kind(kind), "kind {kind}");
            let declared = json!({ "id": "x", "kind": "nostr-relay", "url": "wss://relay.example", "publish": [kind] });
            assert!(parse_service(&declared).is_ok(), "kind {kind}");
        }
    }

    use super::*;
    use serde_json::json;

    fn dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("parachute-svc-{name}-{}-{}", std::process::id(), random_nonce()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn relay() -> Value {
        json!({ "id": "rooms", "kind": "nostr-relay", "url": "wss://relay.example", "publish": [9, 7, 5, 20002], "media": true,
            "private": [{ "kind": 30078, "d": "read-state:", "t": "read-state" }] })
    }
    fn mail() -> Value {
        json!({ "id": "mail", "kind": "http", "url": "https://mail.example/mail/", "auth": "nip98" })
    }
    fn matrix() -> Value {
        json!({ "id": "matrix", "kind": "http", "url": "https://matrix.example/_matrix/", "auth": "token" })
    }
    fn with(base: Value, k: &str, v: Value) -> Value {
        let mut b = base;
        b[k] = v;
        b
    }
    fn applet() -> Applet {
        Applet { name: "Rooms".into(), subject: "vault:home/rooms@abc".into() }
    }
    fn broker(name: &str, keys: &Keys) -> Broker {
        let b = Broker::new(dir(name)).unwrap();
        b.open(keys, "s1", &applet(), &[relay(), mail(), matrix()], &[]).unwrap();
        b
    }
    fn code<T: std::fmt::Debug>(r: Result<T, Refusal>) -> &'static str {
        r.unwrap_err().code
    }

    #[test]
    fn declarations_are_checked_again() {
        let s = parse_service(&relay()).unwrap();
        assert_eq!(s.url, "wss://relay.example");
        assert_eq!(s.origin.as_str(), "https://relay.example/", "a relay's media server is its https twin");
        assert_eq!(s.kind, ServiceKind::Relay { publish: vec![5, 7, 9, 20002], media: true, private: vec![PrivateEntry { d: "read-state:".into(), t: "read-state".into() }], rooms: vec![], approvals: vec![] });
        let m = parse_service(&mail()).unwrap();
        assert_eq!((m.url.as_str(), m.origin.as_str()), ("https://mail.example/mail/", "https://mail.example/"));
        // normalised: case, trailing dot, default port
        let n = parse_service(&with(mail(), "url", json!("https://Mail.Example.:443/mail/"))).unwrap();
        assert_eq!(n.url, "https://mail.example/mail/");
        assert_eq!(parse_service(&with(relay(), "url", json!("ws://localhost:7777"))).unwrap().origin.as_str(), "http://localhost:7777/");
        assert!(parse_service(&with(mail(), "url", json!("http://[::1]:8080/x/"))).is_ok());

        let refused = [
            with(relay(), "kind", json!("smtp")),
            with(relay(), "url", json!("ws://relay.example")),
            with(relay(), "url", json!("https://relay.example")),
            with(mail(), "url", json!("http://mail.example/mail/")),
            with(mail(), "url", json!("https://mail.example/mail")),
            with(mail(), "url", json!("https://user:pw@mail.example/mail/")),
            with(mail(), "url", json!("https://mail.example/mail/?a=1")),
            with(mail(), "url", json!("https://mail.example/mail/#x")),
            with(mail(), "url", json!("https://mail.example/a/../mail/")),
            with(mail(), "url", json!("https://mail.example/./mail/")),
            with(mail(), "url", json!("https://mail.example/%2e%2e/mail/")),
            with(mail(), "url", json!("https://mail.example/a%2Fb/")),
            with(mail(), "url", json!("https://mail.example/a%5cb/")),
            with(mail(), "url", json!("https://mail.example/a%25b/")),
            with(mail(), "url", json!("https://mail.example/a\\b/")),
            with(mail(), "url", json!("https://mail\u{200b}.example/mail/")),
            with(mail(), "auth", json!("basic")),
            with(mail(), "publish", json!([9])),
            with(relay(), "auth", json!("nip98")),
            with(relay(), "publish", json!([27235])),
            with(relay(), "publish", json!([22242])),
            with(relay(), "publish", json!([65536])),
            with(relay(), "publish", json!([-1])),
            with(relay(), "publish", json!(["9"])),
            with(relay(), "publish", json!((30000..=30016).collect::<Vec<u16>>())),
            with(relay(), "publish", json!([0])),
            with(relay(), "publish", json!([30078])),
            with(relay(), "publish", json!([9, 9])),
            with(relay(), "media", json!("yes")),
            with(relay(), "private", json!([{ "kind": 30077, "d": "x:", "t": "x" }])),
            with(relay(), "private", json!([{ "kind": 30078, "d": "x", "t": "x" }])),
            with(relay(), "private", json!([{ "kind": 30078, "d": "X:", "t": "x" }])),
            with(relay(), "private", json!([{ "kind": 30078, "d": ":", "t": "x" }])),
            with(relay(), "private", json!([{ "kind": 30078, "d": "x:", "t": "has space" }])),
            with(relay(), "private", json!([{ "kind": 30078, "d": "x:", "t": "x", "extra": 1 }])),
            with(relay(), "private", json!([{ "kind": 30078, "d": "a:", "t": "x" }, { "kind": 30078, "d": "a:b:", "t": "y" }])),
            with(relay(), "private", json!([{ "kind": 30078, "d": "a:", "t": "x" }, { "kind": 30078, "d": "b:", "t": "y" }, { "kind": 30078, "d": "c:", "t": "z" }])),
            with(relay(), "id", json!("Rooms")),
            with(relay(), "id", json!("a--b")),
        ];
        for r in refused {
            assert_eq!(code(parse_service(&r)), "bad_service", "{r}");
        }
    }

    #[test]
    fn opening_refuses_the_whole_list_and_hubs() {
        let k = Keys::generate();
        let d = dir("open");
        let b = Broker::new(d.clone()).unwrap();
        assert_eq!(b.open(&k, "s", &applet(), &[relay(), mail()], &[]).unwrap().pubkey, k.public_key().to_hex());
        assert_eq!(code(b.open(&k, "s", &applet(), &[relay(), with(mail(), "auth", json!("basic"))], &[])), "bad_service");
        assert_eq!(code(b.open(&k, "s", &applet(), &[mail(), mail()], &[])), "bad_service", "an id twice");
        assert_eq!(code(b.open(&k, "s", &applet(), &[mail()], &["https://MAIL.example./".into()])), "hub_listed");
        assert_eq!(code(b.open(&k, "s", &applet(), &[relay()], &["https://relay.example".into()])), "hub_listed", "a relay's twin origin");
        assert_eq!(code(b.open(&k, "s", &applet(), &[mail()], &["not a url".into()])), "bad_service");
        crate::door::remember_hub(&d, &Url::parse("https://mail.example/").unwrap()).unwrap();
        assert_eq!(code(b.open(&k, "s", &applet(), &[mail()], &[])), "hub_known");
        assert_eq!(code(b.open(&k, "s\0", &applet(), &[], &[])), "bad_service");
        assert_eq!(code(b.open(&k, "s", &Applet { name: "x".into(), subject: "a\0b".into() }, &[], &[])), "bad_service");
        let seven: Vec<Value> = (0..7).map(|i| with(mail(), "id", json!(format!("m{i}")))).collect();
        assert_eq!(code(b.open(&k, "s", &applet(), &seven, &[])), "bad_service");
    }

    #[test]
    fn only_the_declared_kinds_and_plain_tags_are_signed() {
        let publish = [5u16, 7, 9, 20002];
        let ok = |t: Value| check_template(&publish, &[], false, &t);
        let e = "ab".repeat(32);
        assert!(ok(json!({ "kind": 9, "content": "hi", "tags": [["h", "room"], ["e", e]] })).is_ok());
        assert!(ok(json!({ "kind": 7, "content": "+" })).is_ok());
        for kind in [1, 0, 3, 22242, 27235, 24242, 30078, 40003, 1059, 13, 9000] {
            assert_eq!(code(ok(json!({ "kind": kind, "content": "", "tags": [] }))), "out_of_scope", "kind {kind}");
        }
        assert_eq!(code(check_template(&[9], &[], false, &json!({ "kind": 7 }))), "out_of_scope", "not in this declaration");
        for t in AUTH_TAGS {
            assert_eq!(code(ok(json!({ "kind": 9, "tags": [[t, "x"]] }))), "out_of_scope", "{t}");
        }
        let many: Vec<Value> = (0..101).map(|_| json!(["h", "r"])).collect();
        assert_eq!(code(ok(json!({ "kind": 9, "tags": many }))), "out_of_scope");
        assert_eq!(code(ok(json!({ "kind": 9, "tags": [vec!["h"; 13]] }))), "out_of_scope");
        assert_eq!(code(ok(json!({ "kind": 9, "tags": [[]] }))), "out_of_scope");
        assert_eq!(code(ok(json!({ "kind": 9, "tags": [["h", "x".repeat(1025)]] }))), "out_of_scope");
        assert!(ok(json!({ "kind": 9, "tags": [["h", "x".repeat(1024)]] })).is_ok());
        assert_eq!(code(ok(json!({ "kind": 9, "tags": [["h", 1]] }))), "out_of_scope");
        assert_eq!(code(ok(json!({ "kind": 9, "content": "x".repeat(MAX_CONTENT + 1) }))), "out_of_scope");
        assert_eq!(code(ok(json!({ "kind": 9, "pubkey": "x" }))), "out_of_scope");
        assert_eq!(code(ok(json!({ "kind": 9, "tags": [["e", "AB".repeat(32)]] }))), "out_of_scope", "lower-case hex");
        assert_eq!(code(ok(json!({ "kind": 9, "tags": [["e", "nothex"]] }))), "out_of_scope");
        // deletions: e (and h) tags only, at least one e
        assert!(ok(json!({ "kind": 5, "tags": [["e", e], ["h", "room"]] })).is_ok());
        assert_eq!(code(ok(json!({ "kind": 5, "tags": [["h", "room"]] }))), "out_of_scope");
        assert_eq!(code(ok(json!({ "kind": 5, "tags": [["e", e], ["p", e]] }))), "out_of_scope");
        assert_eq!(code(ok(json!({ "kind": 5, "tags": [["e", e], ["a", "30078:x:y"]] }))), "out_of_scope");
    }

    #[test]
    fn events_are_signed_as_checked() {
        let k = Keys::generate();
        let b = broker("sign", &k);
        let me = k.public_key().to_hex();
        let ev = b.sign_event(&k, "s1", "rooms", &json!({ "kind": 7, "content": "+", "tags": [["e", "ab".repeat(32)], ["p", me]] })).unwrap();
        assert!(ev.verify().is_ok());
        assert_eq!(ev.pubkey, k.public_key());
        assert!((nostr::Timestamp::now().as_secs() as i64 - ev.created_at.as_secs() as i64).abs() < 5);
        assert_eq!(ev.tags.len(), 2, "a reaction to one's own post keeps its p tag");
        assert_eq!(code(b.sign_event(&k, "s1", "mail", &json!({ "kind": 9 }))), "out_of_scope", "not a relay");
        assert_eq!(code(b.sign_event(&k, "s1", "nope", &json!({ "kind": 9 }))), "not_granted");
        assert_eq!(code(b.sign_event(&k, "s2", "rooms", &json!({ "kind": 9 }))), "no_session");
        b.close("s1");
        assert_eq!(code(b.sign_event(&k, "s1", "rooms", &json!({ "kind": 9 }))), "no_session");
    }

    #[test]
    fn a_declared_ordinary_kind_is_signed_and_an_undeclared_one_is_not() {
        // the manifest is the declaration: a note (1) and an article (30023) are signed when its service names them
        let k = Keys::generate();
        let b = Broker::new(dir("declared")).unwrap();
        let blog = json!({ "id": "blog", "kind": "nostr-relay", "url": "wss://relay.example", "publish": [1, 30023] });
        b.open(&k, "s1", &applet(), &[blog], &[]).unwrap();
        let note = b.sign_event(&k, "s1", "blog", &json!({ "kind": 1, "content": "hello", "tags": [["t", "garden"]] })).unwrap();
        assert!(note.verify().is_ok());
        assert_eq!((note.kind, note.pubkey), (Kind::from(1), k.public_key()));
        let article = b.sign_event(&k, "s1", "blog", &json!({ "kind": 30023, "content": "# Beds", "tags": [["d", "beds"], ["title", "Beds"]] })).unwrap();
        assert_eq!(article.kind, Kind::from(30023));
        // what it didn't declare is refused, even an ordinary kind the shell would sign for another applet
        for kind in [9, 7, 6, 30024] {
            assert_eq!(code(b.sign_event(&k, "s1", "blog", &json!({ "kind": kind, "content": "x" }))), "out_of_scope", "kind {kind}");
        }
    }

    #[test]
    fn relay_sign_in_is_bound_to_the_declared_relay() {
        let k = Keys::generate();
        let b = broker("auth", &k);
        let ev = b.relay_auth(&k, "s1", "rooms", "chal-123").unwrap();
        assert_eq!(ev.kind, Kind::from(22242));
        let tags: Vec<Vec<String>> = ev.tags.iter().map(|t| t.as_slice().to_vec()).collect();
        assert_eq!(tags, vec![vec!["relay".to_string(), "wss://relay.example".into()], vec!["challenge".into(), "chal-123".into()]]);
        assert!(ev.verify().is_ok());
        for c in ["", "a\nb", &"x".repeat(257), "é"] {
            assert_eq!(code(b.relay_auth(&k, "s1", "rooms", c)), "out_of_scope", "{c:?}");
        }
        assert!(b.relay_auth(&k, "s1", "rooms", &"x".repeat(256)).is_ok());
        assert_eq!(code(b.relay_auth(&k, "s1", "mail", "c")), "out_of_scope");
    }

    #[test]
    fn paths_stay_under_the_prefix() {
        let base = "https://mail.example/mail/";
        assert_eq!(request_url(base, "inbox").unwrap().as_str(), "https://mail.example/mail/inbox");
        assert_eq!(request_url(base, "/inbox?x=1&y=%2e").unwrap().as_str(), "https://mail.example/mail/inbox?x=1&y=%2e", "query is free");
        // joined as text: //evil.example stays a path on this origin
        let u = request_url(base, "//evil.example/x").unwrap();
        assert_eq!((u.host_str(), u.path()), (Some("mail.example"), "/mail//evil.example/x"));
        let u = request_url("https://mail.example/", "//evil.example/x").unwrap();
        assert_eq!((u.host_str(), u.path()), (Some("mail.example"), "//evil.example/x"));
        for p in ["../x", "a/../../x", "./x", "a/.", "..", "%2e%2e/x", "%2E%2E/x", "a%2fb", "a%2Fb", "a%5cb", "a%25b", "a\\b", "a b", "a#b", "a\tb", "a\nb", "a\u{7f}", "..?x=1", "a/..?x"] {
            assert_eq!(code(request_url(base, p)), "out_of_scope", "{p:?}");
        }
        assert!(request_url(base, &"a".repeat(2001)).is_err());
        assert!(hub_path("/account/mcp") && hub_path("/api/auth/nostr/verify") && hub_path("/vault/x/api") && hub_path("/Account/x") && hub_path("/vault"));
        assert!(!hub_path("/mail/account/x") && !hub_path("/accounts") && !hub_path("/vaults/x"));
        // as a server that decodes and folds slashes would route it
        assert!(hub_path("//account/mcp") && hub_path("/%61ccount/mcp") && hub_path("/%41CCOUNT/mcp") && hub_path("/vault;v=1/x") && hub_path("///api//auth/x"));
    }

    #[tokio::test]
    async fn methods_and_bodies_are_checked_before_anything_goes() {
        let k = Keys::generate();
        let b = broker("http", &k);
        let req = |m: &str, p: &str| HttpReq { method: m.into(), path: p.into(), ..Default::default() };
        for m in ["TRACE", "CONNECT", "OPTIONS", "get x"] {
            assert_eq!(code(b.http(&k, &Role::Everyday, "s1", "mail", &req(m, "x")).await), "out_of_scope", "{m}");
        }
        assert_eq!(code(b.http(&k, &Role::Everyday, "s1", "mail", &req("GET", "../x")).await), "out_of_scope");
        assert_eq!(code(b.http(&k, &Role::Everyday, "s1", "rooms", &req("GET", "x")).await), "out_of_scope");
        let mut bad_header = req("GET", "x");
        bad_header.headers.insert("accept".into(), "a\r\nx-evil: 1".into());
        assert_eq!(code(b.http(&k, &Role::Everyday, "s1", "mail", &bad_header).await), "out_of_scope");
        let mut twice = req("GET", "x");
        twice.headers.insert("Accept".into(), "a/b".into());
        twice.headers.insert("accept".into(), "c/d".into());
        assert_eq!(code(b.http(&k, &Role::Everyday, "s1", "mail", &twice).await), "out_of_scope", "a header named twice");
        let mut big = req("POST", "x");
        big.body = Some("A".repeat(MAX_BYTES / 3 * 4 + 100));
        assert_eq!(code(b.http(&k, &Role::Everyday, "s1", "mail", &big).await), "too_large");
        // a token service with no token sends nothing
        assert_eq!(code(b.http(&k, &Role::Everyday, "s1", "matrix", &req("GET", "x")).await), "no_token");
        assert_eq!(code(b.media(&k, "s1", "rooms", "AB", "png").await), "out_of_scope");
        assert_eq!(code(b.media(&k, "s1", "rooms", &"ab".repeat(32), "p/ng").await), "out_of_scope");
        assert_eq!(code(b.upload(&k, "s1", "rooms", "", "text/plain\r\nx: y").await), "out_of_scope");
        assert_eq!(code(b.upload(&k, "s1", "mail", "", "text/plain").await), "out_of_scope");
        assert!(b.log_lines("vault:home/rooms@abc").is_empty(), "nothing was signed");
    }

    #[test]
    fn nip98_names_the_request() {
        let k = Keys::generate();
        let u = Url::parse("https://mail.example/mail/send?x=1").unwrap();
        let ev = nip98_event(&k, &u, "POST", Some(b"hello")).unwrap();
        let tags: Vec<Vec<String>> = ev.tags.iter().map(|t| t.as_slice().to_vec()).collect();
        assert_eq!(tags[0], vec!["u", "https://mail.example/mail/send?x=1"]);
        assert_eq!(tags[1], vec!["method", "POST"]);
        assert_eq!(tags[2][0], "nonce");
        assert_eq!(tags[3], vec!["payload".to_string(), sha256_hex(b"hello")]);
        assert_eq!(ev.kind, Kind::from(27235));
        let again = nip98_event(&k, &u, "POST", Some(b"hello")).unwrap();
        assert_ne!(again.tags.iter().nth(2), ev.tags.iter().nth(2), "a fresh nonce each time");
        assert_eq!(nip98_event(&k, &u, "GET", None).unwrap().tags.len(), 3, "no payload without a body");
    }

    #[test]
    fn blossom_signs_upload_and_get_only() {
        let k = Keys::generate();
        let h = "ab".repeat(32);
        let ev = blossom_event(&k, Blossom::Get, &h, "relay.example").unwrap();
        let tags: Vec<Vec<String>> = ev.tags.iter().map(|t| t.as_slice().to_vec()).collect();
        assert_eq!(&tags[..3], &[vec!["t".to_string(), "get".into()], vec!["x".into(), h.clone()], vec!["server".into(), "relay.example".into()]]);
        let exp: u64 = tags[3][1].parse().unwrap();
        assert!(exp > nostr::Timestamp::now().as_secs() + 290 && exp <= nostr::Timestamp::now().as_secs() + 300);
        assert_eq!(blossom_event(&k, Blossom::Upload, &h, "relay.example").unwrap().tags.iter().next().unwrap().as_slice()[1], "upload");
    }

    #[test]
    fn private_notes_round_trip_and_only_the_persons_own_open() {
        let k = Keys::generate();
        let b = broker("private", &k);
        let ev = b.private_save(&k, "s1", "rooms", "read-state:room-1", "last read 42").unwrap();
        assert!(ev.verify().is_ok());
        assert_eq!(ev.kind, Kind::from(30078));
        assert_ne!(ev.content, "last read 42");
        let tags: Vec<Vec<String>> = ev.tags.iter().map(|t| t.as_slice().to_vec()).collect();
        assert_eq!(tags, vec![vec!["d".to_string(), "read-state:room-1".into()], vec!["t".into(), "read-state".into()]]);
        let as_json = serde_json::to_value(&ev).unwrap();
        assert_eq!(b.private_open(&k, "s1", "rooms", &as_json).unwrap(), "last read 42");

        // tampered content, stale id
        let mut t = as_json.clone();
        t["content"] = json!(seal_to_self(&k, "forged").unwrap());
        assert_eq!(code(b.private_open(&k, "s1", "rooms", &t)), "bad_event");
        // correctly shaped, id recomputed for the new content, but a signature that isn't over it
        let unsigned = EventBuilder::new(Kind::from(30078), seal_to_self(&k, "forged").unwrap()).tags([tag(&["d", "read-state:x"]).unwrap(), tag(&["t", "read-state"]).unwrap()]).build(k.public_key());
        let mut forged = serde_json::to_value(&ev).unwrap();
        let id = unsigned.id.unwrap_or_else(|| nostr::EventId::new(&unsigned.pubkey, &unsigned.created_at, &unsigned.kind, &unsigned.tags, &unsigned.content));
        forged["id"] = json!(id.to_hex());
        forged["content"] = json!(unsigned.content);
        forged["created_at"] = json!(unsigned.created_at.as_secs());
        forged["tags"] = json!([["d", "read-state:x"], ["t", "read-state"]]);
        let parsed: Event = serde_json::from_value(forged.clone()).unwrap();
        assert!(parsed.verify_id() && !parsed.verify_signature(), "the id holds; only the signature is wrong");
        assert_eq!(code(b.private_open(&k, "s1", "rooms", &forged)), "bad_event", "a signature over another event");
        // someone else's valid event wrapping a note sealed to them
        let other = Keys::generate();
        let theirs = EventBuilder::new(Kind::from(30078), seal_to_self(&other, "x").unwrap()).tags([tag(&["d", "read-state:x"]).unwrap(), tag(&["t", "read-state"]).unwrap()]).sign_with_keys(&other).unwrap();
        assert_eq!(code(b.private_open(&k, "s1", "rooms", &serde_json::to_value(&theirs).unwrap())), "bad_event");
        // the person's own, but not this applet's entry
        let mine = |kind: u16, d: &str, t: &str| serde_json::to_value(EventBuilder::new(Kind::from(kind), seal_to_self(&k, "x").unwrap()).tags([tag(&["d", d]).unwrap(), tag(&["t", t]).unwrap()]).sign_with_keys(&k).unwrap()).unwrap();
        assert!(b.private_open(&k, "s1", "rooms", &mine(30078, "read-state:y", "read-state")).is_ok());
        assert_eq!(code(b.private_open(&k, "s1", "rooms", &mine(30078, "wallet:y", "read-state"))), "bad_event");
        assert_eq!(code(b.private_open(&k, "s1", "rooms", &mine(30078, "read-state:y", "wallet"))), "bad_event");
        assert_eq!(code(b.private_open(&k, "s1", "rooms", &mine(30079, "read-state:y", "read-state"))), "bad_event");
        assert_eq!(code(b.private_open(&k, "s1", "rooms", &json!({ "kind": 30078 }))), "bad_event");

        assert_eq!(code(b.private_save(&k, "s1", "rooms", "wallet:x", "x")), "out_of_scope");
        assert_eq!(code(b.private_save(&k, "s1", "rooms", &format!("read-state:{}", "x".repeat(120)), "x")), "out_of_scope");
        assert_eq!(code(b.private_save(&k, "s1", "rooms", "read-state:x", &"x".repeat(MAX_PRIVATE_TEXT + 1))), "too_large");
    }

    #[test]
    fn nip44_to_self_round_trips() {
        let k = Keys::generate();
        let sealed = seal_to_self(&k, "héllo").unwrap();
        assert_eq!(open_from_self(&k, &sealed).unwrap(), "héllo");
        assert!(open_from_self(&Keys::generate(), &sealed).is_err());
    }

    #[test]
    fn tokens_are_sealed_per_applet_and_service() {
        let k = Keys::generate();
        let sealed = seal_token(&k, "applet-a", "matrix", "https://m.example/", "syt_secret").unwrap();
        assert_eq!(open_token(&k, "applet-a", "matrix", "https://m.example/", &sealed).unwrap().as_str(), "syt_secret");
        assert!(open_token(&k, "applet-b", "matrix", "https://m.example/", &sealed).is_none(), "another applet's key");
        assert!(open_token(&k, "applet-a", "other", "https://m.example/", &sealed).is_none());
        assert!(open_token(&k, "applet-a", "matrix", "https://n.example/", &sealed).is_none());
        assert!(open_token(&Keys::generate(), "applet-a", "matrix", "https://m.example/", &sealed).is_none());
        assert_ne!(token_key(&k, "applet-a", "matrix", "u").as_bytes(), token_key(&k, "applet-b", "matrix", "u").as_bytes());
        // not the NIP-44 key to self: what a relay holds can't open it
        assert_ne!(token_key(&k, "a", "b", "c").as_bytes(), ConversationKey::derive(k.secret_key(), &k.public_key()).unwrap().as_bytes());
        assert!(nip44::decrypt(k.secret_key(), &k.public_key(), &sealed).is_err());

        let d = dir("tokens");
        let b = Broker::new(d.clone()).unwrap();
        assert!(!b.token_has(&k, "applet-a", &matrix()).unwrap());
        b.token_set(&k, "applet-a", &matrix(), Some("syt_secret")).unwrap();
        assert!(b.token_has(&k, "applet-a", &matrix()).unwrap());
        assert!(!b.token_has(&k, "applet-b", &matrix()).unwrap(), "a second applet asks for its own");
        let file = std::fs::read_to_string(d.join(TOKENS_FILE)).unwrap();
        assert!(!file.contains("syt_secret") && !file.contains("applet-a"));
        b.token_set(&k, "applet-a", &matrix(), None).unwrap();
        assert!(!b.token_has(&k, "applet-a", &matrix()).unwrap());
        assert_eq!(code(b.token_set(&k, "applet-a", &mail(), Some("x"))), "out_of_scope", "a nip98 service takes no token");
        assert_eq!(code(b.token_set(&k, "applet-a", &matrix(), Some("has space"))), "out_of_scope");
        assert_eq!(code(b.token_set(&k, "applet-a", &matrix(), Some(&"x".repeat(MAX_TOKEN + 1)))), "out_of_scope");
        assert_eq!(code(b.token_set(&k, "a\0b", &matrix(), Some("x"))), "bad_service");
    }

    #[test]
    fn the_log_folds_typing_only() {
        let k = Keys::generate();
        let b = broker("log", &k);
        for _ in 0..3 {
            b.sign_event(&k, "s1", "rooms", &json!({ "kind": 20002, "tags": [["h", "r"]] })).unwrap();
        }
        for _ in 0..2 {
            b.sign_event(&k, "s1", "rooms", &json!({ "kind": 9, "content": "hi" })).unwrap();
        }
        b.relay_auth(&k, "s1", "rooms", "c").unwrap();
        let lines = b.log_lines("vault:home/rooms@abc");
        let shown: Vec<(&str, Option<u32>)> = lines.iter().map(|l| (l.what.as_str(), l.count)).collect();
        assert_eq!(shown, vec![("kind 20002", Some(3)), ("kind 9", None), ("kind 9", None), ("sign-in", None)]);
        assert!(lines.iter().all(|l| l.applet == "Rooms" && l.service == "rooms" && l.id.as_ref().is_some_and(|i| is_hex64(i))));
        assert!(b.log_lines("another").is_empty());
        for _ in 0..LOG_LINES {
            b.sign_event(&k, "s1", "rooms", &json!({ "kind": 7, "content": "+" })).unwrap();
        }
        let lines = b.log_lines("vault:home/rooms@abc");
        assert_eq!(lines.len(), LOG_LINES);
        assert!(lines.iter().all(|l| l.what == "kind 7"), "the newest 500 kept");
    }

    // ── the keyring's additions (docs/design/KEYRING.md) ──

    #[test]
    fn reads_rooms_approvals_notify_and_approve_and_refuses_them_malformed() {
        let uni = "b".repeat(64);
        let r = parse_service(&json!({ "id": "rooms", "kind": "nostr-relay", "url": "wss://relay.example", "publish": [9],
            "rooms": [{ "id": "garden-1", "name": "Garden" }], "approvals": { "from": [uni] }, "notify": { "mentions": true } })).unwrap();
        assert_eq!(r.kind, ServiceKind::Relay { publish: vec![9], media: false, private: vec![], rooms: vec!["garden-1".into()], approvals: vec![uni.clone()] });
        assert!(parse_service(&json!({ "id": "rooms", "kind": "nostr-relay", "url": "wss://relay.example", "notify": { "mentions": true, "gateway": "https://push.example/" } })).is_ok());
        assert!(parse_service(&json!({ "id": "rooms", "kind": "nostr-relay", "url": "wss://relay.example", "notify": { "mentions": true, "gateway": "http://localhost:8790/" } })).is_ok());
        let h = parse_service(&json!({ "id": "mail", "kind": "http", "url": "https://mail.example/mail/", "auth": "nip98", "approve": { "field": "op", "ops": ["send.approve"] } })).unwrap();
        assert_eq!(h.kind, ServiceKind::Http { auth: Auth::Nip98, approve: Some(Approve { field: "op".into(), ops: vec!["send.approve".into()] }), join: None });
        for bad in [
            json!({ "rooms": [] }), json!({ "rooms": [{ "id": "a b", "name": "x" }] }), json!({ "rooms": [{ "id": "a", "name": "x" }, { "id": "a", "name": "y" }] }),
            json!({ "approvals": { "from": [] } }), json!({ "approvals": { "from": ["npub1x"] } }), json!({ "approvals": { "from": [uni, uni] } }),
            json!({ "notify": {} }), json!({ "notify": { "mentions": 1 } }),
            json!({ "notify": { "mentions": true, "gateway": "http://push.example/" } }), json!({ "notify": { "mentions": true, "gateway": "https://push.example/push" } }),
            json!({ "notify": { "mentions": true, "gateway": 5 } }), json!({ "notify": { "mentions": true, "gateway": "https://push.example/?x" } }),
        ] {
            let mut x = json!({ "id": "rooms", "kind": "nostr-relay", "url": "wss://relay.example" });
            for (k, v) in bad.as_object().unwrap() { x[k] = v.clone(); }
            assert!(parse_service(&x).is_err(), "{x}");
        }
        for approve in [json!({ "path": "op", "ops": ["x"] }), json!({ "field": "op", "ops": [] }), json!({ "field": "Op", "ops": ["x"] })] {
            assert!(parse_service(&json!({ "id": "mail", "kind": "http", "url": "https://mail.example/mail/", "auth": "nip98", "approve": approve })).is_err());
        }
        assert!(parse_service(&json!({ "id": "mail", "kind": "http", "url": "https://mail.example/mail/", "auth": "none", "approve": { "field": "op", "ops": ["x"] } })).is_err(), "approve needs nip98");
    }

    #[test]
    fn a_scoped_applet_posts_only_in_its_rooms_and_only_the_approvals_grant_answers_a_bot() {
        let rooms = vec!["garden".to_string()];
        let ev = |content: &str, tags: Value| json!({ "kind": 9, "content": content, "tags": tags });
        assert!(check_template(&[9], &rooms, false, &ev("hi", json!([["h", "garden"]]))).is_ok());
        for tags in [json!([]), json!([["h", "finance"]]), json!([["h", "garden"], ["h", "finance"]])] {
            assert_eq!(code(check_template(&[9], &rooms, false, &ev("hi", tags.clone()))), "out_of_scope", "{tags}");
        }
        // the same vectors as applet/services.test.ts: one rule in Rust and TS
        let vectors: Value = serde_json::from_str(include_str!("../../src/applet/command-approval.json")).unwrap();
        for text in vectors["approves"].as_array().unwrap().iter().map(|v| v.as_str().unwrap()) {
            assert!(is_command_approval(text), "{text:?}");
            assert_eq!(code(check_template(&[9], &[], false, &ev(text, json!([["h", "x"]])))), "not_granted", "{text:?}");
            assert!(check_template(&[9], &[], true, &ev(text, json!([["h", "x"]]))).is_ok(), "{text:?}");
        }
        for fine in vectors["fine"].as_array().unwrap().iter().map(|v| v.as_str().unwrap()) {
            assert!(!is_command_approval(fine), "{fine:?}");
        }
        // and a few thousand mixed strings, with TS's answers (applet/services.test.ts checks its own against them too)
        let fuzz: Vec<(String, bool)> = serde_json::from_str(include_str!("../../src/applet/command-approval-fuzz.json")).unwrap();
        for (text, want) in &fuzz {
            assert_eq!(is_command_approval(text), *want, "{text:?}");
        }
        assert!(check_template(&[9], &[], false, &ev("I approve of this", json!([["h", "x"]]))).is_ok());
        // any kind it declared, not only messages: a bot may read an edit or a note as well
        for kind in [40003, 1, 1111] {
            let t = json!({ "kind": kind, "content": "/approve", "tags": [["h", "x"]] });
            assert_eq!(code(check_template(&[9, kind], &[], false, &t)), "not_granted", "kind {kind}");
            assert!(check_template(&[9, kind], &[], true, &t).is_ok(), "kind {kind}");
        }
        // the approval key's enrollment with Uni is the shell's own, whatever the kind
        for kind in [9, 1] {
            let t = json!({ "kind": kind, "content": "{}", "tags": [["h", "x"], ["t", crate::approvals::ENROLL_TAG]] });
            assert_eq!(code(check_template(&[9, 1], &[], true, &t)), "out_of_scope", "kind {kind}");
        }
    }

    #[test]
    fn only_a_join_ops_nip98_carries_the_join_mark() {
        let k = Keys::generate();
        let url = Url::parse("https://enroll.mesh.example/join").unwrap();
        let marked = |ev: &Event| ev.tags.iter().any(|t| t.as_slice().len() >= 2 && t.as_slice()[0] == JOIN_MARK[0] && t.as_slice()[1] == JOIN_MARK[1]);
        // everyday: whatever the body says, no mark (an applet without the join line sending {"op":"mesh.join"})
        let body = br#"{"op":"mesh.join","wg":"x"}"#;
        assert!(!marked(&nip98_event(&k, &url, "POST", Some(body)).unwrap()));
        let j = nip98_join_event(&k, &url, "POST", Some(body), "mesh.join").unwrap();
        assert!(marked(&j));
        assert!(j.tags.iter().any(|t| t.as_slice() == ["parachute", "join", "mesh.join"]));
        assert!(j.verify().is_ok());
    }

    #[test]
    fn a_join_op_is_its_own_role_and_never_an_approval_or_everyday() {
        let svc = |extra: Value| {
            let mut o = json!({ "id": "mesh", "kind": "http", "url": "https://mesh.example/", "auth": "nip98" });
            for (k, v) in extra.as_object().unwrap() {
                o[k] = v.clone();
            }
            parse_service(&o)
        };
        let s = svc(json!({ "join": { "field": "op", "ops": ["mesh.join"] } })).unwrap();
        let ServiceKind::Http { join, approve, .. } = &s.kind else { panic!() };
        assert_eq!(join.as_ref().unwrap().ops, vec!["mesh.join".to_string()]);
        assert!(approve.is_none());
        assert_eq!(roles(approve.as_ref(), join.as_ref(), Some(br#"{"op":"mesh.join","wg":"x"}"#)).unwrap(), Role::Join("mesh.join".into()));
        assert_eq!(roles(approve.as_ref(), join.as_ref(), Some(br#"{"op":"mesh.status"}"#)).unwrap(), Role::Everyday);
        // read two ways: refused, as an approve op is
        assert!(roles(approve.as_ref(), join.as_ref(), Some(br#"{"op":"mesh.status","op":"mesh.join"}"#)).is_err());
        // one op can't be both, and both name their op in one field; join needs nip98
        assert!(svc(json!({ "join": { "field": "op", "ops": ["x.go"] }, "approve": { "field": "op", "ops": ["x.go"] } })).is_err());
        assert!(svc(json!({ "join": { "field": "op", "ops": ["x.go"] }, "approve": { "field": "kind", "ops": ["y.go"] } })).is_err());
        assert!(parse_service(&json!({ "id": "mesh", "kind": "http", "url": "https://mesh.example/", "auth": "none", "join": { "field": "op", "ops": ["mesh.join"] } })).is_err());
        let both = svc(json!({ "join": { "field": "op", "ops": ["mesh.join"] }, "approve": { "field": "op", "ops": ["send.approve"] } })).unwrap();
        let ServiceKind::Http { join, approve, .. } = &both.kind else { panic!() };
        assert_eq!(roles(approve.as_ref(), join.as_ref(), Some(br#"{"op":"send.approve"}"#)).unwrap(), Role::Approval("send.approve".into()));
        assert_eq!(roles(approve.as_ref(), join.as_ref(), Some(br#"{"op":"mesh.join"}"#)).unwrap(), Role::Join("mesh.join".into()));
    }

    #[test]
    fn the_approve_split_fails_closed() {
        let a = Approve { field: "op".into(), ops: vec!["send.approve".into()] };
        let role = |b: Option<&str>| http_role(Some(&a), b.map(str::as_bytes));
        assert_eq!(role(Some(r#"{"op":"send.approve","opId":"x"}"#)).unwrap(), Role::Approval("send.approve".into()));
        assert_eq!(role(Some(r#" {"opId":"x", "op": "send.approve"}"#)).unwrap(), Role::Approval("send.approve".into()));
        assert_eq!(role(Some(r#"{"op":"draft.save"}"#)).unwrap(), Role::Everyday);
        // the gateway's other calls: no op, no body, or JSON of another shape
        assert_eq!(role(Some(r#"{"calls":[["Mailbox/get",{},"b"]]}"#)).unwrap(), Role::Everyday);
        assert_eq!(role(None).unwrap(), Role::Everyday);
        assert_eq!(role(Some("")).unwrap(), Role::Everyday);
        assert_eq!(role(Some(r#"["send.approve"]"#)).unwrap(), Role::Everyday);
        // refused: what another parser could read as an approval
        for b in [
            r#"{"op":"draft.save","op":"send.approve"}"#, r#"{"op":["send.approve"]}"#, r#"{"op":null}"#,
            "\u{feff}{\"op\":\"send.approve\"}", r#"{"op":"send.approve","x":NaN}"#, "op=send.approve", r#"{"op":"send.approve""#,
        ] {
            assert!(role(Some(b)).is_err(), "{b:?}");
        }
        assert_eq!(http_role(None, Some(b"op=send.approve")).unwrap(), Role::Everyday, "no approve: as before");
    }

}
