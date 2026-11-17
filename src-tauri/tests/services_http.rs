//! The broker's requests against a small recording server on loopback: what goes out (NIP-98 over the exact request,
//! a fresh nonce, only plain headers, a kept token) and what comes back (no redirect followed, no cookie, only plain
//! headers), and the hub guard (a server that answers as a hub, one whose probe fails, hub paths, a hub signed in to
//! after the applet opened).
#[path = "support/http_server.rs"]
mod http_server;

use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Arc;

use http_server::{reply, serve, Seen};
use nostr::base64::engine::general_purpose::STANDARD as B64;
use nostr::base64::Engine;
use nostr::{Event, Keys};
use parachute_lib::services::{sha256_hex, Applet, Broker, HttpReq};
use serde_json::{json, Value};

fn dir(name: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("parachute-svc-it-{name}-{}-{}", std::process::id(), sha256_hex(format!("{:?}", std::time::Instant::now()).as_bytes())));
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn applet() -> Applet {
    Applet { name: "Mail".into(), subject: "vault:home/mail@1".into() }
}

fn start() {
    let _ = rustls::crypto::ring::default_provider().install_default();
}

/// A broker with one session `s` holding `services`.
fn broker(name: &str, keys: &Keys, services: &[Value]) -> Broker {
    let b = Broker::new(dir(name)).unwrap();
    b.open(keys, "s", &applet(), services, &[]).unwrap();
    b
}

/// The NIP-98 event a request carried.
fn nostr_auth(seen: &Seen) -> Event {
    let h = seen.header("authorization").expect("an Authorization header");
    let b64 = h.strip_prefix("Nostr ").expect("Nostr auth");
    let ev: Event = serde_json::from_slice(&B64.decode(b64).unwrap()).unwrap();
    ev.verify().expect("a signature that verifies");
    ev
}

fn tag(ev: &Event, name: &str) -> Option<String> {
    ev.tags.iter().find(|t| t.as_slice()[0] == name).map(|t| t.as_slice()[1].clone())
}

fn not_probe(s: &&Seen) -> bool {
    !s.path.starts_with("/.well-known/")
}

fn req(method: &str, path: &str) -> HttpReq {
    HttpReq { method: method.into(), path: path.into(), ..Default::default() }
}

