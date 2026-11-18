//! The Uni app's sealed-card tests (`sealed_card.rs`), adapted to a list of trusted keys and to `prepare_answer`, plus
//! what KEYRING.md's threat model adds: an untrusted signer with a real box, a replayed request, the view never holding
//! the data key, the ledger written before a wrap is handed out, and Uni's own verifier opening the answer.

use std::path::{Path, PathBuf};

use nostr::nips::nip44;
use nostr::{Event, EventBuilder, EventId, JsonUtil, Keys, Kind, PublicKey, Tag};
use serde_json::{json, Value};

use super::card::reply_wrap;
use super::*;

const ROOM: &str = "6a0c3f1e-1111-4222-8333-944455556666";
const NOW: u64 = 1_760_000_000;
/// A synthetic data key: it must reach the one-time key inside the rumor, and nowhere else.
const DEK: &str = "5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a";
const CT: &str = "c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7";

struct World {
    me: Keys,
    uni: Keys,
    seal: SealKey,
}

fn world() -> World {
    let me = Keys::generate();
    World { seal: seal_key(&approval_role(me.clone())).unwrap(), me, uni: Keys::generate() }
}

impl World {
    fn trusted(&self) -> Vec<PublicKey> {
        vec![self.uni.public_key()]
    }
    fn approval(&self) -> ApprovalKeys {
        approval_role(self.me.clone())
    }
}

/// A folder of its own under the temp dir, removed when dropped.
struct TempDir(PathBuf);

impl TempDir {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!("parachute-approvals-{}", &Keys::generate().public_key().to_hex()[..16]));
        std::fs::create_dir_all(&p).unwrap();
        Self(p)
    }
    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// The credential's data key sealed to `to` as the broker's `seal_value` does (uni-ops sealed.py): the inner JSON in
