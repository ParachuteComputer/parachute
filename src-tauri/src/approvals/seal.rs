//! The sealing key and the enrollment event (Uni app `sealed.rs`; uni-ops CARD.md §1).
//!
//! The sealing key is derived from the approval key, HKDF-SHA256 with one expand block:
//! `prk = HMAC-SHA256(key = "uni-sealed/v1", msg = sk)`, then
//! `seal_sk = HMAC-SHA256(prk, "uni-sealed-credentials/v1 seal key" || counter)` for counter 1, 2, … 255 until the result
//! is a valid secp256k1 scalar (`0 < k < n`). It is a different key from the approval key, so nothing sealed to it can
//! make the shell open one of the account's DMs. It never leaves this module: no view, record or event carries it, only
//! its public half. With the approval key the everyday key (the default), it is the key the Uni app already enrolled.
//!
//! **Enrollment** tells Uni that public half: a kind-9 room message signed by the approval key, tags
//! `["h", room]`, `["p", <own pubkey>]`, `["t","uni-sealed-enroll"]` (the shape of buzz-sdk's `build_message` with the
//! author mentioned, as the Uni app sends it), content `{"v":1,"seal_pub":"<hex>","for":"<Uni's pubkey hex>"}`. No `p`
//! tag for Uni: that would be a mention and wake Uni as if spoken to.

use nostr::hashes::hmac::{Hmac, HmacEngine};
use nostr::hashes::{sha256, Hash, HashEngine};
use nostr::{Event, EventBuilder, Keys, Kind, PublicKey, SecretKey, Timestamp};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use super::wrap::tag;
use super::{invalid, ApprovalKeys, Result};

/// HKDF salt (the HMAC key of the extract step).
pub const SEAL_SALT: &[u8] = b"uni-sealed/v1";
/// HKDF info of the one expand block; the counter byte follows it.
pub const SEAL_INFO: &[u8] = b"uni-sealed-credentials/v1 seal key";
/// `t` tag value marking an enrollment message.
pub const ENROLL_TAG: &str = "uni-sealed-enroll";

fn hmac_sha256(key: &[u8], parts: &[&[u8]]) -> Zeroizing<[u8; 32]> {
    let mut engine = HmacEngine::<sha256::Hash>::new(key);
    for p in parts {
        engine.input(p);
    }
    Zeroizing::new(Hmac::<sha256::Hash>::from_engine(engine).to_byte_array())
}

/// This device's sealing key. No `Clone` or `Serialize`, and `Debug` shows the public half: only that leaves here.
pub struct SealKey(Keys);

impl SealKey {
    /// The public half (x-only, as in every Nostr key): what enrollment publishes and Uni seals boxes to.
    pub fn public_key(&self) -> PublicKey {
        self.0.public_key()
    }

    /// Open a NIP-44 box sealed to this key by `epk` (a credential's data key, CARD.md §3.5). The plaintext is zeroed
    /// when dropped.
    pub(in crate::approvals) fn open_box(&self, epk: &PublicKey, payload: &str) -> Result<Zeroizing<String>> {
        nostr::nips::nip44::decrypt(self.0.secret_key(), epk, payload)
            .map(Zeroizing::new)
            .map_err(|_| invalid("the box isn't sealed to this key"))
    }

    #[cfg(test)]
    pub(in crate::approvals) fn secret_hex(&self) -> String {
        self.0.secret_key().to_secret_hex()
    }
}

impl std::fmt::Debug for SealKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "SealKey({})", self.public_key().to_hex())
    }
}

/// The first counter (1 to 255) whose candidate is a valid secp256k1 scalar, as the reference loop does.
fn first_valid_scalar(mut candidate: impl FnMut(u8) -> Zeroizing<[u8; 32]>) -> Result<SecretKey> {
    for counter in 1..=255u8 {
        if let Ok(sk) = SecretKey::from_slice(&*candidate(counter)) {
            return Ok(sk);
        }
    }
    Err(invalid("could not derive a sealing key"))
}

/// The sealing key of `approval` (module docs), what [`check_card`](super::check_card) and [`view`](super::view) open
/// boxes with. Deterministic: the same key always gives the same sealing key. Fails only if 255 HMAC outputs in a row
/// are not scalars, which doesn't happen, but is an error rather than a panic.
pub fn seal_key(approval: &ApprovalKeys) -> Result<SealKey> {
    derive(approval.keys())
}

