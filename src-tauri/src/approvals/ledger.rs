//! The answers ledger and the answer itself (the Uni app's `sealed_card::answer`, without the relay).
//!
//! Each request is answered once, with one decision: the answer and its wrap are written to [`ANSWERS_FILE`] before
//! [`prepare_answer`] hands the wrap back, so a retry sends the same decision and a second tap sends nothing new. A card
//! carrying a request id or one-time key already answered under another card is a replay and is refused. The web side
//! publishes the wraps it is given and reports each one taken with [`mark_sent`].

use std::path::Path;

use nostr::{Event, EventId, JsonUtil, PublicKey};
use serde::{Deserialize, Serialize};

use super::card::{check_card, reply_wrap, Card, Decision, Refusal, Request};
use super::seal::seal_key;
use super::{invalid, ApprovalKeys, Result};

/// In the given folder: every request answered here (public facts and, until the relay has it, the wrap).
pub const ANSWERS_FILE: &str = "approval-answers.json";
/// A wrap kept for a retry is sent again as the same event while it is this young; Buzz refuses events more than 15
/// minutes from its clock, so an older one is wrapped afresh (same decision, same rumor content).
pub const RESEND_SAME_WRAP_SECS: u64 = 600;
/// Answers are kept this long after their card expired, then dropped from the file.
const KEEP_AFTER_EXPIRY_SECS: u64 = 7 * 86_400;

/// One request answered here. Public facts, plus the signed wrap until the relay has taken it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Answer {
    /// The card's event id.
    pub card: String,
    pub rid: String,
    pub request_digest: String,
    pub rpk: String,
    pub decision: Decision,
    /// When it was tapped.
    pub at: u64,
    /// Approve: when the broker's window closes at the latest (tap + `ttl_s`).
    pub until: Option<u64>,
    pub expires: u64,
    /// The wrap (a public, signed event: ciphertext to `rpk`) while it isn't known to be on the relay.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wrap: Option<String>,
    pub sent: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Answers {
    pub answers: Vec<Answer>,
}

fn unreadable() -> super::Error {
    invalid("the record of answered approvals can't be read")
}

impl Answers {
    /// The ledger in `dir`. Missing is empty; unreadable is an error, never empty (that would forget what was answered).
    pub fn load(dir: &Path) -> Result<Self> {
        match std::fs::read_to_string(dir.join(ANSWERS_FILE)) {
            Ok(s) => serde_json::from_str(&s).map_err(|_| unreadable()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(_) => Err(unreadable()),
        }
    }

    /// Write the ledger to `dir`, first dropping answers a week past their card's expiry. An unsent answer past its
    /// card's expiry can never be taken (the broker refuses it), so it ages out the same way. Not public: every write
    /// goes through [`prepare_answer`] or [`mark_sent`], which hold the one lock.
    pub(super) fn save(&mut self, dir: &Path, now: u64) -> Result<()> {
        self.answers.retain(|a| a.expires.saturating_add(KEEP_AFTER_EXPIRY_SECS) > now);
        self.write(dir)
    }

    fn write(&self, dir: &Path) -> Result<()> {
        save_json(&dir.join(ANSWERS_FILE), self)
    }

    /// This card's answers.
    pub fn for_card(&self, id: &EventId) -> Vec<&Answer> {
        let id = id.to_hex();
        self.answers.iter().filter(|a| a.card == id).collect()
    }

    /// A row of `card` already answered as part of something else: its request id or one-time key under another card, or
    /// its request id with other fields.
    pub fn replays(&self, card: &Card) -> bool {
        let id = card.event_id.to_hex();
        card.rows.iter().any(|r| {
            let rpk = r.rpk.to_hex();
            self.answers.iter().any(|a| {
                (a.rid == r.rid || a.rpk == rpk) && (a.card != id || a.rid != r.rid || a.request_digest != r.request_digest)
            })
        })
    }
}

/// Atomic: a temp file synced to disk, then renamed over the old one, so a crash can't leave an empty ledger.
fn save_json<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    let json = serde_json::to_vec_pretty(value).map_err(|e| invalid(e.to_string()))?;
    let tmp = path.with_extension(format!("{}.tmp", std::process::id()));
    let write = || -> std::io::Result<()> {
        use std::io::Write;
        let dir = match path.parent() {
            Some(d) if !d.as_os_str().is_empty() => d,
            _ => Path::new("."),
        };
        std::fs::create_dir_all(dir)?;
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(&json)?;
        f.sync_all()?;
        std::fs::rename(&tmp, path)?;
        // the rename itself on disk too, so a crash after a wrap went out can't bring the old ledger back
        #[cfg(unix)]
        std::fs::File::open(dir)?.sync_all()?;
        Ok(())
    };
    write().map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        invalid(e.to_string())
    })
}