/// Python's `json.dumps` default form and field order, NIP-44 v2 from a fresh ephemeral key.
fn boxed_with(to: &PublicKey, name: &str, class: &str, dek: &str) -> Value {
    let esk = Keys::generate();
    let inner = format!(r#"{{"v": 1, "name": "{name}", "class": "{class}", "dek": "{dek}", "ct_sha256": "{CT}"}}"#);
    let dek_box = nip44::encrypt(esk.secret_key(), to, inner, nip44::Version::V2).unwrap();
    json!({"epk": esk.public_key().to_hex(), "dek_box": dek_box, "ct_sha256": CT})
}

fn boxed(to: &PublicKey, name: &str, class: &str) -> Value {
    boxed_with(to, name, class, DEK)
}

/// One request's fields, as the broker's `_fields` writes them; returns them with the one-time key.
fn fields(w: &World, credential: &str, class: &str, ttl_s: u64, uses: u64) -> (Value, Keys) {
    let one_time = Keys::generate();
    let action = "dns.edit";
    let payload = json!({"name": "demo", "type": "A", "content": "192.0.2.7", "zone": "example.org", "note": "https://example.org/?a=<b>"});
    let f = json!({
        "v": 1, "rid": &Keys::generate().public_key().to_hex()[..32], "action": action, "credential": credential, "class": class,
        "scope": "Add an A record for demo.example.org", "ttl_s": ttl_s, "uses": uses,
        "payload_digest": payload_digest(action, &payload).unwrap(), "payload": payload, "expires": NOW + 900,
        "rpk": one_time.public_key().to_hex(), "box": boxed(&w.seal.public_key(), credential, class),
    });
    (f, one_time)
}

fn signed(by: &Keys, kind: u16, content: String) -> Event {
    EventBuilder::new(Kind::Custom(kind), content).tags([Tag::parse(["h", ROOM]).unwrap()]).sign_with_keys(by).unwrap()
}

fn card(by: &Keys, f: &Value) -> Event {
    signed(by, 9, format!("🔑 **Uni asks to use x**\nFor: dns.edit.\n\n```{CARD_FENCE}\n{}\n```", serde_json::to_string_pretty(f).unwrap()))
}

fn morning(by: &Keys, rows: &[Value]) -> Event {
    signed(by, 9, format!("🔑 **Uni's morning card**\n\n```{MORNING_FENCE}\n{}\n```", json!({"v": 1, "rows": rows})))
}

fn check(w: &World, ev: &Event) -> std::result::Result<Card, Refusal> {
    check_card(ev, &w.trusted(), &w.seal, NOW)
}

fn view_of(w: &World, ev: &Event) -> CardView {
    view(ev, &w.trusted(), &w.seal, &Answers::default(), NOW)
}

/// `f` with `change` applied and its payload digest left as it was.
fn with(f: &Value, change: impl FnOnce(&mut Value)) -> Value {
    let mut g = f.clone();
    change(&mut g);
    g
}

fn rid_of(f: &Value) -> Vec<String> {
    vec![f["rid"].as_str().unwrap().to_string()]
}

/// The rumor inside `wrap`, opened with the request's one-time key, and who sealed it.
fn open(wrap: &Event, one_time: &Keys) -> (Value, PublicKey) {
    let seal = Event::from_json(nip44::decrypt(one_time.secret_key(), &wrap.pubkey, &wrap.content).unwrap()).unwrap();
    seal.verify().unwrap();
    assert_eq!(seal.kind, Kind::Seal);
    let rumor: Value = serde_json::from_str(&nip44::decrypt(one_time.secret_key(), &seal.pubkey, &seal.content).unwrap()).unwrap();
    (rumor, seal.pubkey)
}

fn tags_of(ev: &Event) -> Vec<Vec<String>> {
    ev.tags.iter().map(|t| t.as_slice().to_vec()).collect()
}

#[test]
fn canonical_json_and_the_digests_match_the_reference() {
    // computed by the broker's `sealed.canonical` / `payload_digest` / `request_digest` (uni-ops sealed.py)
    let v = json!({"b": [1, "é\n\u{1}\"\\\u{7f}", null, true, 0, 18446744073709551615u64],
        "a": {"z": -3, "é": "\u{2028}/<>", "éa": 1, "Z": 2}, "": ""});
    assert_eq!(canonical_json(&v).unwrap(), "{\"\":\"\",\"a\":{\"Z\":2,\"z\":-3,\"é\":\"\u{2028}/<>\",\"éa\":1},\"b\":[1,\"é\\n\\u0001\\\"\\\\\u{7f}\",null,true,0,18446744073709551615]}");
    assert_eq!(payload_digest("dns.edit", &v).unwrap(), "cc495f425fc7a9726c46709df96d81e42365135a96ff62f7466d56d3a3d76894");
    assert_eq!(payload_digest("dns.edit", &Value::Null).unwrap(), "c39de7b5110b9c7f68683d8fe2b9c6ed9680ceaace256ecfc55ca5682a8fefdb");
    assert_eq!(request_digest(&json!({"v": 1, "x": v})).unwrap(), "7ac3dbd43962b7b7c7b71fc0cbba946b2d93d46579728dacec353d642e697a74");
    // a float can't be checked the same way on both sides: refused, not guessed
    assert_eq!(canonical_json(&json!({"a": 1.5})), None);
    assert_eq!(canonical_json(&json!([1.0])), None);
}

#[test]
fn a_good_card_passes_and_binds_its_digest() {
    let w = world();
    let (f, one_time) = fields(&w, "cloudflare-dns", "powerful", 600, 1);
    let c = check(&w, &card(&w.uni, &f)).unwrap();
    assert_eq!((c.kind, c.author), (CardKind::Single, w.uni.public_key()));
    let r = &c.rows[0];
    assert_eq!((r.credential.as_str(), r.class, r.ttl_s, r.uses), ("cloudflare-dns", Class::Powerful, 600, 1));
    assert_eq!(r.rpk, one_time.public_key());
    assert_eq!(r.request_digest, request_digest(&f).unwrap());
    // the digest covers every field: change any one (re-signed by Uni) and the request digest changes
    for k in ["scope", "ttl_s", "expires"] {
        let g = with(&f, |g| g[k] = if k == "scope" { json!("Delete every record") } else { json!(f[k].as_u64().unwrap() - 1) });
        let other = check(&w, &card(&w.uni, &g)).unwrap();
        assert_ne!(other.rows[0].request_digest, r.request_digest, "{k}");
    }
    // the payload is bound by its own digest: a changed payload with the old digest is refused
    let g = with(&f, |g| g["payload"]["content"] = json!("198.51.100.9"));
    assert_eq!(check(&w, &card(&w.uni, &g)).unwrap_err(), Refusal::Mismatch);
    let g = with(&f, |g| g["payload_digest"] = json!("0".repeat(64)));
    assert_eq!(check(&w, &card(&w.uni, &g)).unwrap_err(), Refusal::Mismatch);
    // the data key never shows in a Debug print
    assert!(!format!("{c:?}").contains(DEK));
}

#[test]
fn a_wrong_signer_or_kind_or_a_tampered_event_is_not_unis() {
    let w = world();
    let (f, _) = fields(&w, "cloudflare-dns", "powerful", 600, 1);
    assert_eq!(check(&w, &card(&Keys::generate(), &f)).unwrap_err(), Refusal::NotUni, "another signer");
    assert_eq!(check(&w, &card(&w.me, &f)).unwrap_err(), Refusal::NotUni, "the owner's own key");
    let k1 = signed(&w.uni, 1, card(&w.uni, &f).content.clone());
    assert_eq!(check(&w, &k1).unwrap_err(), Refusal::NotUni, "kind 1");
    // Uni's real card with its content changed and its id and signature kept (what a lying relay serves)
    let real = card(&w.uni, &f);
    let mut v: Value = serde_json::from_str(&real.as_json()).unwrap();
    v["content"] = json!(real.content.replace("\"uses\": 1", "\"uses\": 2"));
    let forged = Event::from_json(v.to_string()).unwrap();
    assert_eq!(check(&w, &forged).unwrap_err(), Refusal::NotUni);
    // a grant that trusts nobody accepts nothing; one that trusts several accepts each of them
    assert_eq!(check_card(&real, &[], &w.seal, NOW).unwrap_err(), Refusal::NotUni);
    let hermes = Keys::generate();
    let both = [hermes.public_key(), w.uni.public_key()];
    assert_eq!(check_card(&card(&hermes, &f), &both, &w.seal, NOW).unwrap().author, hermes.public_key());
    assert_eq!(check_card(&real, &both, &w.seal, NOW).unwrap().author, w.uni.public_key());
}

/// KEYRING.md threat model: a forged card from another key carrying a real box (one Uni sealed to this device) is still
/// not Uni's, and nothing is recorded or sealed for it.
#[test]
fn an_untrusted_signer_with_a_real_box_is_refused_and_nothing_is_recorded() {
    let w = world();
    let (f, _) = fields(&w, "cloudflare-dns", "powerful", 600, 1);
    let mallory = Keys::generate();
    let forged = card(&mallory, &f);
    // the box itself is real: the same fields signed by Uni pass
    assert!(check(&w, &card(&w.uni, &f)).is_ok());
    assert_eq!(check(&w, &forged).unwrap_err(), Refusal::NotUni);
    assert_eq!(view_of(&w, &forged).refused.as_deref(), Some("Not signed by Uni."));
    let dir = TempDir::new();
    for decision in [Decision::Approve, Decision::Deny] {
        let got = prepare_answer(&w.approval(), &w.trusted(), &forged, decision, &rid_of(&f), dir.path(), NOW);
        assert_eq!(got.unwrap_err(), Error::Refused(Refusal::NotUni));
    }
    assert!(!dir.path().join(ANSWERS_FILE).exists(), "nothing recorded for a forged card");
}

#[test]
fn a_box_sealed_to_another_device_or_another_credential_is_refused() {
    let w = world();
    let (f, _) = fields(&w, "cloudflare-dns", "powerful", 600, 1);
    // sealed to another enrollment
    let other = seal_key(&approval_role(Keys::generate())).unwrap();
    let g = with(&f, |g| g["box"] = boxed(&other.public_key(), "cloudflare-dns", "powerful"));
    assert_eq!(check(&w, &card(&w.uni, &g)).unwrap_err(), Refusal::NotSealedHere);
    assert_eq!(Refusal::NotSealedHere.message(), "This card isn't sealed to this device's approval key.");
    // sealed to the owner's approval key itself, not the sealing key: never opened with it
    let g = with(&f, |g| g["box"] = boxed(&w.me.public_key(), "cloudflare-dns", "powerful"));
    assert_eq!(check(&w, &card(&w.uni, &g)).unwrap_err(), Refusal::NotSealedHere);
    // the parent's box relabelled as a dummy
    let g = with(&f, |g| g["credential"] = json!("dummy"));
    assert_eq!(check(&w, &card(&w.uni, &g)).unwrap_err(), Refusal::OtherCredential);
    // another credential's ciphertext
    let g = with(&f, |g| g["box"]["ct_sha256"] = json!("ab".repeat(32)));
    assert_eq!(check(&w, &card(&w.uni, &g)).unwrap_err(), Refusal::OtherCredential);
    // a powerful credential called routine, and the other way round
    let g = with(&f, |g| g["class"] = json!("routine"));
    assert_eq!(check(&w, &card(&w.uni, &g)).unwrap_err(), Refusal::Misstated);
    let g = with(&f, |g| g["box"] = boxed(&w.seal.public_key(), "cloudflare-dns", "routine"));
    assert_eq!(check(&w, &card(&w.uni, &g)).unwrap_err(), Refusal::Misstated);
}

/// A staging window: the parent opens for `ttl_s` (at most 600 s, the powerful cap) to mint one key that lives
/// `window.for_s`, up to 30 days. The cap is on the unlock, so a 30-day window card passes, and it still asks for the
/// device's own unlock.
#[test]
fn a_30_day_staging_window_card_passes_the_powerful_cap_and_still_needs_the_unlock() {
    let w = world();
    let (mut g, _) = fields(&w, "cf-parent", "powerful", 120, 1);
    g["action"] = json!("job.cloudflare");
    g["scope"] = json!("🟡 Acct (no production) · all of it · 30 days\nCan: x.");
    g["payload"] = json!({"v": 1, "job": "window.acct", "account": "acct", "account_id": "0".repeat(32),
        "templates": ["d1-write", "kv-write", "pages-write", "r2-admin", "workers-scripts-write"], "window_s": 120,
        "purpose": "p", "window": {"for_s": 30 * 86_400}});
    g["payload_digest"] = json!(payload_digest("job.cloudflare", &g["payload"]).unwrap());
    let c = check(&w, &card(&w.uni, &g)).unwrap();
    assert_eq!((c.rows[0].ttl_s, c.rows[0].class), (120, Class::Powerful));
    assert!(always_unlock(Class::Powerful, "job.cloudflare", &g["payload"]));
    assert_eq!(reach_line("job.cloudflare", g["scope"].as_str().unwrap()).as_deref(), Some("🟡 Acct (no production) · all of it · 30 days"));
}

#[test]
fn the_class_caps_are_enforced_here() {
    let w = world();
    for (class, ttl, uses, ok) in [
        ("powerful", 600, 1, true),
        ("powerful", 601, 1, false),
        ("powerful", 60, 2, false),
        ("powerful", 0, 1, false),
        ("routine", 50_400, 200, true),
        ("routine", 50_401, 1, false),
        ("routine", 60, 201, false),
        ("routine", 60, 0, false),
    ] {
        let (f, _) = fields(&w, "r2-backups", class, ttl, uses);
        let got = check(&w, &card(&w.uni, &f));
        let class = if class == "powerful" { Class::Powerful } else { Class::Routine };
        if ok {
            assert!(got.is_ok(), "{class:?} {ttl} {uses}");
        } else {
            assert_eq!(got.unwrap_err(), Refusal::TooLong(class), "{class:?} {ttl} {uses}");
        }
    }
    assert_eq!(Refusal::TooLong(Class::Powerful).message(), "A powerful credential can't be opened for that long.");
}

#[test]
fn expiry_is_checked_before_anything_is_opened() {
    let w = world();
    let (f, _) = fields(&w, "cloudflare-dns", "powerful", 600, 1);
    let ev = card(&w.uni, &f);
    assert!(check_card(&ev, &w.trusted(), &w.seal, NOW + 899).is_ok());
    assert_eq!(check_card(&ev, &w.trusted(), &w.seal, NOW + 900).unwrap_err(), Refusal::Expired);
    // an expired card with a box for another device still says expired (the order of CARD.md §3)
    let other = seal_key(&approval_role(Keys::generate())).unwrap();
    assert_eq!(check_card(&ev, &w.trusted(), &other, NOW + 900).unwrap_err(), Refusal::Expired);
}

#[test]
fn incomplete_or_mistyped_fields_are_refused() {
    let w = world();
    let (f, _) = fields(&w, "cloudflare-dns", "powerful", 600, 1);
    type Change = Box<dyn Fn(&mut Value)>;
    let changes: Vec<Change> = vec![
        Box::new(|g| {
            g.as_object_mut().unwrap().remove("payload");
        }),
        Box::new(|g| {
            g.as_object_mut().unwrap().remove("rpk");
        }),
        Box::new(|g| g["extra"] = json!("shown nowhere")),
        Box::new(|g| g["box"]["extra"] = json!(1)),
        Box::new(|g| g["v"] = json!(2)),
        Box::new(|g| g["v"] = json!(true)),
        Box::new(|g| g["ttl_s"] = json!(600.0)),
        Box::new(|g| g["ttl_s"] = json!("600")),
        Box::new(|g| g["uses"] = json!(-1)),
        Box::new(|g| g["expires"] = json!(null)),
        Box::new(|g| g["class"] = json!("admin")),
        Box::new(|g| g["rid"] = json!("0123")),
        Box::new(|g| g["rpk"] = json!("AB".repeat(32))),
        Box::new(|g| g["rpk"] = json!("00".repeat(32))),
        Box::new(|g| g["credential"] = json!("../parent")),
        Box::new(|g| g["action"] = json!("DNS edit")),
        Box::new(|g| g["scope"] = json!("")),
        Box::new(|g| g["scope"] = json!("x".repeat(281))),
    ];
    for (i, change) in changes.iter().enumerate() {
        let g = with(&f, |g| change(g));
        assert_eq!(check(&w, &card(&w.uni, &g)).map(|_| ()), Err(Refusal::Incomplete), "change {i}");
    }
    // no block, a block that doesn't parse, two blocks, both fences, an unclosed fence
    let block = serde_json::to_string(&f).unwrap();
    for body in [
        "🔑 Uni asks to use cloudflare-dns".to_string(),
        format!("```{CARD_FENCE}\n{{not json\n```"),
        format!("```{CARD_FENCE}\n{block}\n```\n```{CARD_FENCE}\n{block}\n```"),
        format!("```{CARD_FENCE}\n{block}\n```\n```{MORNING_FENCE}\n{{\"v\":1,\"rows\":[{block}]}}\n```"),
        format!("```{CARD_FENCE}\n{block}"),
    ] {
        assert_eq!(check(&w, &signed(&w.uni, 9, body.clone())).unwrap_err(), Refusal::Incomplete, "{body}");
    }
}

#[test]
fn the_morning_card_is_routine_only_and_each_row_is_checked() {
    let w = world();
    let rows: Vec<Value> = ["r2-backups", "pages-deploy", "dns-read"].iter().map(|n| fields(&w, n, "routine", 50_400, 200).0).collect();
    let c = check(&w, &morning(&w.uni, &rows)).unwrap();
    assert_eq!((c.kind, c.rows.len()), (CardKind::Morning, 3));
    assert_eq!(
        c.rows.iter().map(|r| r.request_digest.clone()).collect::<Vec<_>>(),
        rows.iter().map(|r| request_digest(r).unwrap()).collect::<Vec<_>>()
    );
    // one powerful row refuses the whole card, whether it says so or its box does
    let (p, _) = fields(&w, "cloudflare-parent", "powerful", 600, 1);
    assert_eq!(check(&w, &morning(&w.uni, &[rows[0].clone(), p])).unwrap_err(), Refusal::PowerfulOnMorning);
    let hidden = with(&rows[1], |g| g["box"] = boxed(&w.seal.public_key(), "pages-deploy", "powerful"));
    assert_eq!(check(&w, &morning(&w.uni, &[rows[0].clone(), hidden])).unwrap_err(), Refusal::Misstated);
    // any row failing its own checks refuses the card
    let bad = with(&rows[2], |g| g["payload"] = json!({"zone": "other"}));
    assert_eq!(check(&w, &morning(&w.uni, &[rows[0].clone(), bad])).unwrap_err(), Refusal::Mismatch);
    // a repeated row, request id or one-time key, a mixed answer-by time, no rows, too many rows
    let same_rid = with(&rows[1], |g| g["rid"] = rows[0]["rid"].clone());
    let same_rpk = with(&rows[1], |g| g["rpk"] = rows[0]["rpk"].clone());
    let later = fields(&w, "later", "routine", 60, 1).0;
    let later = with(&later, |g| g["expires"] = json!(NOW + 901));
    let many: Vec<Value> = (0..21).map(|i| fields(&w, &format!("c{i}"), "routine", 60, 1).0).collect();
    for set in [
        vec![rows[0].clone(), rows[0].clone()],
        vec![rows[0].clone(), same_rid],
        vec![rows[0].clone(), same_rpk],
        vec![rows[0].clone(), later],
        vec![],
        many,
    ] {
        assert_eq!(check(&w, &morning(&w.uni, &set)).unwrap_err(), Refusal::Incomplete);
    }
    // not Uni's
    assert_eq!(check(&w, &morning(&Keys::generate(), &rows)).unwrap_err(), Refusal::NotUni);
}

#[test]
fn the_reply_goes_only_to_the_one_time_key_with_the_data_key_only_on_approve() {
    let w = world();
    let (f, one_time) = fields(&w, "cloudflare-dns", "powerful", 600, 1);
    let ev = card(&w.uni, &f);
    let c = check(&w, &ev).unwrap();
    let r = &c.rows[0];
    let wrap = reply_wrap(&w.approval(), &c, r, Decision::Approve, NOW).unwrap();
    wrap.verify().unwrap();
    assert_eq!(wrap.kind, Kind::GiftWrap);
    assert_ne!(wrap.pubkey, w.me.public_key(), "signed by a throwaway key");
    assert_eq!(tags_of(&wrap), vec![vec!["p".to_string(), w.uni.public_key().to_hex()], vec!["expiration".into(), (NOW + 900).to_string()]]);
    assert!(!wrap.as_json().contains(DEK) && !wrap.as_json().contains(&r.rid));
    // Uni's long-term key and the owner's can't open it
    for k in [w.uni.secret_key(), w.me.secret_key()] {
        assert!(nip44::decrypt(k, &wrap.pubkey, &wrap.content).is_err());
    }
    let (rumor, sealer) = open(&wrap, &one_time);
    assert_eq!(sealer, w.me.public_key());
    assert_eq!(rumor["kind"], KIND_APPROVAL_REPLY);
    assert_eq!(rumor["tags"], json!([["e", ev.id.to_hex()]]));
    let body: Value = serde_json::from_str(rumor["content"].as_str().unwrap()).unwrap();
    assert_eq!(body, json!({"v": 1, "rid": f["rid"], "request_digest": request_digest(&f).unwrap(), "decision": "approve", "dek": DEK}));

    let deny = reply_wrap(&w.approval(), &c, r, Decision::Deny, NOW).unwrap();
    let (rumor, _) = open(&deny, &one_time);
    let body: Value = serde_json::from_str(rumor["content"].as_str().unwrap()).unwrap();
    assert_eq!(body, json!({"v": 1, "rid": f["rid"], "request_digest": request_digest(&f).unwrap(), "decision": "deny"}));
}

#[test]
fn a_replay_is_seen_by_request_id_or_one_time_key() {
    let w = world();
    let (f, _) = fields(&w, "cloudflare-dns", "powerful", 600, 1);
    let ev = card(&w.uni, &f);
    let c = check(&w, &ev).unwrap();
    let answered = |card: &EventId, rid: &str, digest: &str, rpk: &str| Answers {
        answers: vec![Answer {
            card: card.to_hex(),
            rid: rid.into(),
            request_digest: digest.into(),
            rpk: rpk.into(),
            decision: Decision::Approve,
            at: NOW,
            until: Some(NOW + 600),
            expires: NOW + 900,
            wrap: None,
            sent: true,
        }],
    };
    let r = &c.rows[0];
    // its own answer is not a replay
    assert!(!answered(&ev.id, &r.rid, &r.request_digest, &r.rpk.to_hex()).replays(&c));
    // the same request under another card, the same id with other fields, the same one-time key on another request
    let other = EventId::all_zeros();
    assert!(answered(&other, &r.rid, &r.request_digest, &r.rpk.to_hex()).replays(&c));
    assert!(answered(&ev.id, &r.rid, &"0".repeat(64), &"1".repeat(64)).replays(&c));
    assert!(answered(&other, &"9".repeat(32), &"0".repeat(64), &r.rpk.to_hex()).replays(&c));
    assert!(!answered(&other, &"9".repeat(32), &"0".repeat(64), &"1".repeat(64)).replays(&c));
}

/// A request answered under one card, carried again by another card Uni (or a key the grant trusts) signed, is a
/// replay: refused, with nothing new recorded or sealed.
#[test]
fn a_request_id_replayed_under_another_card_is_refused() {
    let w = world();
    let dir = TempDir::new();
    let (f, _) = fields(&w, "cloudflare-dns", "powerful", 600, 1);
    let first = card(&w.uni, &f);
    assert_eq!(prepare_answer(&w.approval(), &w.trusted(), &first, Decision::Deny, &rid_of(&f), dir.path(), NOW).unwrap().len(), 1);
    // the same fields under new words: another event id
    let again = signed(&w.uni, 9, format!("Please, again\n\n```{CARD_FENCE}\n{}\n```", serde_json::to_string(&f).unwrap()));
    assert_ne!(again.id, first.id);
    let before = std::fs::read_to_string(dir.path().join(ANSWERS_FILE)).unwrap();
    for decision in [Decision::Approve, Decision::Deny] {
        let got = prepare_answer(&w.approval(), &w.trusted(), &again, decision, &rid_of(&f), dir.path(), NOW + 5);
        assert_eq!(got.unwrap_err(), Error::Refused(Refusal::Replayed));
    }
    assert_eq!(std::fs::read_to_string(dir.path().join(ANSWERS_FILE)).unwrap(), before, "nothing new recorded");
    let answers = Answers::load(dir.path()).unwrap();
    let v = view(&again, &w.trusted(), &w.seal, &answers, NOW + 5);
    assert_eq!((v.refused.as_deref(), v.rows.len()), (Some(Refusal::Replayed.message()), 0));
    // a new request reusing only the one-time key is a replay too
    let reuse = with(&fields(&w, "cloudflare-dns", "powerful", 600, 1).0, |g| g["rpk"] = f["rpk"].clone());
    let got = prepare_answer(&w.approval(), &w.trusted(), &card(&w.uni, &reuse), Decision::Deny, &rid_of(&reuse), dir.path(), NOW);
    assert_eq!(got.unwrap_err(), Error::Refused(Refusal::Replayed));
}

#[test]
fn the_confirm_names_exactly_what_is_approved() {
    let w = world();
    let (f, _) = fields(&w, "dns-zone", "powerful", 600, 1);
    let ev = card(&w.uni, &f);
    let v = view_of(&w, &ev);
    let rid = f["rid"].as_str().unwrap().to_string();
    let d = request_digest(&f).unwrap();
    assert_eq!(
        approval_summary(&v, std::slice::from_ref(&rid)).unwrap(),
        (
            "Approve a powerful credential".into(),
            format!("Uni: dns-zone · dns.edit, 10 min, 1 use. Add an A record for demo.example.org. Exact job {} {}.", &d[..4], &d[4..8])
        )
    );
    assert!(approval_summary(&v, &["9".repeat(32)]).is_err(), "a request id that isn't on the card");
    assert!(approval_summary(&v, &[]).is_err());
    // one request named twice is not "2 of Uni's morning grants"
    assert_eq!(approval_summary(&v, &[rid.clone(), rid.clone()]).unwrap_err().to_string(), "a request was named twice");
    let rows: Vec<Value> = ["r2-a", "r2-b", "r2-c"].iter().map(|n| fields(&w, n, "routine", 50_400, 200).0).collect();
    let m = view_of(&w, &morning(&w.uni, &rows));
    let pick = [rows[0]["rid"].as_str().unwrap().to_string(), rows[2]["rid"].as_str().unwrap().to_string()];
    let j = |r: &Value| {
        let d = request_digest(r).unwrap();
        format!("job {} {}", &d[..4], &d[4..8])
    };
    assert_eq!(
        approval_summary(&m, &pick).unwrap(),
        (
            "Approve 2 of Uni's morning grants".into(),
            format!("r2-a · dns.edit, 14 h, 200 uses ({}); r2-c · dns.edit, 14 h, 200 uses ({}).", j(&rows[0]), j(&rows[2]))
        )
    );
    // a permanent child token is named in the confirm
    let mint = {
        let (mut g, _) = fields(&w, "cf-parent", "powerful", 60, 1);
        g["action"] = json!("mint.cloudflare");
        g["payload"] = json!({"template": "r2-read", "child_ttl_s": null});
        g["payload_digest"] = json!(payload_digest("mint.cloudflare", &g["payload"]).unwrap());
        g
    };
    let mv = view_of(&w, &card(&w.uni, &mint));
    assert!(approval_summary(&mv, &rid_of(&mint)).unwrap().1.contains("This makes a permanent token."));
    let refused = view_of(&w, &card(&Keys::generate(), &f));
    assert_eq!(approval_summary(&refused, &[rid]).unwrap_err().to_string(), "Not signed by Uni.");
    assert_eq!([span(45), span(600), span(7200), span(5400 * 3)], ["45 s", "10 min", "2 h", "4.5 h"]);
}

/// A powerful credential opens for a job that holds only a small key, decided from the signed payload's templates.
fn job(templates: &[&str]) -> Value {
    json!({"v": 1, "job": "j", "account": "a", "account_id": "0".repeat(32), "templates": templates, "window_s": 300, "purpose": "🟢 trust me"})
}

#[test]
fn small_keys_may_use_the_grace_though_their_credential_is_powerful() {
    let p = Class::Powerful;
    assert!(!always_unlock(p, "job.cloudflare", &job(&["zone-read"])), "names and settings only");
    assert!(!always_unlock(p, "lookup.cloudflare", &json!({"v": 1, "lookup": "discover"})), "names and ids");
    let m = |t: &str, ttl: Value, dest: &str| json!({"template": t, "child_ttl_s": ttl, "destination": dest, "then": "revoke-in-window"});
    assert!(!always_unlock(p, "mint.cloudflare", &m("zone-read", json!(900), "job")));
    assert!(small_key("job.cloudflare", &job(&["zone-read"])) && !small_key("dns.edit", &job(&["zone-read"])));
}

#[test]
fn everything_else_on_a_powerful_credential_always_asks() {
    let p = Class::Powerful;
    for t in ["d1-read", "workers-read", "pages-read", "r2-bucket-read", "r2-bucket-write", "workers-scripts-write", "d1-write", "worker-app", "dns-zone-edit", "something-new"] {
        assert!(always_unlock(p, "job.cloudflare", &job(&[t])), "{t} is not small");
        assert!(always_unlock(p, "job.cloudflare", &job(&["zone-read", t])), "one big right makes the job big: {t}");
    }
    assert!(always_unlock(p, "job.cloudflare", &job(&[])), "no templates");
    assert!(always_unlock(p, "job.cloudflare", &json!({"templates": "zone-read"})), "not a list");
    assert!(always_unlock(p, "job.cloudflare", &json!({"templates": [1]})), "not names");
    assert!(always_unlock(p, "job.cloudflare", &Value::Null));
    // a read key riding on the card is part of what the tap gives
    let mut riding = job(&["zone-read"]);
    riding["checks"] = json!({"templates": ["d1-read"], "for_s": 10800});
    assert!(always_unlock(p, "job.cloudflare", &riding), "a D1 read key rides on it");
    riding["checks"] = json!({"templates": ["zone-read"], "for_s": 10800});
    assert!(!always_unlock(p, "job.cloudflare", &riding), "a small one rides on it");
    riding["checks"] = json!("zone-read");
    assert!(always_unlock(p, "job.cloudflare", &riding), "a check that can't be read");
    // a mint: small only when short and to the job
    let m = |t: &str, ttl: Value, dest: &str| json!({"template": t, "child_ttl_s": ttl, "destination": dest});
    assert!(always_unlock(p, "mint.cloudflare", &m("d1-read", json!(900), "job")));
    assert!(always_unlock(p, "mint.cloudflare", &m("r2-bucket-read", json!(900), "job")), "one bucket can hold people's files");
    assert!(always_unlock(p, "mint.cloudflare", &m("zone-read", Value::Null, "job")), "permanent");
    assert!(always_unlock(p, "mint.cloudflare", &m("zone-read", json!(0), "job")), "0 is no expiry to many APIs");
    assert!(always_unlock(p, "mint.cloudflare", &m("zone-read", json!(90 * 86_400), "lookup-key")), "long-lived");
    assert!(always_unlock(p, "mint.cloudflare", &m("zone-read", json!(900), "seal:x")), "kept");
    assert!(always_unlock(p, "mint.cloudflare", &json!({"child_ttl_s": 900, "destination": "job"})), "no template");
    // only the actions the broker words itself: a caller's request can't borrow the shape
    assert!(always_unlock(p, "dns.edit", &job(&["zone-read"])));
    assert!(always_unlock(p, "lookup.cloudflare", &json!({"v": 1, "lookup": "other"})));
    assert!(always_unlock(p, "cloudflare.job", &job(&["zone-read"])));
}

#[test]
fn the_reach_line_comes_only_from_cards_the_broker_words_itself() {
    let scope = "🔴 All of Acct, production included · 10 min\nCan: deploy any Worker.\nUni says: 🟢 fine";
    assert_eq!(reach_line("job.cloudflare", scope).as_deref(), Some("🔴 All of Acct, production included · 10 min"));
    assert_eq!(reach_line("mint.cloudflare", "🟡 One thing on A · 10 min\nCan: x.").as_deref(), Some("🟡 One thing on A · 10 min"));
    assert_eq!(reach_line("lookup.cloudflare", "🟢 Names · 5 min\nRead-only.").as_deref(), Some("🟢 Names · 5 min"));
    assert_eq!(
        reach_line("github.ruleset.apply", "🟡 Admin on one repo, o/r · one call\nDoes: x.").as_deref(),
        Some("🟡 Admin on one repo, o/r · one call")
    );
    let first = "🔴 Acct — PRODUCTION account · all of it · 10 min";
    assert_eq!(reach_line("job.cloudflare", &format!("{first}\nCan: x.")).as_deref(), Some(first));
    assert_eq!(reach_line("github.other", "🟢 One small thing"), None, "only the one GitHub action the broker words");
    assert_eq!(reach_line("dns.edit", "🟢 One small thing"), None, "a caller's words");
    assert_eq!(reach_line("hermes.tool", "🟢 One small thing"), None);
    assert_eq!(reach_line("job.cloudflare", "One job (x), 10 min, tokens for A"), None, "an older card");
    assert_eq!(reach_line("job.cloudflare", "⚪ something else"), None);
}

#[test]
fn the_read_key_line_comes_only_from_cards_the_broker_words_itself() {
    let scope = "🔴 All of A · 10 min, then read-only 3 h\nCan: x.\nRead key: all D1 data, Workers.\nUni says: y";
    assert_eq!(read_key_line("job.cloudflare", scope).as_deref(), Some("Read key: all D1 data, Workers."));
    assert_eq!(read_key_line("job.cloudflare", "🔴 All of A · 10 min\nCan: x.\nUni says: Read key: none"), None, "the agent's words");
    assert_eq!(read_key_line("dns.edit", scope), None);
}

#[test]
fn a_card_says_when_it_was_asked_and_its_reach() {
    let w = world();
    let (mut f, _) = fields(&w, "cloudflare-parent", "powerful", 600, 1);
    f["action"] = json!("job.cloudflare");
    f["payload"] = job(&["zone-read"]);
    f["payload_digest"] = json!(payload_digest("job.cloudflare", &f["payload"]).unwrap());
    f["scope"] = json!("🟢 Names and settings of every zone on A · 5 min\nCan: read.\nUni says: x");
    let ev = card(&w.uni, &f);
    let v = view_of(&w, &ev);
    assert_eq!(v.rows[0].asked, ev.created_at.as_secs());
    assert_eq!(v.author, w.uni.public_key().to_hex());
    assert_eq!(v.rows[0].reach.as_deref(), Some("🟢 Names and settings of every zone on A · 5 min"));
    assert!(!v.rows[0].always_unlock && !needs_fresh_unlock(&v, std::slice::from_ref(&v.rows[0].rid)));
    let (title, why) = approval_summary(&v, std::slice::from_ref(&v.rows[0].rid)).unwrap();
    assert!(title.contains("powerful"), "the credential it opens stays powerful: {title}");
    assert!(why.contains("Names and settings of every zone") && !why.contains('\n') && !why.contains("Uni says"), "{why}");
    // a read key riding on a card is in the device's own prompt too
    f["scope"] = json!("🔴 All of A · 10 min, then read-only 3 h\nCan: deploy.\nRead key: all D1 data.\nUni says: x");
    f["payload"] = job(&["workers-scripts-write"]);
    f["payload_digest"] = json!(payload_digest("job.cloudflare", &f["payload"]).unwrap());
    let v = view_of(&w, &card(&w.uni, &f));
    assert_eq!(v.rows[0].read_key.as_deref(), Some("Read key: all D1 data."));
    let (_, why) = approval_summary(&v, std::slice::from_ref(&v.rows[0].rid)).unwrap();
    assert!(why.contains("then read-only 3 h") && why.contains("Read key: all D1 data") && !why.contains('\n'), "{why}");
}

#[test]
fn routine_requests_may_skip_a_fresh_unlock_powerful_and_long_lived_never() {
    let w = world();
    let at = |f: &Value| view_of(&w, &card(&w.uni, f));
    let mint = |class: &str, child: Value| {
        let (mut g, _) = fields(&w, "cf-parent", class, 60, 1);
        g["action"] = json!("mint.cloudflare");
        g["payload"] = match child {
            Value::String(_) => json!({"template": "r2-read"}),
            t => json!({"template": "r2-read", "child_ttl_s": t}),
        };
        g["payload_digest"] = json!(payload_digest("mint.cloudflare", &g["payload"]).unwrap());
        g
    };
    let (routine, _) = fields(&w, "pages-deploy", "routine", 600, 1);
    let v = at(&routine);
    assert!(!v.rows[0].always_unlock && !needs_fresh_unlock(&v, &rid_of(&routine)), "a routine request");
    let (powerful, _) = fields(&w, "cloudflare-dns", "powerful", 600, 1);
    let v = at(&powerful);
    assert!(v.rows[0].always_unlock && needs_fresh_unlock(&v, &rid_of(&powerful)), "a powerful one: the hold");
    // a routine mint: short child yes; a day is the edge; permanent, longer, unstated or not a number: always
    for (child, always) in [
        (json!(3600), false),
        (json!(LONG_LIVED_CHILD_S), false),
        (json!(LONG_LIVED_CHILD_S + 1), true),
        (Value::Null, true),
        (json!("absent"), true),
        (json!(-1), true),
        (json!(0), true),
        (json!(true), true),
    ] {
        let g = mint("routine", child.clone());
        let v = at(&g);
        assert_eq!(v.refused, None, "{child}");
        assert_eq!((v.rows[0].always_unlock, needs_fresh_unlock(&v, &rid_of(&g))), (always, always), "child_ttl_s {child}");
    }
    // a stray child_ttl_s on any action counts too
    let (mut odd, _) = fields(&w, "pages-deploy", "routine", 600, 1);
    odd["payload"] = json!({"child_ttl_s": null});
    odd["payload_digest"] = json!(payload_digest("dns.edit", &odd["payload"]).unwrap());
    assert!(at(&odd).rows[0].always_unlock);
    // the morning card: only the rows chosen count; a request not on the card, nothing chosen or a refused card ask
    let rows = vec![fields(&w, "r2-a", "routine", 50_400, 200).0, mint("routine", Value::Null)];
    let m = view_of(&w, &morning(&w.uni, &rows));
    assert_eq!(m.refused, None);
    assert!(!needs_fresh_unlock(&m, &rid_of(&rows[0])));
    assert!(needs_fresh_unlock(&m, &[rid_of(&rows[0]), rid_of(&rows[1])].concat()), "a permanent mint among the chosen");
    assert!(needs_fresh_unlock(&m, &["9".repeat(32)]) && needs_fresh_unlock(&m, &[]));
    let refused = view_of(&w, &card(&Keys::generate(), &routine));
    assert!(needs_fresh_unlock(&refused, &rid_of(&routine)));
}

#[test]
fn answers_age_out_a_week_after_their_card_sent_or_not() {
    let dir = TempDir::new();
    let a = |rid: &str, sent: bool| Answer {
        card: "c".repeat(64),
        rid: rid.into(),
        request_digest: "d".repeat(64),
        rpk: "e".repeat(64),
        decision: Decision::Approve,
        at: NOW,
        until: None,
        expires: NOW + 900,
        wrap: (!sent).then(|| "{}".into()),
        sent,
    };
    let mut answers = Answers { answers: vec![a("sent", true), a("unsent", false)] };
    answers.save(dir.path(), NOW + 1000).unwrap();
    assert_eq!(Answers::load(dir.path()).unwrap().answers.len(), 2, "kept for replay checks after expiry");
    answers.save(dir.path(), NOW + 900 + 7 * 86_400).unwrap();
    assert!(Answers::load(dir.path()).unwrap().answers.is_empty(), "an unsent answer can never be taken: it goes too");
    // a card that says it never expires is kept, not wrapped round to "long ago" and forgotten
    let mut far = Answers { answers: vec![Answer { expires: u64::MAX, ..a("far", true) }] };
    far.save(dir.path(), NOW).unwrap();
    assert_eq!(Answers::load(dir.path()).unwrap().answers.len(), 1);
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1, "no temp file left behind");
    // an unreadable ledger is an error, never an empty one (that would forget what was answered)
    std::fs::write(dir.path().join(ANSWERS_FILE), "not json").unwrap();
    assert!(Answers::load(dir.path()).is_err());
}