fn derive(key: &Keys) -> Result<SealKey> {
    let prk = hmac_sha256(SEAL_SALT, &[key.secret_key().as_secret_bytes()]);
    let sk = first_valid_scalar(|counter| hmac_sha256(&*prk, &[SEAL_INFO, &[counter]]))?;
    Ok(SealKey(Keys::new(sk)))
}

/// The public half of `approval`'s sealing key: what Uni and Hermes are given (with the approval key's npub) to seal
/// credentials to this device.
pub fn seal_pub(approval: &ApprovalKeys) -> Result<PublicKey> {
    Ok(seal_key(approval)?.public_key())
}

/// The enrollment content, exactly these three fields.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Enrollment {
    pub v: u8,
    pub seal_pub: String,
    #[serde(rename = "for")]
    pub for_uni: String,
}

fn has_tag(ev: &Event, name: &str, value: &str) -> bool {
    ev.tags.iter().any(|t| {
        let s = t.as_slice();
        s.len() >= 2 && s[0] == name && s[1] == value
    })
}

/// A room id as buzz-sdk writes it (`Uuid::to_string`: hyphenated, lowercase).
fn room_id(room: &str) -> Result<String> {
    let r = room.to_ascii_lowercase();
    let ok = r.len() == 36
        && r.bytes().enumerate().all(|(i, c)| if [8, 13, 18, 23].contains(&i) { c == b'-' } else { c.is_ascii_hexdigit() });
    ok.then_some(r).ok_or_else(|| invalid("that isn't a room id"))
}

/// The enrollment event: the approval key says "this is my sealing key, for this Uni", in room `room` (a UUID). The
/// shape of an ordinary room message (`h`, our own `p`), plus the `t` tag; signed at `now`, and checked the way Uni's
/// broker checks it before it is returned.
pub fn enrollment_event(approval: &ApprovalKeys, uni: &PublicKey, room: &str, now: u64) -> Result<Event> {
    let keys = approval.keys();
    let seal = derive(keys)?;
    let body = Enrollment { v: 1, seal_pub: seal.public_key().to_hex(), for_uni: uni.to_hex() };
    let content = serde_json::to_string(&body).map_err(|e| invalid(e.to_string()))?;
    let event = EventBuilder::new(Kind::Custom(9), content)
        .tags([tag(&["h", &room_id(room)?])?, tag(&["p", &keys.public_key().to_hex()])?, tag(&["t", ENROLL_TAG])?])
        // buzz-sdk's `build_message` keeps the author's own `p` (nostr drops it otherwise)
        .allow_self_tagging()
        .custom_created_at(Timestamp::from_secs(now))
        .sign_with_keys(keys)
        .map_err(|e| invalid(format!("cannot sign enrollment: {e}")))?;
    verify_enrollment(&event, &keys.public_key(), uni)?;
    Ok(event)
}