/// Answers the hub probe "not a hub", and everything else as `f` says.
fn plain_server(f: impl Fn(&Seen) -> http_server::Reply + Send + Sync + 'static) -> impl Fn(&Seen) -> http_server::Reply + Send + Sync + 'static {
    move |s: &Seen| if s.path.starts_with("/.well-known/") { reply(404, &[], b"not found") } else { f(s) }
}

#[tokio::test(flavor = "multi_thread")]
async fn nip98_signs_the_exact_request_with_a_fresh_nonce() {
    start();
    let (origin, seen) = serve(plain_server(|_| {
        reply(200, &[("content-type", "text/plain"), ("etag", "\"v1\""), ("set-cookie", "session=stolen; Path=/"), ("x-secret", "no"), ("last-modified", "Tue, 17 Nov 2026 00:00:00 GMT")], b"ok")
    }))
    .await;
    let k = Keys::generate();
    let b = broker("nip98", &k, &[json!({ "id": "mail", "kind": "http", "url": format!("{origin}/api/"), "auth": "nip98" })]);
    let mut r = req("POST", "/send?x=1");
    for (h, v) in [("Content-Type", "application/json"), ("accept", "text/plain"), ("authorization", "Bearer applet-made"), ("cookie", "a=b"), ("x-forwarded-for", "1.2.3.4"), ("host", "evil.example"), ("if-match", "\"v0\"")] {
        r.headers.insert(h.into(), v.into());
    }
    r.body = Some(B64.encode(b"{\"to\":\"x\"}"));
    let res = b.http(&k, "s", "mail", &r).await.unwrap();
    assert_eq!(res.status, 200);
    assert_eq!(B64.decode(&res.body).unwrap(), b"ok");
    let names: Vec<&str> = res.headers.keys().map(String::as_str).collect();
    assert_eq!(names, vec!["content-length", "content-type", "etag", "last-modified"], "only plain headers come back: no cookie");

    let again = b.http(&k, "s", "mail", &r).await.unwrap();
    assert_eq!(again.status, 200);

    let seen = seen.lock().unwrap().clone();
    let probes: Vec<&Seen> = seen.iter().filter(|s| !not_probe(s)).collect();
    assert_eq!(probes.len(), 2, "both well-knowns asked once, then remembered");
    assert!(probes.iter().all(|p| p.header("authorization").is_none() && p.method == "GET"));
    let sent: Vec<&Seen> = seen.iter().filter(not_probe).collect();
    assert_eq!(sent.len(), 2);
    let ev = nostr_auth(sent[0]);
    assert_eq!(ev.kind, nostr::Kind::from(27235));
    assert_eq!(ev.pubkey, k.public_key());
    assert_eq!(tag(&ev, "u").unwrap(), format!("{origin}/api/send?x=1"), "the exact URL sent");
    assert_eq!(sent[0].path, "/api/send?x=1");
    assert_eq!(tag(&ev, "method").unwrap(), "POST");
    assert_eq!(tag(&ev, "payload").unwrap(), sha256_hex(b"{\"to\":\"x\"}"));
    assert_eq!(sent[0].body, b"{\"to\":\"x\"}");
    let n1 = tag(&ev, "nonce").unwrap();
    let n2 = tag(&nostr_auth(sent[1]), "nonce").unwrap();
    assert!(!n1.is_empty() && n1 != n2, "two identical requests, two nonces");
    // only plain request headers went; the applet's own Authorization did not
    assert_eq!(sent[0].header("content-type"), Some("application/json"));
    assert_eq!(sent[0].header("accept"), Some("text/plain"));
    assert_eq!(sent[0].header("if-match"), Some("\"v0\""));
    for h in ["cookie", "x-forwarded-for"] {
        assert!(sent[0].header(h).is_none(), "{h} not forwarded");
    }
    assert!(sent[0].header("host").unwrap().starts_with("127.0.0.1:"));
    assert_eq!(sent[0].headers.iter().filter(|(k, _)| k == "authorization").count(), 1);

    let log = b.log_lines("vault:home/mail@1");
    assert_eq!(log.len(), 2);
    assert_eq!(log[0].what, "POST /api/send");
    assert_eq!(log[0].id.as_deref(), Some(ev.id.to_hex().as_str()));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_redirect_comes_back_as_it_is_and_big_answers_are_refused() {
    start();
    let (origin, seen) = serve(plain_server(|s| match s.path.as_str() {
        "/api/moved" => reply(302, &[("location", "http://127.0.0.1:9/elsewhere"), ("set-cookie", "a=b")], b""),
        "/api/huge" => reply(200, &[("content-length", "30000000")], b"short"),
        _ => reply(200, &[], b"elsewhere"),
    }))
    .await;
    let k = Keys::generate();
    let b = broker("redirect", &k, &[json!({ "id": "web", "kind": "http", "url": format!("{origin}/api/") })]);
    let res = b.http(&k, "s", "web", &req("GET", "moved")).await.unwrap();
    assert_eq!(res.status, 302);
    assert_eq!(res.headers.get("location").map(String::as_str), Some("http://127.0.0.1:9/elsewhere"));
    assert!(!res.headers.contains_key("set-cookie"));
    assert_eq!(b.http(&k, "s", "web", &req("GET", "huge")).await.unwrap_err().code, "too_large");
    let seen = seen.lock().unwrap().clone();
    assert_eq!(seen.iter().filter(not_probe).map(|s| s.path.as_str()).collect::<Vec<_>>(), vec!["/api/moved", "/api/huge"], "nothing followed");
    assert!(seen.iter().all(|s| s.header("authorization").is_none()), "auth none: nothing signed");
    assert!(b.log_lines("vault:home/mail@1").is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_kept_token_is_sent_as_bearer() {
    start();
    let (origin, seen) = serve(plain_server(|_| reply(200, &[], b"{}"))).await;
    let k = Keys::generate();
    let svc = json!({ "id": "matrix", "kind": "http", "url": format!("{origin}/_matrix/"), "auth": "token" });
    let b = broker("token", &k, std::slice::from_ref(&svc));
    b.token_set(&k, "vault:home/mail@1", &svc, Some("syt_abc")).unwrap();
    let mut r = req("GET", "client/v3/sync");
    r.headers.insert("authorization".into(), "Bearer other".into());
    assert_eq!(b.http(&k, "s", "matrix", &r).await.unwrap().status, 200);
    let seen = seen.lock().unwrap().clone();
    let sent: Vec<&Seen> = seen.iter().filter(not_probe).collect();
    assert_eq!(sent[0].header("authorization"), Some("Bearer syt_abc"));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_server_that_answers_as_a_hub_gets_nothing_signed() {
    start();
    let (origin, seen) = serve(|s: &Seen| match s.path.as_str() {
        "/.well-known/parachute-account" => reply(404, &[], b"no"),
        "/.well-known/parachute.json" => reply(200, &[("content-type", "application/json")], br#"{"vaults":[]}"#),
        _ => reply(200, &[], b"should not be reached"),
    })
    .await;
    let k = Keys::generate();
    let b = broker("hub", &k, &[json!({ "id": "x", "kind": "http", "url": format!("{origin}/"), "auth": "nip98" })]);
    assert_eq!(b.http(&k, "s", "x", &req("POST", "mcp")).await.unwrap_err().code, "hub_probe");
    assert_eq!(b.http(&k, "s", "x", &req("GET", "anything")).await.unwrap_err().code, "hub_probe", "remembered");
    let seen = seen.lock().unwrap().clone();
    assert!(seen.iter().all(|s| s.path.starts_with("/.well-known/") && s.header("authorization").is_none()), "{seen:?}");
    assert_eq!(seen.len(), 2, "asked once");
    assert!(b.log_lines("vault:home/mail@1").is_empty(), "nothing signed");

    // the same for a relay's media server
    let b = broker("hub-media", &k, &[json!({ "id": "r", "kind": "nostr-relay", "url": origin.replace("http://", "ws://"), "media": true })]);
    assert_eq!(b.media(&k, "s", "r", &"ab".repeat(32), "png").await.unwrap_err().code, "hub_probe");
    assert_eq!(b.upload(&k, "s", "r", &B64.encode(b"x"), "text/plain").await.unwrap_err().code, "hub_probe");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_probe_that_fails_signs_nothing_and_is_asked_again() {
    start();
    // first both well-knowns fail (500), then one asks to wait (429), then the server is fine
    let phase = Arc::new(AtomicU8::new(0));
    let at = phase.clone();
    let (origin, seen) = serve(move |s: &Seen| match (at.load(Ordering::SeqCst), s.path.as_str()) {
        (0, p) if p.starts_with("/.well-known/") => reply(500, &[], b"busy"),
        (1, "/.well-known/parachute.json") => reply(429, &[("retry-after", "5")], b"wait"),
        (_, p) if p.starts_with("/.well-known/") => reply(404, &[], b"no"),
        _ => reply(200, &[], b"ok"),
    })
    .await;
    let k = Keys::generate();
    let b = broker("unsure", &k, &[json!({ "id": "x", "kind": "http", "url": format!("{origin}/api/"), "auth": "nip98" })]);
    assert_eq!(b.http(&k, "s", "x", &req("GET", "a")).await.unwrap_err().code, "hub_unsure");
    phase.store(1, Ordering::SeqCst);
    assert_eq!(b.http(&k, "s", "x", &req("GET", "a")).await.unwrap_err().code, "hub_unsure", "asked again, and 429 is no answer");
    assert!(seen.lock().unwrap().iter().all(|s| s.path.starts_with("/.well-known/")), "fail closed: nothing sent");
    phase.store(2, Ordering::SeqCst);
    assert_eq!(b.http(&k, "s", "x", &req("GET", "a")).await.unwrap().status, 200, "not remembered: asked again");
    // a server that isn't there at all: the same
    let gone = broker("gone", &k, &[json!({ "id": "x", "kind": "http", "url": "http://127.0.0.1:9/api/", "auth": "nip98" })]);
    assert_eq!(gone.http(&k, "s", "x", &req("GET", "a")).await.unwrap_err().code, "hub_unsure");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_well_known_file_behind_a_redirect_is_no_answer() {
    start();
    let (origin, seen) = serve(|s: &Seen| if s.path.starts_with("/.well-known/") { reply(302, &[("location", "https://hub.example/.well-known/parachute.json")], b"") } else { reply(200, &[], b"ok") }).await;
    let k = Keys::generate();
    let b = broker("redirect", &k, &[json!({ "id": "x", "kind": "http", "url": format!("{origin}/api/"), "auth": "nip98" })]);
    assert_eq!(b.http(&k, "s", "x", &req("GET", "a")).await.unwrap_err().code, "hub_unsure");
    assert!(seen.lock().unwrap().iter().all(|s| s.path.starts_with("/.well-known/")), "nothing signed or sent");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_gateway_that_takes_no_get_is_not_a_hub() {
    // the Uni app's mail gateway answers every GET with 501: an answer (no GET here, so no hub's files), not trouble
    start();
    let (origin, seen) = serve(|s: &Seen| if s.method == "GET" { reply(501, &[], b"Unsupported method") } else { reply(200, &[("content-type", "application/json")], b"{}") }).await;
    let k = Keys::generate();
    let b = broker("gateway", &k, &[json!({ "id": "mail", "kind": "http", "url": format!("{origin}/mail/"), "auth": "nip98" })]);
    assert_eq!(b.http(&k, "s", "mail", &req("POST", "session")).await.unwrap().status, 200);
    assert!(seen.lock().unwrap().iter().any(|s| s.path == "/mail/session" && s.header("authorization").is_some()), "signed and sent");
}

#[tokio::test(flavor = "multi_thread")]
async fn hub_paths_and_hubs_signed_in_to_later_are_refused() {
    start();
    let (origin, seen) = serve(plain_server(|_| reply(200, &[], b"ok"))).await;
    let k = Keys::generate();
    let d = dir("paths");
    let b = Broker::new(d.clone()).unwrap();
    b.open(&k, "s", &applet(), &[json!({ "id": "x", "kind": "http", "url": format!("{origin}/"), "auth": "nip98" })], &[]).unwrap();
    for p in ["account/mcp", "/account/", "api/auth/nostr/verify", "vault/notes/mcp", "Account/mcp", "//account/mcp", "%61ccount/mcp"] {
        assert_eq!(b.http(&k, "s", "x", &req("POST", p)).await.unwrap_err().code, "hub_path", "{p}");
    }
    assert!(seen.lock().unwrap().is_empty(), "refused before anything was asked");
    assert_eq!(b.http(&k, "s", "x", &req("GET", "fine")).await.unwrap().status, 200);
    // the person signs in to that origin as a hub after the applet was allowed: it counts at once
    parachute_lib::door::remember_hub(&d, &url::Url::parse(&origin).unwrap()).unwrap();
    assert_eq!(b.http(&k, "s", "x", &req("GET", "fine")).await.unwrap_err().code, "hub_known");
}

#[tokio::test(flavor = "multi_thread")]
async fn files_go_up_and_come_down_signed_for_their_hash() {
    start();
    let (origin, seen) = serve(plain_server(|s| match (s.method.as_str(), s.path.as_str()) {
        ("PUT", "/upload") => reply(404, &[], b"no"),
        ("PUT", "/media/upload") => reply(200, &[("content-type", "application/json")], format!(r#"{{"url":"x","sha256":"{}","size":5,"type":"text/plain"}}"#, sha256_hex(&s.body)).as_bytes()),
        ("GET", p) if p.starts_with("/media/") => reply(200, &[("content-type", "image/png")], b"\x89PNG"),
        _ => reply(400, &[], b""),
    }))
    .await;
    let k = Keys::generate();
    let relay = origin.replace("http://", "ws://");
    let b = broker("media", &k, &[json!({ "id": "r", "kind": "nostr-relay", "url": relay, "media": true }), json!({ "id": "plain", "kind": "nostr-relay", "url": relay })]);
    let desc = b.upload(&k, "s", "r", &B64.encode(b"hello"), "text/plain").await.unwrap();
    assert_eq!(desc["sha256"], sha256_hex(b"hello"));
    let h = "cd".repeat(32);
    let got = b.media(&k, "s", "r", &h, "png").await.unwrap();
    assert_eq!((got.media_type.as_str(), B64.decode(&got.body).unwrap()), ("image/png", b"\x89PNG".to_vec()));
    assert_eq!(b.upload(&k, "s", "plain", &B64.encode(b"x"), "text/plain").await.unwrap_err().code, "out_of_scope", "no media declared");

    let seen = seen.lock().unwrap().clone();
    let sent: Vec<&Seen> = seen.iter().filter(not_probe).collect();
    assert_eq!(sent.iter().map(|s| format!("{} {}", s.method, s.path)).collect::<Vec<_>>(), vec!["PUT /upload", "PUT /media/upload", format!("GET /media/{h}.png").as_str()]);
    let host = origin.trim_start_matches("http://");
    let up = nostr_auth(sent[0]);
    assert_eq!(sent[0].header("authorization"), sent[1].header("authorization"), "one signature for the upload");
    assert_eq!(up.kind, nostr::Kind::from(24242));
    assert_eq!((tag(&up, "t").unwrap(), tag(&up, "x").unwrap(), tag(&up, "server").unwrap()), ("upload".into(), sha256_hex(b"hello"), host.to_string()));
    assert!(tag(&up, "expiration").unwrap().parse::<u64>().unwrap() > nostr::Timestamp::now().as_secs());
    assert_eq!(sent[1].header("x-sha-256"), Some(sha256_hex(b"hello").as_str()));
    assert_eq!(sent[1].header("content-type"), Some("text/plain"));
    assert_eq!(sent[1].body, b"hello");
    let get = nostr_auth(sent[2]);
    assert_eq!((tag(&get, "t").unwrap(), tag(&get, "x").unwrap()), ("get".into(), h.clone()));
    let what: Vec<String> = b.log_lines("vault:home/mail@1").into_iter().map(|l| l.what).collect();
    assert_eq!(what, vec!["upload", "media"]);
}