#[test]
fn no_view_holds_the_data_key() {
    let w = world();
    // a data key of its own, so no other string in the view can contain it by chance
    let dek = Keys::generate().secret_key().to_secret_hex();
    let (mut f, _) = fields(&w, "cloudflare-dns", "powerful", 600, 1);
    f["box"] = boxed_with(&w.seal.public_key(), "cloudflare-dns", "powerful", &dek);
    let ev = card(&w.uni, &f);
    let v = view_of(&w, &ev);
    assert_eq!(v.refused, None);
    assert_eq!(v.rows[0].request_digest, request_digest(&f).unwrap());
    let json = serde_json::to_string(&v).unwrap();
    assert!(!json.contains(&dek) && !json.contains(&dek.to_uppercase()) && !json.contains("dek_box"), "{json}");
    assert!(!format!("{v:?}").contains(&dek));
    // refused: the reason and nothing else
    let v = view_of(&w, &card(&Keys::generate(), &f));
    assert_eq!((v.refused.as_deref(), v.rows.len()), (Some("Not signed by Uni."), 0));
    // expired and unanswered: expired; expired after an answer here: shown as answered
    let v = view(&ev, &w.trusted(), &w.seal, &Answers::default(), NOW + 900);
    assert_eq!(v.refused.as_deref(), Some("This card has expired."));
    let r = &check(&w, &ev).unwrap().rows[0];
    let answers = Answers {
        answers: vec![Answer {
            card: ev.id.to_hex(),
            rid: r.rid.clone(),
            request_digest: r.request_digest.clone(),
            rpk: r.rpk.to_hex(),
            decision: Decision::Deny,
            at: NOW + 10,
            until: None,
            expires: NOW + 900,
            wrap: None,
            sent: true,
        }],
    };
    let v = view(&ev, &w.trusted(), &w.seal, &answers, NOW + 5000);
    assert_eq!(v.refused, None);
    assert_eq!(v.rows[0].answer, Some(AnswerView { decision: Decision::Deny, at: NOW + 10, until: None, sent: true }));
    assert!(!serde_json::to_string(&v).unwrap().contains(&dek));
}

