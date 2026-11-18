//! Approvals inside an applet (docs/design/KEYRING.md, "Approving inside an applet"): Uni's sealed approval cards, its
//! secret requests and this device's sealing key, ported from the Uni app (`crates/uni-core/src/sealed_card.rs`,
//! `secret.rs`, `sealed.rs`) with their tests. Pure: no relay, no webview, no key store. The caller hands in the signed
//! event, the trusted keys from the grant's `approvals.from`, the approval key and a folder for the answers ledger; it
//! gets back a view (never the data key), the wraps to publish, or a refusal.
//!
//! **The role guard.** Everything here that signs a seal (kind 13) takes an [`ApprovalKeys`], which only
//! [`approval_role`] makes. A caller holding the everyday key has to take the approval role deliberately, in one
//! greppable place, before anything in this module will seal with it.

mod card;
mod ledger;
mod seal;
mod secret;
mod wrap;

#[cfg(test)]
mod tests;

// Until the shell wires this in (services.rs), nothing outside uses these names.
#[allow(unused_imports)]
pub use card::{
    always_unlock, approval_summary, canonical_json, card_kind, check_card, needs_fresh_unlock, payload_digest,
    read_key_line, reach_line, request_digest, small_key, span, view, AnswerView, Card, CardKind, CardView, Class,
    Decision, Refusal, Request, RowView, CARD_FENCE, KIND_APPROVAL_REPLY, LONG_LIVED_CHILD_S, MORNING_FENCE,
    MORNING_MAX_ROWS,
};
#[allow(unused_imports)]
pub use ledger::{mark_sent, prepare_answer, Answer, Answers, PreparedWrap, ANSWERS_FILE, RESEND_SAME_WRAP_SECS};
#[allow(unused_imports)]
pub use seal::{enrollment_event, seal_key, seal_pub, verify_enrollment, Enrollment, SealKey, ENROLL_TAG, SEAL_INFO, SEAL_SALT};
#[allow(unused_imports)]
pub use secret::{
    check_answerable, parse_request, seal_delivery, seal_forget, verified_request, Asked, SecretRequest,
    KIND_SECRET_DELIVERY, KIND_SECRET_FORGET, MAX_VALUE_BYTES, REQUEST_FENCE, WRAP_LIFETIME_SECS,
};

use nostr::{Keys, PublicKey};

/// What went wrong, in words the shell can show as they are.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Error {
    /// The card was checked and refused (the one line the card shows).
    Refused(Refusal),
    /// Anything else: a bad request, a ledger that can't be read or written, a key that can't sign.
    Invalid(String),
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Refused(r) => f.write_str(r.message()),
            Self::Invalid(s) => f.write_str(s),
        }
    }
}

impl std::error::Error for Error {}

impl From<Refusal> for Error {
    fn from(r: Refusal) -> Self {
        Self::Refused(r)
    }
}

impl From<Error> for String {
    fn from(e: Error) -> Self {
        e.to_string()
    }
}

pub type Result<T> = std::result::Result<T, Error>;

pub(crate) fn invalid(s: impl Into<String>) -> Error {
    Error::Invalid(s.into())
}

/// The approval key in its approval role: the only thing this module seals with. No `Clone`, no `Serialize`, and its
/// `Debug` shows the public key only. The secret half is reachable inside `approvals` alone.
pub struct ApprovalKeys(Keys);

impl ApprovalKeys {
    pub fn public_key(&self) -> PublicKey {
        self.0.public_key()
    }

    /// The key itself, for signing a seal or deriving the sealing key. Only this module's files can call it.
    pub(in crate::approvals) fn keys(&self) -> &Keys {
        &self.0
    }
}

impl std::fmt::Debug for ApprovalKeys {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "ApprovalKeys({})", self.public_key().to_hex())
    }
}

/// The approval key's bytes for one use outside this module: signing a NIP-98 request for an http service's `approve`
/// op (services.rs `Role::Approval`), after the device unlock. Nothing else takes them out.
pub(crate) fn for_approve_op(a: &ApprovalKeys) -> &Keys {
    &a.0
}

/// Take `keys` in the approval role. Until the person makes a separate approval key these are the everyday key's bytes
/// (KEYRING.md, "Three keys"); the caller decides that, here is only where it says so.
pub(crate) fn approval_role(keys: Keys) -> ApprovalKeys {
    ApprovalKeys(keys)
}
