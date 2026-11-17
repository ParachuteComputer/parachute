//! Uni's secret requests (the Uni app's `secret.rs`, T-176), answered with a sealed reply.
//!
//! Uni asks with a kind-9 message whose body ends in a fenced ```` ```uni-secret-request ```` JSON block. The shell
//! answers with a NIP-59 gift wrap (kind 1059, `p` = the requester so the relay routes and p-gates it), never a chat
//! message. Both NIP-44 layers are encrypted to the request's one-time key `rpk`, not the requester's long-term key, so a
//! later leak of Uni's key doesn't open wraps still on the relay once Uni has dropped the one-time key. The seal (kind 13)
//! is signed by the approval key, which is how Uni knows who sent the value.

use nostr::{Event, EventId, Kind, PublicKey};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use super::card::{is_hex, valid_name};
use super::wrap::{json_zeroizing, tag, wrap};
use super::{invalid, ApprovalKeys, Result};

/// Fence language of the machine block in a request message.
pub const REQUEST_FENCE: &str = "uni-secret-request";
/// Rumor kind carrying a secret value (inside the gift wrap only).
pub const KIND_SECRET_DELIVERY: u16 = 46040;
/// Rumor kind asking Uni to forget a stored secret.
pub const KIND_SECRET_FORGET: u16 = 46041;
/// NIP-40 expiration on the wrap: the relay may drop the ciphertext after a day.
pub const WRAP_LIFETIME_SECS: u64 = 86_400;
/// Longest value the shell will seal (NIP-44 allows 65535 bytes of plaintext; leave room for the JSON around it).
pub const MAX_VALUE_BYTES: usize = 16 * 1024;

/// The JSON block of a request, as Uni wrote it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SecretRequest {
    pub v: u8,
    /// Request id, 32 hex chars; the delivery must echo it.
    pub rid: String,
    /// File name under Uni's secret directory (`[a-z0-9][a-z0-9._-]{0,63}`).
    pub name: String,
    pub label: String,
    pub purpose: String,
    /// Where Uni says it will keep the value (shown to the person, not trusted).
    pub store: String,
    pub keep_days: u32,
    /// Unix seconds after which the request is no longer answered.
    pub expires: u64,
    /// One-time x-only pubkey (hex) both NIP-44 layers are encrypted to.
    pub rpk: String,
}

/// A request from a signed event, with who asked.
#[derive(Debug, Clone)]
pub struct Asked {
    pub request: SecretRequest,
    pub requester: PublicKey,
    pub event_id: EventId,
    pub one_time_key: PublicKey,
}

/// The request block in `body`, if the message carries a well-formed one. The last fenced block wins; anything
/// malformed is `None` (shown as text).
pub fn parse_request(body: &str) -> Option<SecretRequest> {
    let open = format!("```{REQUEST_FENCE}\n");
    let start = body.rfind(&open)? + open.len();
    let end = start + body[start..].find("\n```")?;
    let req: SecretRequest = serde_json::from_str(body[start..end].trim()).ok()?;
    let ok = req.v == 1
        && is_hex(&req.rid, 32)
        && valid_name(&req.name, false)
        && is_hex(&req.rpk, 64)
        && !req.label.trim().is_empty()
        && req.label.chars().count() <= 80
        && req.purpose.chars().count() <= 280
        && req.store.chars().count() <= 200
        && (1..=365).contains(&req.keep_days);
    ok.then_some(req)
}

/// The request in a signed kind-9 event, from its own id and signature. The requester is the key that signed it, never
/// something the applet or a relay says. Edits are not applied: a request is answered exactly as it was signed.
pub fn verified_request(ev: &Event) -> Result<Asked> {
    ev.verify().map_err(|_| invalid("the request's signature does not verify; it can't be answered"))?;
    if ev.kind != Kind::Custom(9) {
        return Err(invalid("message is not a secret request"));
    }
    let request = parse_request(&ev.content).ok_or_else(|| invalid("message is not a secret request"))?;
    let one_time_key = PublicKey::from_hex(&request.rpk)
        .ok()
        .filter(|k| k.xonly().is_ok())
        .ok_or_else(|| invalid("the request's key isn't a public key"))?;
    Ok(Asked { request, requester: ev.pubkey, event_id: ev.id, one_time_key })
}