/// What `prepare_answer` hands out is on disk first: the ledger holds the answer and that exact wrap, unsent. A folder
/// that can't be written gives an error and no wrap at all.
#[test]
fn prepare_answer_writes_the_ledger_before_returning() {
    let w = world();
    let dir = TempDir::new();
    let (f, one_time) = fields(&w, "cloudflare-dns", "powerful", 600, 1);
    let ev = card(&w.uni, &f);
    let out = prepare_answer(&w.approval(), &w.trusted(), &ev, Decision::Approve, &rid_of(&f), dir.path(), NOW).unwrap();
    assert_eq!(out.len(), 1);
    let (card_id, rid) = (ev.id.to_hex(), f["rid"].as_str().unwrap().to_string());
    assert_eq!((out[0].card.as_str(), out[0].rid.as_str()), (card_id.as_str(), rid.as_str()));
    let kept = Answers::load(dir.path()).unwrap();
    let a = kept.for_card(&ev.id);
    assert_eq!(a.len(), 1);
    assert_eq!((a[0].decision, a[0].sent, a[0].until, a[0].at), (Decision::Approve, false, Some(NOW + 600), NOW));
    assert_eq!(a[0].wrap.as_deref(), Some(out[0].wrap.as_json().as_str()), "the wrap handed out is the one kept");
    // the ledger itself holds no data key (only the wrap's ciphertext)
    assert!(!std::fs::read_to_string(dir.path().join(ANSWERS_FILE)).unwrap().contains(DEK));
    // and the wrap is the answer: routed to the card's author, opened by the one-time key, sealed by the approval key
    assert_eq!(tags_of(&out[0].wrap)[0], vec!["p".to_string(), w.uni.public_key().to_hex()]);
    let (rumor, sealer) = open(&out[0].wrap, &one_time);
    assert_eq!((sealer, rumor["kind"].as_u64()), (w.me.public_key(), Some(KIND_APPROVAL_REPLY as u64)));

    // a folder not made yet is made on the first answer
    let fresh = dir.path().join("fresh");
    let (g, _) = fields(&w, "cloudflare-dns", "powerful", 600, 1);
    assert_eq!(prepare_answer(&w.approval(), &w.trusted(), &card(&w.uni, &g), Decision::Deny, &rid_of(&g), &fresh, NOW).unwrap().len(), 1);
    assert_eq!(Answers::load(&fresh).unwrap().answers.len(), 1);
    // a folder that can't be written can't keep the answer: an error, and nothing to send
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let locked = dir.path().join("read-only");
        std::fs::create_dir(&locked).unwrap();
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o555)).unwrap();
        // root writes anyway: then there is no unwritable folder to try
        let root = std::fs::write(locked.join("probe"), "").is_ok();
        let _ = std::fs::remove_file(locked.join("probe"));
        let (g, _) = fields(&w, "cloudflare-dns", "powerful", 600, 1);
        let got = prepare_answer(&w.approval(), &w.trusted(), &card(&w.uni, &g), Decision::Approve, &rid_of(&g), &locked, NOW);
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755)).unwrap();
        if !root {
            let err = got.unwrap_err();
            assert!(err.to_string().starts_with("couldn't keep the answer, so nothing was sent"), "{err}");
            assert_eq!(std::fs::read_dir(&locked).unwrap().count(), 0);
        }
    }
    // a file where the folder should be: the ledger can't even be read, so nothing is sealed
    let blocked = dir.path().join("a-file");
    std::fs::write(&blocked, "").unwrap();
    let (g, _) = fields(&w, "cloudflare-dns", "powerful", 600, 1);
    assert!(prepare_answer(&w.approval(), &w.trusted(), &card(&w.uni, &g), Decision::Approve, &rid_of(&g), &blocked, NOW).is_err());
}

