//! The NIP-59 gift wrap every answer goes out in, built by hand as the Uni app's `secret::wrap` builds it (not nostr's
//! nip59 helpers): the rumor's id is hashed while it is serialized, the seal keeps NIP-59's two-day tweak, and the wrap
//! moves back at most 10 minutes, because Buzz refuses events more than 15 minutes from its clock.

use nostr::hashes::{sha256, Hash, HashEngine};
use nostr::nips::nip44;
use nostr::{Event, EventBuilder, EventId, JsonUtil, Keys, Kind, PublicKey, Tag, Timestamp, UnsignedEvent};
use serde::Serialize;
use zeroize::{Zeroize, Zeroizing};

use super::{invalid, ApprovalKeys, Result};

pub(super) fn tag(parts: &[&str]) -> Result<Tag> {
    Tag::parse(parts.iter().copied()).map_err(|e| invalid(e.to_string()))
}

/// NIP-59 rumor → seal (signed by `sender`) → gift wrap (signed by a fresh key), both layers NIP-44 v2 to `enc_to`; the
/// wrap is `p`-tagged to `route` and carries a NIP-40 `expiration`.
#[allow(clippy::too_many_arguments)]
pub(super) fn wrap(
    sender: &ApprovalKeys,
    route: &PublicKey,
    enc_to: &PublicKey,
    kind: u16,
    content: &str,
    tags: Vec<Tag>,
    now: u64,
    expiration: u64,
) -> Result<Event> {
    let sender = sender.keys();
    // The rumor's copy of `content` is zeroed however this returns, errors included.
    struct Rumor(UnsignedEvent);
    impl Drop for Rumor {
        fn drop(&mut self) {
            self.0.content.zeroize();
        }
    }
    // Not `EventBuilder::build`, which computes the id with nostr's `ensure_id()`: see `rumor_id`.
    let mut rumor = Rumor(UnsignedEvent::new(sender.public_key(), Timestamp::from_secs(now), Kind::Custom(kind), tags, content));
    rumor.0.id = Some(rumor_id(&rumor.0)?);
    // worst case: every byte of the content and tags escaped as `\uXXXX`, plus the fixed fields
    let tags_len: usize = rumor.0.tags.iter().map(|t| t.as_slice().iter().map(|v| v.len() + 3).sum::<usize>() + 2).sum();
    let rumor_json = json_zeroizing(&rumor.0, 512 + 6 * (rumor.0.content.len() + tags_len))?;
    drop(rumor);
    let sealed = nip44::encrypt(sender.secret_key(), enc_to, rumor_json.as_str(), nip44::Version::V2)
        .map_err(|e| invalid(format!("nip44 seal: {e}")))?;
    let seal = EventBuilder::new(Kind::Seal, sealed)
        .custom_created_at(Timestamp::tweaked(0..172_800))
        .sign_with_keys(sender)
        .map_err(|e| invalid(format!("cannot sign seal: {e}")))?;
    let one_off = Keys::generate();
    let wrapped = nip44::encrypt(one_off.secret_key(), enc_to, seal.as_json(), nip44::Version::V2)
        .map_err(|e| invalid(format!("nip44 wrap: {e}")))?;
    // up to 10 minutes back: `tweaked` is "now minus a random amount in the range"
    let jitter = Timestamp::now().as_secs().saturating_sub(Timestamp::tweaked(0..600).as_secs());
    let at = now.saturating_sub(jitter.min(600));
    EventBuilder::new(Kind::GiftWrap, wrapped)
        .tags([tag(&["p", &route.to_hex()])?, tag(&["expiration", &expiration.to_string()])?])
        .custom_created_at(Timestamp::from_secs(at))
        .sign_with_keys(&one_off)
        .map_err(|e| invalid(format!("cannot sign wrap: {e}")))
}

/// The NIP-01 id of `rumor`, hashed while it is serialized. nostr's `ensure_id()` builds a `serde_json::Value` and then a
/// `String` of the whole event, content included, and frees both unzeroed; here the JSON goes straight into the SHA-256
/// engine, whose buffer is overwritten afterwards. What the engine last held is the end of the serialized event, which
/// the callers arrange to be request ids and names, never a value or a data key.
pub(super) fn rumor_id(rumor: &UnsignedEvent) -> Result<EventId> {
    struct Sha(sha256::HashEngine);
    impl std::io::Write for Sha {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0.input(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let mut sha = Sha(sha256::HashEngine::default());
    let fields = (0u8, &rumor.pubkey, &rumor.created_at, &rumor.kind, &rumor.tags, &rumor.content);
    let done = serde_json::to_writer(&mut sha, &fields).map(|()| sha256::Hash::from_engine(sha.0.clone()));
    // A full block of zeros overwrites every byte of the engine's block buffer; `black_box` keeps the compiler from
    // dropping the dead writes.
    sha.0.input(&[0u8; 64]);
    std::hint::black_box(&sha.0);
    let hash = done.map_err(|e| invalid(format!("json: {e}")))?;
    Ok(EventId::from_byte_array(hash.to_byte_array()))
}

/// `v` as JSON, written straight into one zeroizing buffer of `capacity` bytes. Sized for the worst case, the buffer
/// never grows, so serializing leaves no smaller, reallocated copy of a secret behind.
pub(super) fn json_zeroizing<T: Serialize>(v: &T, capacity: usize) -> Result<Zeroizing<String>> {
    let mut buf = Zeroizing::new(Vec::with_capacity(capacity));
    serde_json::to_writer(&mut *buf, v).map_err(|e| invalid(format!("json: {e}")))?;
    let text = String::from_utf8(std::mem::take(&mut *buf)).map_err(|e| invalid(e.to_string()))?;
    Ok(Zeroizing::new(text))
}