/// Refuse a request from a key the grant doesn't trust (`approvals.from`), or one past its window.
pub fn check_answerable(asked: &Asked, pinned: &[PublicKey], now: u64) -> Result<()> {
    if !pinned.contains(&asked.requester) {
        return Err(invalid("this requester is not trusted for secrets"));
    }
    if now > asked.request.expires {
        return Err(invalid("this request has expired; ask Uni for a new one"));
    }
    Ok(())
}

/// `{"value","v":1,"rid","name"}`, without copying `value` into a `serde_json::Value`. The value comes first so the
/// event's serialized tail, the last bytes a hash engine holds, is the 32-hex request id and the name, never the value.
fn delivery_json(rid: &str, name: &str, value: &str) -> Result<Zeroizing<String>> {
    #[derive(Serialize)]
    struct Delivery<'a> {
        value: &'a str,
        v: u8,
        rid: &'a str,
        name: &'a str,
    }
    json_zeroizing(&Delivery { value, v: 1, rid, name }, 64 + 6 * (rid.len() + name.len() + value.len()))
}

/// The gift wrap carrying `value` in answer to `asked`, sealed by the approval key. The caller checks
/// [`check_answerable`] first.
pub fn seal_delivery(sender: &ApprovalKeys, asked: &Asked, value: &str, now: u64) -> Result<Event> {
    if value.is_empty() {
        return Err(invalid("nothing to send"));
    }
    if value.len() > MAX_VALUE_BYTES {
        return Err(invalid("value is too long"));
    }
    let r = &asked.request;
    let body = delivery_json(&r.rid, &r.name, value)?;
    let tags = vec![tag(&["e", &asked.event_id.to_hex()])?, tag(&["p", &asked.requester.to_hex()])?];
    wrap(sender, &asked.requester, &asked.one_time_key, KIND_SECRET_DELIVERY, &body, tags, now, now + WRAP_LIFETIME_SECS)
}

/// The gift wrap asking the requester to forget what it stored for `asked`. It names the request as well as the secret,
/// so an old card can't delete a newer secret stored under the same name. It holds no secret, so it is encrypted to the
/// requester's long-term key.
pub fn seal_forget(sender: &ApprovalKeys, asked: &Asked, now: u64) -> Result<Event> {
    let (requester, r) = (&asked.requester, &asked.request);
    let body = serde_json::json!({ "v": 1, "name": r.name, "rid": r.rid }).to_string();
    let tags = vec![tag(&["p", &requester.to_hex()])?];
    wrap(sender, requester, requester, KIND_SECRET_FORGET, &body, tags, now, now + WRAP_LIFETIME_SECS)
}

#[cfg(test)]
mod tests {
    use super::super::approval_role;
    use super::super::wrap::rumor_id;
    use super::*;
    use nostr::nips::nip44;
    use nostr::{EventBuilder, JsonUtil, Keys, Timestamp, UnsignedEvent};

    const ROOM: &str = "6a0c3f1e-1111-4222-8333-944455556666";
    const RID: &str = "0123456789abcdef0123456789abcdef";

    fn request_body(rpk: &str, expires: u64) -> String {
        format!(
            "🔐 Uni is asking for a secret\n\n```{REQUEST_FENCE}\n{}\n```",
            serde_json::json!({
                "v": 1, "rid": RID, "name": "tailscale-api",
                "label": "Tailscale API token", "purpose": "list devices", "store": "~/.config/uni/tailscale-api",
                "keep_days": 30, "expires": expires, "rpk": rpk,
            })
        )
    }

    fn request_event(author: &Keys, rpk: &str, expires: u64) -> Event {
        EventBuilder::new(Kind::Custom(9), request_body(rpk, expires))
            .tags([tag(&["h", ROOM]).unwrap()])
            .sign_with_keys(author)
            .unwrap()
    }

    /// `ev` with `change` applied, keeping its id and signature (what a lying relay serves).
    fn tampered(ev: &Event, change: impl FnOnce(&mut serde_json::Value)) -> Event {
        let mut v: serde_json::Value = serde_json::from_str(&ev.as_json()).unwrap();
        change(&mut v);
        Event::from_json(v.to_string()).unwrap()
    }

    #[test]
    fn delivery_json_is_the_documented_shape_and_never_reallocates() {
        let value = "t176-\"dummy\"\n\u{1}é";
        let body = delivery_json(RID, "tok", value).unwrap();
        let v: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(v, serde_json::json!({"v": 1, "rid": RID, "name": "tok", "value": value}));
        assert!(body.capacity() >= body.len() && body.capacity() <= 64 + 6 * (32 + 3 + value.len()));
        // the worst case (every byte a control character) still fits: the buffer never grew
        let worst = "\u{1}".repeat(1000);
        let cap = 64 + 6 * (32 + 3 + worst.len());
        assert_eq!(delivery_json(RID, "tok", &worst).unwrap().capacity(), cap);
    }