/// A retry returns the same wrap while it is young, a fresh one of the same decision after 10 minutes (kept on disk
/// first), and nothing once the relay took it. The other decision, or a request not on the card, is refused.
#[test]
fn a_retry_sends_the_same_decision_and_a_second_answer_is_refused() {
    let w = world();
    let dir = TempDir::new();
    let rows: Vec<Value> = ["r2-a", "r2-b"].iter().map(|n| fields(&w, n, "routine", 600, 1).0).collect();
    let ev = morning(&w.uni, &rows);
    let both = [rid_of(&rows[0]), rid_of(&rows[1])].concat();
    let p = |d: Decision, rids: &[String], now: u64| prepare_answer(&w.approval(), &w.trusted(), &ev, d, rids, dir.path(), now);
    assert!(p(Decision::Approve, &[], NOW).is_err(), "nothing chosen");
    assert!(p(Decision::Approve, &["9".repeat(32)], NOW).is_err(), "not on the card");
    assert!(p(Decision::Approve, &[rid_of(&rows[0]), rid_of(&rows[0])].concat(), NOW).is_err(), "named twice");
    let first = p(Decision::Approve, &both, NOW).unwrap();
    assert_eq!(first.len(), 2);
    // young: its age counts from the wrap's own (jittered, up to 10 minutes back) time, as the relay sees it
    let youngest = first.iter().map(|x| x.wrap.created_at.as_secs()).min().unwrap() + RESEND_SAME_WRAP_SECS;
    let again = p(Decision::Approve, &both, youngest).unwrap();
    assert_eq!(again.iter().map(|x| x.wrap.id).collect::<Vec<_>>(), first.iter().map(|x| x.wrap.id).collect::<Vec<_>>());
    assert_eq!(p(Decision::Deny, &both, NOW + 10).unwrap_err().to_string(), "this card was already answered");
    // the relay took the first; the second is retried later as a fresh wrap, kept before it is handed out
    mark_sent(dir.path(), &first[0].card, &first[0].rid).unwrap();
    mark_sent(dir.path(), &first[0].card, &first[0].rid).unwrap();
    let late = p(Decision::Approve, &both, NOW + 700).unwrap();
    assert_eq!(late.len(), 1);
    assert_eq!(late[0].rid, first[1].rid);
    assert_ne!(late[0].wrap.id, first[1].wrap.id, "older than 10 minutes: wrapped afresh");
    assert!(NOW + 700 - late[0].wrap.created_at.as_secs() <= RESEND_SAME_WRAP_SECS);
    let kept = Answers::load(dir.path()).unwrap();
    assert_eq!(kept.answers.iter().find(|a| a.rid == late[0].rid).unwrap().wrap.as_deref(), Some(late[0].wrap.as_json().as_str()));
    assert_eq!(kept.answers.iter().find(|a| a.rid == first[0].rid).map(|a| (a.sent, a.wrap.clone())), Some((true, None)));
    mark_sent(dir.path(), &late[0].card, &late[0].rid).unwrap();
    assert!(p(Decision::Approve, &both, NOW + 710).unwrap().is_empty(), "all sent: nothing more goes out");
    assert!(mark_sent(dir.path(), &first[0].card, &"9".repeat(32)).is_err(), "an answer not in the record");
}