/// A wrap to publish on the applet's relay connection: a kind 1059 signed by a throwaway key, `p` = the card's author.
#[derive(Debug, Clone)]
pub struct PreparedWrap {
    /// The card's event id (hex).
    #[allow(dead_code)]
    pub card: String,
    pub rid: String,
    pub wrap: Event,
}

/// One answer at a time in this process: two taps can't both find a request unanswered, and a `mark_sent` can't be lost
/// between another call's load and save.
static ANSWERING: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn one_at_a_time() -> std::sync::MutexGuard<'static, ()> {
    // a panic elsewhere while holding it leaves no half-written state here (every save is atomic): carry on
    ANSWERING.lock().unwrap_or_else(|p| p.into_inner())
}

/// Answer `rids` of the card `ev` with `decision`, everything but the network: check the card again (§3, at `now`, author
/// in `trusted`), refuse a replay or a second answer, record each answer with its wrap in `dir` (on disk before this
/// returns), and return the wraps still to publish. A retry (an earlier answer not yet marked sent) returns the kept
/// wrap while it is at most [`RESEND_SAME_WRAP_SECS`] old, else a fresh wrap of the same decision, saved first. Answers
/// already sent return nothing.
#[allow(clippy::too_many_arguments)]
pub fn prepare_answer(
    approval: &ApprovalKeys,
    trusted: &[PublicKey],
    ev: &Event,
    decision: Decision,
    rids: &[String],
    dir: &Path,
    now: u64,
) -> Result<Vec<PreparedWrap>> {
    let _one = one_at_a_time();
    let seal = seal_key(approval)?;
    let mut answers = Answers::load(dir)?;
    let card = check_card(ev, trusted, &seal, now)?;
    if answers.replays(&card) {
        return Err(Refusal::Replayed.into());
    }
    let mut wanted: Vec<&Request> = Vec::new();
    for rid in rids {
        let r = card.rows.iter().find(|r| &r.rid == rid).ok_or_else(|| invalid("that request isn't on this card"))?;
        if wanted.iter().any(|w| w.rid == r.rid) {
            return Err(invalid("a request was named twice"));
        }
        wanted.push(r);
    }
    if wanted.is_empty() {
        return Err(invalid("nothing was chosen"));
    }
    let card_id = card.event_id.to_hex();
    let earlier = answers.for_card(&card.event_id);
    let mut changed = false;
    if !earlier.is_empty() {
        // answered before: only a retry of exactly what was decided then
        let same = wanted.iter().all(|r| earlier.iter().any(|a| a.rid == r.rid && a.decision == decision));
        if !same {
            return Err(invalid("this card was already answered"));
        }
    } else {
        for r in &wanted {
            let wrap = reply_wrap(approval, &card, r, decision, now)?;
            answers.answers.push(Answer {
                card: card_id.clone(),
                rid: r.rid.clone(),
                request_digest: r.request_digest.clone(),
                rpk: r.rpk.to_hex(),
                decision,
                at: now,
                until: (decision == Decision::Approve).then_some(now + r.ttl_s),
                expires: r.expires,
                wrap: Some(wrap.as_json()),
                sent: false,
            });
        }
        changed = true;
    }

    let mut out = Vec::new();
    for a in answers.answers.iter_mut() {
        if a.card != card_id || a.sent {
            continue;
        }
        let Some(r) = wanted.iter().find(|r| r.rid == a.rid) else { continue };
        let kept = a.wrap.as_deref().and_then(|w| Event::from_json(w).ok());
        let wrap = match kept.filter(|w| now.saturating_sub(w.created_at.as_secs()) <= RESEND_SAME_WRAP_SECS) {
            Some(w) => w,
            None => {
                let w = reply_wrap(approval, &card, r, a.decision, now)?;
                a.wrap = Some(w.as_json());
                changed = true;
                w
            }
        };
        out.push(PreparedWrap { card: card_id.clone(), rid: a.rid.clone(), wrap });
    }
    if changed {
        // on disk before anything goes out: whatever happens next, this request has this answer and no other
        answers.save(dir, now).map_err(|e| invalid(format!("couldn't keep the answer, so nothing was sent ({e})")))?;
    }
    Ok(out)
}

/// The relay took the wrap answering `rid` on card `card_id` (hex): mark it sent and drop the kept wrap. Saying so twice
/// is fine; an answer that isn't in the ledger is an error.
pub fn mark_sent(dir: &Path, card_id: &str, rid: &str) -> Result<()> {
    let _one = one_at_a_time();
    let mut answers = Answers::load(dir)?;
    let a = answers
        .answers
        .iter_mut()
        .find(|a| a.card == card_id && a.rid == rid)
        .ok_or_else(|| invalid("that answer isn't in the record"))?;
    if a.sent {
        return Ok(());
    }
    a.sent = true;
    a.wrap = None;
    // no clock here: ageing out happens on the next answer
    answers.write(dir)
}