    #[test]
    fn rumor_id_is_nostrs_id_and_the_value_is_not_in_the_hashed_tail() {
        let sender = Keys::generate();
        for value in ["t176-dummy", "t176-\"dummy\"\n\u{1}é\u{2028}🔐", "x"] {
            let body = delivery_json(RID, "a", value).unwrap();
            let tags = [tag(&["e", &"ab".repeat(32)]).unwrap()];
            let at = Timestamp::from_secs(1_760_000_000);
            let rumor = UnsignedEvent::new(sender.public_key(), at, Kind::Custom(KIND_SECRET_DELIVERY), tags.clone(), body.as_str());
            assert_eq!(rumor.id, None, "UnsignedEvent::new must not hash the content itself");
            let nostrs = EventBuilder::new(Kind::Custom(KIND_SECRET_DELIVERY), body.as_str()).tags(tags).custom_created_at(at);
            assert_eq!(Some(rumor_id(&rumor).unwrap()), nostrs.build(sender.public_key()).id, "{value:?}");
            // the engine's last block holds at most the final 64 bytes of the serialized event
            let event = serde_json::json!([0, rumor.pubkey, rumor.created_at, rumor.kind, rumor.tags, rumor.content]).to_string();
            let escaped = serde_json::to_string(&serde_json::to_string(value).unwrap()).unwrap();
            let at = event.find(&escaped[3..escaped.len() - 3]).unwrap();
            assert!(event.len() - (at + escaped.len() - 6) >= 64, "{value:?}");
        }
    }

    #[test]
    fn parses_only_well_formed_requests() {
        let rpk = Keys::generate().public_key().to_hex();
        assert_eq!(parse_request(&request_body(&rpk, 10)).unwrap().name, "tailscale-api");
        assert!(parse_request("no fence here").is_none());
        // a path in the name, a short rid, an unknown version: all shown as plain text
        for (from, to) in [("\"tailscale-api\"", "\"../etc/passwd\""), (RID, "0123"), ("\"v\":1", "\"v\":2")] {
            assert!(parse_request(&request_body(&rpk, 10).replace(from, to)).is_none(), "{to}");
        }
    }

    #[test]
    fn delivery_opens_only_with_the_one_time_key_and_names_the_sender() {
        let uni = Keys::generate();
        let one_time = Keys::generate();
        let owner = Keys::generate();
        let now = Timestamp::now().as_secs();
        let asked = verified_request(&request_event(&uni, &one_time.public_key().to_hex(), now + 600)).unwrap();
        check_answerable(&asked, &[uni.public_key()], now).unwrap();
        let value = "t176-dummy-unit";
        let ev = seal_delivery(&approval_role(owner.clone()), &asked, value, now).unwrap();

        assert_eq!(ev.kind, Kind::GiftWrap);
        assert_ne!(ev.pubkey, owner.public_key(), "wrap is signed by a throwaway key");
        assert!(ev.verify().is_ok());
        assert!(now - ev.created_at.as_secs() <= 600, "inside Buzz's 15-minute window");
        let tags: Vec<Vec<String>> = ev.tags.iter().map(|t| t.as_slice().to_vec()).collect();
        assert_eq!(tags, vec![vec!["p".to_string(), uni.public_key().to_hex()], vec!["expiration".into(), (now + WRAP_LIFETIME_SECS).to_string()]]);
        assert!(!ev.as_json().contains(value));
        assert!(!ev.as_json().contains("tailscale"), "the name is inside the wrap too");
        // Uni's long-term key cannot open it; the one-time key can.
        assert!(nip44::decrypt(uni.secret_key(), &ev.pubkey, &ev.content).is_err());
        let seal = Event::from_json(nip44::decrypt(one_time.secret_key(), &ev.pubkey, &ev.content).unwrap()).unwrap();
        assert_eq!(seal.kind, Kind::Seal);
        assert_eq!(seal.pubkey, owner.public_key());
        seal.verify().unwrap();
        let rumor: serde_json::Value =
            serde_json::from_str(&nip44::decrypt(one_time.secret_key(), &seal.pubkey, &seal.content).unwrap()).unwrap();
        assert_eq!(rumor["kind"], KIND_SECRET_DELIVERY);
        assert_eq!(rumor["pubkey"], owner.public_key().to_hex());
        assert_eq!(rumor["tags"], serde_json::json!([["e", asked.event_id.to_hex()], ["p", uni.public_key().to_hex()]]));
        let inner: serde_json::Value = serde_json::from_str(rumor["content"].as_str().unwrap()).unwrap();
        assert_eq!(inner["value"], value);
        assert_eq!(inner["rid"], RID);
        // empty and too long are refused before anything is sealed
        assert!(seal_delivery(&approval_role(owner.clone()), &asked, "", now).is_err());
        assert!(seal_delivery(&approval_role(owner), &asked, &"x".repeat(MAX_VALUE_BYTES + 1), now).is_err());
    }