#[test]
fn a_deny_carries_no_data_key() {
    let w = world();
    let dir = TempDir::new();
    let (f, one_time) = fields(&w, "cloudflare-dns", "powerful", 600, 1);
    let ev = card(&w.uni, &f);
    let out = prepare_answer(&w.approval(), &w.trusted(), &ev, Decision::Deny, &rid_of(&f), dir.path(), NOW).unwrap();
    let (rumor, _) = open(&out[0].wrap, &one_time);
    let content = rumor["content"].as_str().unwrap();
    assert!(!content.contains(DEK) && !content.contains("dek"), "{content}");
    let body: Value = serde_json::from_str(content).unwrap();
    assert_eq!(body, json!({"v": 1, "rid": f["rid"], "request_digest": request_digest(&f).unwrap(), "decision": "deny"}));
    assert_eq!(Answers::load(dir.path()).unwrap().answers[0].until, None);
}

/// The wrap goes to whichever trusted key signed the card, not to the first key the grant names.
#[test]
fn the_answer_routes_to_the_cards_author() {
    let w = world();
    let dir = TempDir::new();
    let hermes = Keys::generate();
    let trusted = [w.uni.public_key(), hermes.public_key()];
    let (f, _) = fields(&w, "cloudflare-dns", "powerful", 600, 1);
    let out = prepare_answer(&w.approval(), &trusted, &card(&hermes, &f), Decision::Deny, &rid_of(&f), dir.path(), NOW).unwrap();
    assert_eq!(tags_of(&out[0].wrap)[0], vec!["p".to_string(), hermes.public_key().to_hex()]);
}

