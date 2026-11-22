//! The native side against the calendar door (~/Code/uni-calendar, the Uni app's T-229 door; not public, so not in the
//! Services workflow, whose servers all run in CI): CAL_DOOR its address, CAL_KEY a file with the hex key it maps to its
//! owner. Run by hand against `uni-cal serve` on a throwaway vault: skipped when they aren't set.
use nostr::base64::engine::general_purpose::STANDARD as B64;
use nostr::base64::Engine;
use nostr::Keys;
use parachute_lib::services::{Applet, Broker, HttpReq, Role};
use serde_json::{json, Value};

fn broker(name: &str, keys: &Keys, services: &[Value]) -> Broker {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let d = std::env::temp_dir().join(format!("parachute-calendar-door-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    let b = Broker::new(d).unwrap();
    b.open(keys, "s", &Applet { name: "Real".into(), subject: "vault:home/real@1".into() }, services, &[]).unwrap();
    b
}
/// The calendar door (CAL_DOOR, `uni-cal serve` from ~/Code/uni-calendar on a throwaway vault; CAL_KEY a file with the
/// hex key it maps to its owner): a GET with a query and a POST op, as applets/calendar.tsx sends them, signed here.
#[tokio::test(flavor = "multi_thread")]
async fn the_calendar_door_takes_what_the_native_side_signs() {
    let (Ok(door), Ok(file)) = (std::env::var("CAL_DOOR"), std::env::var("CAL_KEY")) else { eprintln!("skipped: CAL_DOOR/CAL_KEY unset"); return };
    let k = Keys::parse(std::fs::read_to_string(file).unwrap().trim()).unwrap();
    let b = broker("cal", &k, &[json!({ "id": "cal", "kind": "http", "url": format!("{door}/cal/v1/"), "auth": "nip98" })]);
    let get = |path: &str| HttpReq { method: "GET".into(), path: path.into(), ..Default::default() };
    let s = b.http(&k, &Role::Everyday, "s", "cal", &get("session")).await.unwrap();
    let body: Value = serde_json::from_slice(&B64.decode(s.body).unwrap()).unwrap();
    assert_eq!(s.status, 200, "{body}");
    assert_eq!(body["role"], "owner", "{body}");
    let mut op = HttpReq { method: "POST".into(), path: "op".into(), ..Default::default() };
    op.body = Some(B64.encode(json!({ "op": "create", "opId": format!("native-{}", std::process::id()), "fields": { "title": "Made-up: native", "start": "2030-01-02T10:00:00.000Z", "end": "2030-01-02T11:00:00.000Z" } }).to_string()));
    op.headers.insert("content-type".into(), "application/json".into());
    let made = b.http(&k, &Role::Everyday, "s", "cal", &op).await.unwrap();
    assert_eq!(made.status, 200, "{}", String::from_utf8_lossy(&B64.decode(made.body).unwrap()));
    // the window's query, percent-encoded as the applet writes it
    let w = b.http(&k, &Role::Everyday, "s", "cal", &get("events?from=2030-01-02T00%3A00%3A00.000Z&to=2030-01-03T00%3A00%3A00.000Z")).await.unwrap();
    let body: Value = serde_json::from_slice(&B64.decode(w.body).unwrap()).unwrap();
    assert_eq!(w.status, 200, "{body}");
    assert!(body["instances"].as_array().unwrap().iter().any(|i| i["title"] == "Made-up: native"), "{body}");
}