    #[test]
    fn forget_goes_to_the_requesters_own_key_and_names_the_request() {
        let uni = Keys::generate();
        let owner = Keys::generate();
        let asked = verified_request(&request_event(&uni, &Keys::generate().public_key().to_hex(), u64::MAX)).unwrap();
        let ev = seal_forget(&approval_role(owner.clone()), &asked, 1_760_000_000).unwrap();
        let seal = Event::from_json(nip44::decrypt(uni.secret_key(), &ev.pubkey, &ev.content).unwrap()).unwrap();
        assert_eq!(seal.pubkey, owner.public_key());
        let rumor: serde_json::Value =
            serde_json::from_str(&nip44::decrypt(uni.secret_key(), &seal.pubkey, &seal.content).unwrap()).unwrap();
        assert_eq!(rumor["kind"], KIND_SECRET_FORGET);
        let body: serde_json::Value = serde_json::from_str(rumor["content"].as_str().unwrap()).unwrap();
        assert_eq!(body, serde_json::json!({"v": 1, "name": "tailscale-api", "rid": RID}));
    }

    #[test]
    fn unpinned_or_expired_requests_are_refused() {
        let uni = Keys::generate();
        let impostor = Keys::generate();
        let rpk = Keys::generate().public_key().to_hex();
        let asked = verified_request(&request_event(&impostor, &rpk, 100)).unwrap();
        assert!(check_answerable(&asked, &[uni.public_key()], 50).is_err());
        assert!(check_answerable(&asked, &[], 50).is_err(), "nobody trusted");
        let asked = verified_request(&request_event(&uni, &rpk, 100)).unwrap();
        assert!(check_answerable(&asked, &[uni.public_key()], 101).is_err());
        assert!(check_answerable(&asked, &[uni.public_key()], 100).is_ok());
        assert!(check_answerable(&asked, &[impostor.public_key(), uni.public_key()], 100).is_ok(), "one of the grant's keys");
    }

    /// A relay that claims Uni wrote a request carrying the relay's own one-time key.
    #[test]
    fn a_forged_author_or_a_swapped_key_is_not_a_request() {
        let uni = Keys::generate();
        let attacker = Keys::generate();
        let attacker_rpk = Keys::generate().public_key().to_hex();
        let genuine = request_event(&uni, &Keys::generate().public_key().to_hex(), u64::MAX);
        let attackers = request_event(&attacker, &attacker_rpk, u64::MAX);
        let uni_hex = uni.public_key().to_hex();
        let genuine_rpk = parse_request(&genuine.content).unwrap().rpk;
        let forgeries = [
            // the attacker's own request, relabelled as Uni's
            tampered(&attackers, |v| v["pubkey"] = uni_hex.clone().into()),
            // Uni's real request with the attacker's one-time key swapped in
            tampered(&genuine, |v| {
                let c = v["content"].as_str().unwrap().replace(&genuine_rpk, &attacker_rpk);
                v["content"] = c.into();
            }),
            // the same, with the id recomputed to match (the signature still can't)
            {
                let mut ev = attackers.clone();
                ev.pubkey = uni.public_key();
                ev.id = EventId::new(&ev.pubkey, &ev.created_at, &ev.kind, &ev.tags, &ev.content);
                ev
            },
        ];
        for (i, ev) in forgeries.iter().enumerate() {
            assert!(verified_request(ev).is_err(), "forgery {i} was accepted");
        }
        // a kind 1 with the same block isn't a request
        let k1 = EventBuilder::new(Kind::TextNote, request_body(&genuine_rpk, u64::MAX)).sign_with_keys(&uni).unwrap();
        assert!(verified_request(&k1).is_err());
    }
}