/// Uni's own verifier (uni-ops `sealed/`, never copied here) opens the answer the way its broker's `on_wrap` and `_reply`
/// do. Run it locally with `UNI_VERIFY_HARNESS=/path/to/verify.py cargo test approvals -- --ignored`; the script is
/// outside this repo and imports the verifier from its own path.
#[test]
#[ignore = "needs Uni's verifier: set UNI_VERIFY_HARNESS to the local harness script"]
fn unis_verifier_accepts_the_answer() {
    let harness = std::env::var("UNI_VERIFY_HARNESS").expect("UNI_VERIFY_HARNESS must point at the harness script");
    let w = world();
    let dir = TempDir::new();
    let now = nostr::Timestamp::now().as_secs();
    // a card as the broker writes one (sealed.py `_fields`, `request`): a 32-hex rid, the box sealed to the derived
    // sealing key with a fresh data key, the card signed by Uni with an `h` tag
    let make = || {
        let one_time = Keys::generate();
        let dek = Keys::generate().secret_key().to_secret_hex();
        let payload = json!({"v": 1, "zone": "example.org", "name": "demo", "note": "é <b> \u{2028}"});
        let f = json!({
            "v": 1, "rid": &Keys::generate().public_key().to_hex()[..32], "action": "dns.edit", "credential": "cloudflare-dns",
            "class": "powerful", "scope": "Add an A record for demo.example.org", "ttl_s": 600, "uses": 1,
            "payload": payload, "payload_digest": payload_digest("dns.edit", &payload).unwrap(), "expires": now + 900,
            "rpk": one_time.public_key().to_hex(),
            "box": boxed_with(&w.seal.public_key(), "cloudflare-dns", "powerful", &dek),
        });
        let ev = signed(&w.uni, 9, format!("🔑 **Uni asks to use cloudflare-dns** (powerful)\nFor: dns.edit.\n\n```{CARD_FENCE}\n{}\n```", serde_json::to_string_pretty(&f).unwrap()));
        (f, ev, one_time, dek)
    };
    let run = |ev: &Event, wrap: &Event, one_time: &Keys, owner: &PublicKey, decision: &str, dek: Option<&str>| {
        let input = json!({
            "card": serde_json::from_str::<Value>(&ev.as_json()).unwrap(),
            "wrap": serde_json::from_str::<Value>(&wrap.as_json()).unwrap(),
            "one_time_sk": one_time.secret_key().to_secret_hex(),
            "owner": owner.to_hex(),
            "decision": decision,
            "dek": dek,
        });
        let file = dir.path().join(format!("case-{decision}-{}.json", &wrap.id.to_hex()[..8]));
        std::fs::write(&file, input.to_string()).unwrap();
        let out = std::process::Command::new(&harness).arg(&file).output().expect("the harness runs");
        let said = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
        (out.status.success(), said)
    };
    for decision in [Decision::Approve, Decision::Deny] {
        let (f, ev, one_time, dek) = make();
        let out = prepare_answer(&w.approval(), &w.trusted(), &ev, decision, &rid_of(&f), dir.path(), now).unwrap();
        let (word, dek) = match decision {
            Decision::Approve => ("approve", Some(dek.as_str())),
            Decision::Deny => ("deny", None),
        };
        let (ok, said) = run(&ev, &out[0].wrap, &one_time, &w.me.public_key(), word, dek);
        assert!(ok, "Uni's verifier refused the {word}: {said}");
        eprintln!("{word}: {said}");
    }
    // the control: an answer sealed by another key is refused by the verifier (so a pass above means something)
    let (f, ev, one_time, dek) = make();
    let stranger = approval_role(Keys::generate());
    let stranger_trusts = seal_key(&stranger).unwrap();
    let mut g = f.clone();
    g["box"] = boxed_with(&stranger_trusts.public_key(), "cloudflare-dns", "powerful", &dek);
    let ev2 = signed(&w.uni, 9, ev.content.replace(&serde_json::to_string_pretty(&f).unwrap(), &serde_json::to_string_pretty(&g).unwrap()));
    let out = prepare_answer(&stranger, &w.trusted(), &ev2, Decision::Approve, &rid_of(&g), dir.path(), now).unwrap();
    let (ok, said) = run(&ev2, &out[0].wrap, &one_time, &w.me.public_key(), "approve", Some(&dek));
    assert!(!ok && said.contains("not signed by Aaron"), "the verifier took an answer sealed by another key: {said}");
}