/// What Uni's broker checks (uni-ops `sealed enroll`): a valid signature from `signer`, kind 9, the `t` tag, exactly the
/// three fields with `v == 1`, `seal_pub` a public key and `for` this `uni`. Returns the content.
pub fn verify_enrollment(ev: &Event, signer: &PublicKey, uni: &PublicKey) -> Result<Enrollment> {
    ev.verify().map_err(|_| invalid("the enrollment's signature does not verify"))?;
    if ev.kind != Kind::Custom(9) || !has_tag(ev, "t", ENROLL_TAG) {
        return Err(invalid("not an enrollment"));
    }
    if &ev.pubkey != signer {
        return Err(invalid("the enrollment isn't signed by this key"));
    }
    let body: Enrollment = serde_json::from_str(&ev.content).map_err(|_| invalid("the enrollment's fields don't parse"))?;
    let canonical = |s: &str| PublicKey::from_hex(s).ok().filter(|k| k.to_hex() == s);
    if body.v != 1 || canonical(&body.seal_pub).is_none() {
        return Err(invalid("the enrollment's fields are incomplete"));
    }
    if canonical(&body.for_uni).as_ref() != Some(uni) {
        return Err(invalid("the enrollment is for a different Uni key"));
    }
    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::super::approval_role;
    use super::*;

    /// Computed by the reference, uni-ops `sealed/app_sim.py` `derive_seal_key`, from these synthetic keys (1, 0x01 × 32,
    /// n − 1, and two SHA-256 outputs). The same vectors the Uni app pins.
    const VECTORS: [(&str, &str, &str); 5] = [
        ("0000000000000000000000000000000000000000000000000000000000000001",
         "a3ce4196826da37a6946c61a9c7d76d1f2b32520fcb6c0cc01f7887718c71ecb",
         "f40cb93cae50bd135f3ed10bf7acc4bf66e98cc81ff0a63ea80e3eed20108813"),
        ("0101010101010101010101010101010101010101010101010101010101010101",
         "27a333758dcde85d75253566142e71caffebb5acff41f532860d005760fb825d",
         "a5ce04ac8002c2bc5e10029636248b808b7c7fbdb03b41b47ab74f594f28b655"),
        ("fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364140",
         "3aa83c5a5e807ad9303756ca3c25dc21b588f8afcfcbc2841039ca55cfaa2f40",
         "454b677fb44e67c6f56b5edd1da8837949216683e5d223b4e3f302ded9e530c7"),
        ("b5dba0d8854745918e99a966613c9e12ed6909d69cad4e96872b553c64637035",
         "d57de1556e398401ae993565d4a582ef93e6438d8e5652038a2c9dc67172f41b",
         "0ab98b29acd8983d6163749228e12380344f9e91f139f7673ecba8f5b8930d8f"),
        ("525b35baa0d1e74e9a7c3332421a91f4f00831d8bc31d5e34ec2d14b39911dc1",
         "92c81df8599c4068a8f6e45ccfa54d5ff50523d53e5c24de3f2bfe32b0a5681c",
         "5885971b9f86968c14473ef962789a83c49f8b2d1fd8c5da315623315d69aea9"),
    ];
    const N: &str = "fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141";
    const ROOM: &str = "6a0c3f1e-1111-4222-8333-944455556666";

    fn keys(hex: &str) -> Keys {
        Keys::new(SecretKey::from_hex(hex).unwrap())
    }
    fn bytes(hex: &str) -> Zeroizing<[u8; 32]> {
        let mut b = [0u8; 32];
        for (i, out) in b.iter_mut().enumerate() {
            *out = u8::from_str_radix(&hex[2 * i..2 * i + 2], 16).unwrap();
        }
        Zeroizing::new(b)
    }
    fn uni() -> Keys {
        keys("c3b34a297de769127d3e59f26d0241e1f4a4b5e2a58990a2607009f102a00a56")
    }

    #[test]
    fn seal_key_matches_the_reference_vectors() {
        for (sk, seal_sk, seal_hex) in VECTORS {
            let seal = seal_key(&approval_role(keys(sk))).unwrap();
            assert_eq!(seal.secret_hex(), seal_sk, "{sk}");
            assert_eq!(seal.public_key().to_hex(), seal_hex, "{sk}");
            assert_ne!(seal.public_key(), keys(sk).public_key(), "a different key from the approval key");
            assert_eq!(seal_pub(&approval_role(keys(sk))).unwrap().to_hex(), seal_hex, "{sk}");
        }
    }

    #[test]
    fn the_counter_skips_every_invalid_scalar_and_stops_at_255() {
        let valid = "00000000000000000000000000000000000000000000000000000000000000aa";
        let n_minus_1 = "fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364140";
        // 0, n and 2^256 − 1 are not scalars: counters 1-3 are skipped, 4 is taken
        let (zero, max) = ("00".repeat(32), "ff".repeat(32));
        let mut seen = vec![];
        let sk = first_valid_scalar(|c| {
            seen.push(c);
            bytes(match c {
                1 => &zero,
                2 => N,
                3 => &max,
                _ => valid,
            })
        })
        .unwrap();
        assert_eq!((seen, sk.to_secret_hex()), (vec![1, 2, 3, 4], valid.to_string()));
        assert_eq!(first_valid_scalar(|_| bytes(n_minus_1)).unwrap().to_secret_hex(), n_minus_1);
        // nothing valid in 255 tries: an error, never counter 0 or a wrap-around
        let mut last = 0;
        assert!(first_valid_scalar(|c| {
            last = c;
            bytes(N)
        })
        .is_err());
        assert_eq!(last, 255);
    }

    #[test]
    fn the_enrollment_is_the_documented_event() {
        let me = keys(VECTORS[3].0);
        let ev = enrollment_event(&approval_role(me.clone()), &uni().public_key(), ROOM, 1_760_000_000).unwrap();
        ev.verify().unwrap();
        assert_eq!((ev.kind, ev.pubkey, ev.created_at.as_secs()), (Kind::Custom(9), me.public_key(), 1_760_000_000));
        let content: serde_json::Value = serde_json::from_str(&ev.content).unwrap();
        assert_eq!(content, serde_json::json!({"v": 1, "seal_pub": VECTORS[3].2, "for": uni().public_key().to_hex()}));
        // exactly buzz-sdk's message tags (h, the author's own p) and the t tag; no mention of Uni
        let tags: Vec<Vec<String>> = ev.tags.iter().map(|t| t.as_slice().to_vec()).collect();
        assert_eq!(tags, vec![
            vec!["h".to_string(), ROOM.into()],
            vec!["p".to_string(), me.public_key().to_hex()],
            vec!["t".to_string(), ENROLL_TAG.into()],
        ]);
        // an uppercase room id is written as buzz writes it; a non-id is refused
        let up = enrollment_event(&approval_role(me.clone()), &uni().public_key(), &ROOM.to_uppercase(), 1).unwrap();
        assert_eq!(up.tags.iter().next().unwrap().as_slice()[1], ROOM);
        assert!(enrollment_event(&approval_role(me.clone()), &uni().public_key(), "garden", 1).is_err());
        // nothing secret in it
        let json = nostr::JsonUtil::as_json(&ev);
        assert!(!json.contains(VECTORS[3].0) && !json.contains(VECTORS[3].1));
        assert_eq!(format!("{:?}", seal_key(&approval_role(me.clone())).unwrap()), format!("SealKey({})", VECTORS[3].2));
    }

    #[test]
    fn a_wrong_signer_uni_or_content_is_refused() {
        let me = keys(VECTORS[3].0);
        let other = keys(VECTORS[4].0);
        let ev = enrollment_event(&approval_role(me.clone()), &uni().public_key(), ROOM, 1_760_000_000).unwrap();
        assert!(verify_enrollment(&ev, &me.public_key(), &uni().public_key()).is_ok());
        assert!(verify_enrollment(&ev, &other.public_key(), &uni().public_key()).is_err(), "another signer");
        assert!(verify_enrollment(&ev, &me.public_key(), &other.public_key()).is_err(), "another Uni");
        // a content swap breaks the signature; re-signed by an impostor it's the wrong signer
        let mut swapped = ev.clone();
        swapped.content = ev.content.replace(VECTORS[3].2, VECTORS[4].2);
        assert!(verify_enrollment(&swapped, &me.public_key(), &uni().public_key()).is_err());
        let forged = enrollment_event(&approval_role(other), &uni().public_key(), ROOM, 1_760_000_000).unwrap();
        assert!(verify_enrollment(&forged, &me.public_key(), &uni().public_key()).is_err());
        // malformed bodies, properly signed
        let signed = |content: &str, t: bool| {
            let mut b = EventBuilder::new(Kind::Custom(9), content).tag(tag(&["h", ROOM]).unwrap());
            if t {
                b = b.tag(tag(&["t", ENROLL_TAG]).unwrap());
            }
            b.sign_with_keys(&me).unwrap()
        };
        let u = uni().public_key().to_hex();
        let good = format!(r#"{{"v":1,"seal_pub":"{}","for":"{u}"}}"#, VECTORS[3].2);
        assert!(verify_enrollment(&signed(&good, true), &me.public_key(), &uni().public_key()).is_ok());
        for bad in [
            signed(&good, false),
            signed(&good.replace("\"v\":1", "\"v\":2"), true),
            signed(&good.replace(VECTORS[3].2, "00"), true),
            signed(&good.replace(VECTORS[3].2, &VECTORS[3].2.to_uppercase()), true),
            signed(&good.replace('}', r#","extra":1}"#), true),
            signed(&format!(r#"{{"v":1,"seal_pub":"{}"}}"#, VECTORS[3].2), true),
        ] {
            assert!(verify_enrollment(&bad, &me.public_key(), &uni().public_key()).is_err(), "{}", bad.content);
        }
    }
}
