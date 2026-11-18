//! Uni's approval card and the morning card (Uni app `sealed_card.rs`; uni-ops CARD.md §2–5, CONTRACT-CHANGES.md P2),
//! checked natively.
//!
//! **The card.** A kind-9 message whose fields are in a fenced ```` ```uni-sealed-approval ```` block (one request) or
//! ```` ```uni-sealed-morning ```` block (`{"v":1,"rows":[…]}`, one request per routine credential). The prose around the
//! block is a courtesy; nothing here reads it.
//!
//! **The checks** ([`check_card`]), in CARD.md §3's order, all before an approve button shows:
//! 1. signed, kind 9, by one of the keys the grant trusts (`approvals.from`);
//! 2. the fields present and typed exactly, `v == 1`, nothing extra;
//! 3. not expired;
//! 4. `payload_digest` recomputed from `action` and `payload`;
//! 5. the box opens with this device's sealing key and names the card's credential and ciphertext;
//! 6. the class inside the box is the card's, and the window and uses are within that class's caps.
//!
//! The morning card is refused whole if any row is not `routine`, and every row is checked as a single card. The data
//! key opened from a box stays in [`Request`]: no `Serialize`, no `Debug` of it, never in a view.

use nostr::hashes::{sha256, Hash};
use nostr::{Event, EventId, PublicKey};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use zeroize::Zeroizing;

use super::ledger::Answers;
use super::seal::SealKey;
use super::wrap::{json_zeroizing, tag, wrap};
use super::{invalid, ApprovalKeys, Result};

/// Fence language of a single approval card.
pub const CARD_FENCE: &str = "uni-sealed-approval";
/// Fence language of the morning card (CONTRACT-CHANGES.md P2).
pub const MORNING_FENCE: &str = "uni-sealed-morning";
/// Rumor kind of an answer (inside the gift wrap only), next to the secret desk's 46040 and 46041.
pub const KIND_APPROVAL_REPLY: u16 = 46042;
/// The broker puts at most this many rows on a morning card.
pub const MORNING_MAX_ROWS: usize = 20;
/// A child token that outlives this is long-lived, and minting one always asks for the device unlock.
pub const LONG_LIVED_CHILD_S: u64 = 86_400;
const PAYLOAD_VERSION: &str = "uni-sealed-payload/v1";
const REQUEST_VERSION: &str = "uni-sealed-request/v1";
/// The fields of one request (CARD.md §2), exactly.
const FIELDS: [&str; 13] =
    ["v", "rid", "action", "credential", "class", "scope", "ttl_s", "uses", "payload", "payload_digest", "expires", "rpk", "box"];

/// The class fixed when the credential was sealed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Class {
    Routine,
    Powerful,
}

impl Class {
    fn parse(s: &str) -> Option<Self> {
        match s {
            "routine" => Some(Self::Routine),
            "powerful" => Some(Self::Powerful),
            _ => None,
        }
    }

    /// The most one tap may release: (seconds open, uses) (CARD.md §3.6).
    pub fn caps(self) -> (u64, u64) {
        match self {
            Self::Routine => (50_400, 200),
            Self::Powerful => (600, 1),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CardKind {
    Single,
    Morning,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Decision {
    Approve,
    Deny,
}

/// Why a card shows greyed out with no buttons, in the one line the card shows (CARD.md §3).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refusal {
    NotUni,
    Incomplete,
    Expired,
    Mismatch,
    NotSealedHere,
    OtherCredential,
    Misstated,
    TooLong(Class),
    PowerfulOnMorning,
    Replayed,
}

impl Refusal {
    pub fn message(self) -> &'static str {
        match self {
            Self::NotUni => "Not signed by Uni.",
            Self::Incomplete => "This card is incomplete.",
            Self::Expired => "This card has expired.",
            Self::Mismatch => "What's shown doesn't match what's approved.",
            Self::NotSealedHere => "This card isn't sealed to this device's approval key.",
            Self::OtherCredential => "The key in this card belongs to a different credential.",
            Self::Misstated => "This card misstates the credential's class.",
            Self::TooLong(Class::Powerful) => "A powerful credential can't be opened for that long.",
            Self::TooLong(Class::Routine) => "A routine credential can't be opened for that long or that often.",
            Self::PowerfulOnMorning => "A powerful credential can never be on the morning card.",
            Self::Replayed => "This card repeats a request that was already answered.",
        }
    }
}

impl std::fmt::Display for Refusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.message())
    }
}

/// `canonical_json` of CARD.md §2 (Python `json.dumps(sort_keys=True, separators=(",", ":"), ensure_ascii=False)`):
/// sorted keys, no spaces, UTF-8. Integers only: a float could print differently here and in the broker, so a payload
/// holding one can't be checked (None), and the card is refused rather than shown.
pub fn canonical_json(v: &Value) -> Option<String> {
    fn write(v: &Value, out: &mut String) -> bool {
        match v {
            Value::Null => out.push_str("null"),
            Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
            Value::Number(n) => match (n.as_i64(), n.as_u64()) {
                (Some(i), _) => out.push_str(&i.to_string()),
                (None, Some(u)) => out.push_str(&u.to_string()),
                _ => return false,
            },
            // serde_json escapes exactly what Python does with ensure_ascii=False: `"`, `\`, and U+0000..U+001F
            Value::String(s) => out.push_str(&serde_json::to_string(s).unwrap_or_default()),
            Value::Array(xs) => {
                out.push('[');
                for (i, x) in xs.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    if !write(x, out) {
                        return false;
                    }
                }
                out.push(']');
            }
            Value::Object(m) => {
                // Rust orders strings by UTF-8 bytes, which is code point order, as Python sorts
                let mut keys: Vec<&String> = m.keys().collect();
                keys.sort();
                out.push('{');
                for (i, k) in keys.into_iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    out.push_str(&serde_json::to_string(k).unwrap_or_default());
                    out.push(':');
                    if !write(&m[k], out) {
                        return false;
                    }
                }
                out.push('}');
            }
        }
        true
    }
    let mut out = String::new();
    write(v, &mut out).then_some(out)
}

fn sha256_hex(parts: &[&[u8]]) -> String {
    use nostr::hashes::HashEngine;
    let mut e = sha256::HashEngine::default();
    for p in parts {
        e.input(p);
    }
    sha256::Hash::from_engine(e).to_string()
}

/// `sha256("uni-sealed-payload/v1\n" + action + "\n" + canonical_json(payload))`, hex.
pub fn payload_digest(action: &str, payload: &Value) -> Option<String> {
    let c = canonical_json(payload)?;
    Some(sha256_hex(&[PAYLOAD_VERSION.as_bytes(), b"\n", action.as_bytes(), b"\n", c.as_bytes()]))
}

/// `sha256("uni-sealed-request/v1\n" + canonical_json(all fields))`, hex: what the answer echoes.
pub fn request_digest(fields: &Value) -> Option<String> {
    let c = canonical_json(fields)?;
    Some(sha256_hex(&[REQUEST_VERSION.as_bytes(), b"\n", c.as_bytes()]))
}

pub(super) fn is_hex(s: &str, len: usize) -> bool {
    s.len() == len && s.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

/// `[a-z0-9][a-z0-9._-]{0,63}` (a credential), or with `:` too (an action).
pub(super) fn valid_name(s: &str, colon: bool) -> bool {
    let b = s.as_bytes();
    !b.is_empty()
        && b.len() <= 64
        && (b[0].is_ascii_lowercase() || b[0].is_ascii_digit())
        && b.iter().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || b"._-".contains(c) || (colon && *c == b':'))
}

/// One request, checked. The data key opened from its box stays in here: no `Serialize`, and `Debug` leaves it out.
pub struct Request {
    pub rid: String,
    pub action: String,
    pub credential: String,
    pub class: Class,
    pub scope: String,
    pub ttl_s: u64,
    pub uses: u64,
    pub payload: Value,
    #[allow(dead_code)]
    pub payload_digest: String,
    pub expires: u64,
    pub rpk: PublicKey,
    pub request_digest: String,
    dek: Zeroizing<String>,
}

impl std::fmt::Debug for Request {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Request")
            .field("rid", &self.rid)
            .field("credential", &self.credential)
            .field("action", &self.action)
            .field("request_digest", &self.request_digest)
            .finish_non_exhaustive()
    }
}

/// What the box holds (CARD.md §3.5). Extra fields are allowed (a later inner version may add some).
#[derive(Deserialize)]
struct Inner {
    v: u64,
    name: String,
    class: String,
    dek: String,
    ct_sha256: String,
}

/// §3 steps 2 to 6 for one request's fields.
fn check_request(f: &Value, seal: &SealKey, now: u64) -> std::result::Result<Request, Refusal> {
    use Refusal::*;
    let m = f.as_object().ok_or(Incomplete)?;
    if m.len() != FIELDS.len() || !FIELDS.iter().all(|k| m.contains_key(*k)) {
        return Err(Incomplete);
    }
    let s = |k: &str| m[k].as_str().ok_or(Incomplete);
    let n = |k: &str| m[k].as_u64().ok_or(Incomplete);
    let (rid, action, credential, scope, digest) = (s("rid")?, s("action")?, s("credential")?, s("scope")?, s("payload_digest")?);
    let class = Class::parse(s("class")?).ok_or(Incomplete)?;
    let (v, ttl_s, uses, expires) = (n("v")?, n("ttl_s")?, n("uses")?, n("expires")?);
    let rpk = s("rpk")?;
    let bx = m["box"].as_object().ok_or(Incomplete)?;
    let bs = |k: &str| bx.get(k).and_then(Value::as_str).ok_or(Incomplete);
    let (epk, dek_box, ct_sha256) = (bs("epk")?, bs("dek_box")?, bs("ct_sha256")?);
    let scope_len = scope.chars().count();
    let well_formed = v == 1
        && is_hex(rid, 32)
        && valid_name(action, true)
        && valid_name(credential, false)
        && !scope.trim().is_empty()
        && (1..=280).contains(&scope_len)
        && is_hex(digest, 64)
        && is_hex(rpk, 64)
        && bx.len() == 3
        && is_hex(epk, 64)
        && is_hex(ct_sha256, 64);
    if !well_formed {
        return Err(Incomplete);
    }
    // nostr's `from_hex` takes any 32 bytes; `xonly` checks the point is on the curve
    let key = |h: &str| PublicKey::from_hex(h).ok().filter(|k| k.xonly().is_ok()).ok_or(Incomplete);
    let (rpk, epk) = (key(rpk)?, key(epk)?);
    // 3
    if expires <= now {
        return Err(Expired);
    }
    // 4
    if payload_digest(action, &m["payload"]).as_deref() != Some(digest) {
        return Err(Mismatch);
    }
    let request_digest = request_digest(f).ok_or(Mismatch)?;
    // 5
    let opened = seal.open_box(&epk, dek_box).map_err(|_| NotSealedHere)?;
    let inner: Inner = serde_json::from_str(&opened).map_err(|_| NotSealedHere)?;
    let dek = Zeroizing::new(inner.dek);
    if inner.v != 1 || inner.name != credential || inner.ct_sha256 != ct_sha256 || !is_hex(&dek, 64) {
        return Err(OtherCredential);
    }
    // 6
    if Class::parse(&inner.class) != Some(class) {
        return Err(Misstated);
    }
    let (max_ttl, max_uses) = class.caps();
    if !(1..=max_ttl).contains(&ttl_s) || !(1..=max_uses).contains(&uses) {
        return Err(TooLong(class));
    }
    Ok(Request {
        rid: rid.into(),
        action: action.into(),
        credential: credential.into(),
        class,
        scope: scope.into(),
        ttl_s,
        uses,
        payload: m["payload"].clone(),
        payload_digest: digest.into(),
        expires,
        rpk,
        request_digest,
        dek,
    })
}

/// The one fenced block of `lang` in `body`: Err when the fence opens twice or never closes.
fn fenced<'a>(body: &'a str, lang: &str) -> std::result::Result<Option<&'a str>, Refusal> {
    let open = format!("```{lang}\n");
    let Some(at) = body.find(&open) else { return Ok(None) };
    if body[at + open.len()..].contains(&open) {
        return Err(Refusal::Incomplete);
    }
    let start = at + open.len();
    let end = body[start..].find("\n```").ok_or(Refusal::Incomplete)?;
    Ok(Some(&body[start..start + end]))
}

/// Which card a message body carries, unverified (to route it to the card; [`check_card`] decides what it is).
pub fn card_kind(body: &str) -> Option<CardKind> {
    if body.contains(&format!("```{CARD_FENCE}\n")) {
        Some(CardKind::Single)
    } else if body.contains(&format!("```{MORNING_FENCE}\n")) {
        Some(CardKind::Morning)
    } else {
        None
    }
}

/// A card that passed every check: one request (single) or one per row (morning).
#[derive(Debug)]
pub struct Card {
    pub kind: CardKind,
    pub event_id: EventId,
    /// The trusted key that signed it: answers are routed to it (the wrap's `p`).
    pub author: PublicKey,
    pub rows: Vec<Request>,
}

/// CARD.md §3 for the signed event `ev`, at `now`. `trusted` is the grant's `approvals.from` (what the person saw on the
/// grant's card, never the event or the applet): the author must be one of them. `seal` is this device's sealing key.
pub fn check_card(ev: &Event, trusted: &[PublicKey], seal: &SealKey, now: u64) -> std::result::Result<Card, Refusal> {
    use Refusal::*;
    // 1
    if ev.verify().is_err() || !trusted.contains(&ev.pubkey) || ev.kind != nostr::Kind::Custom(9) {
        return Err(NotUni);
    }
    let card = |kind, rows| Card { kind, event_id: ev.id, author: ev.pubkey, rows };
    let parse = |s: &str| serde_json::from_str::<Value>(s).map_err(|_| Incomplete);
    match (fenced(&ev.content, CARD_FENCE)?, fenced(&ev.content, MORNING_FENCE)?) {
        (Some(block), None) => {
            let f = parse(block)?;
            Ok(card(CardKind::Single, vec![check_request(&f, seal, now)?]))
        }
        (None, Some(block)) => {
            let body = parse(block)?;
            let m = body.as_object().ok_or(Incomplete)?;
            let rows = m.get("rows").and_then(Value::as_array).ok_or(Incomplete)?;
            if m.len() != 2 || m.get("v").and_then(Value::as_u64) != Some(1) || rows.is_empty() || rows.len() > MORNING_MAX_ROWS {
                return Err(Incomplete);
            }
            // the whole card, before any row is opened (P2: "if any row's class is not routine, refuse the whole card")
            if rows.iter().any(|r| r.get("class").is_some_and(|c| c.as_str() != Some("routine"))) {
                return Err(PowerfulOnMorning);
            }
            // every row is then routine inside its box too (§3.6 refuses a misstated class)
            let rows = rows.iter().map(|r| check_request(r, seal, now)).collect::<std::result::Result<Vec<_>, _>>()?;
            // one row per credential, each its own request and one-time key, all answered by the same time
            let distinct = |f: fn(&Request) -> String| {
                let mut xs: Vec<String> = rows.iter().map(f).collect();
                xs.sort();
                xs.dedup();
                xs.len() == rows.len()
            };
            if !distinct(|r| r.rid.clone())
                || !distinct(|r| r.rpk.to_hex())
                || !distinct(|r| r.credential.clone())
                || rows.iter().any(|r| r.expires != rows[0].expires)
            {
                return Err(Incomplete);
            }
            Ok(card(CardKind::Morning, rows))
        }
        _ => Err(Incomplete),
    }
}

/// The 46042 rumor content. The data key comes first, so the serialized rumor's tail (the last bytes a hash engine holds,
/// see `wrap::rumor_id`) is the request id, digest and decision, never part of the key. A deny carries no key.
fn reply_json(r: &Request, decision: Decision) -> Result<Zeroizing<String>> {
    #[derive(Serialize)]
    struct Reply<'a> {
        #[serde(skip_serializing_if = "Option::is_none")]
        dek: Option<&'a str>,
        v: u8,
        rid: &'a str,
        request_digest: &'a str,
        decision: Decision,
    }
    let dek = (decision == Decision::Approve).then_some(r.dek.as_str());
    let body = Reply { dek, v: 1, rid: &r.rid, request_digest: &r.request_digest, decision };
    json_zeroizing(&body, 256 + 6 * (r.dek.len() + r.rid.len() + r.request_digest.len()))
}

/// The gift wrap answering `r` on `card` (CARD.md §5): routed to the card's author, encrypted to the request's one-time
/// key, sealed by the approval key, expiring with the card.
pub(super) fn reply_wrap(approval: &ApprovalKeys, card: &Card, r: &Request, decision: Decision, now: u64) -> Result<Event> {
    let content = reply_json(r, decision)?;
    let e = tag(&["e", &card.event_id.to_hex()])?;
    wrap(approval, &card.author, &r.rpk, KIND_APPROVAL_REPLY, &content, vec![e], now, r.expires)
}

/// An answer, as the card shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AnswerView {
    pub decision: Decision,
    pub at: u64,
    pub until: Option<u64>,
    pub sent: bool,
}

/// One verified request, as the card draws it. No data key, no box.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RowView {
    pub rid: String,
    pub action: String,
    pub credential: String,
    pub class: Class,
    pub scope: String,
    pub ttl_s: u64,
    pub uses: u64,
    pub payload: Value,
    pub request_digest: String,
    pub expires: u64,
    pub answer: Option<AnswerView>,
    /// Approving it always asks for the device unlock, even within the grace ([`always_unlock`]).
    pub always_unlock: bool,
    /// When Uni asked: the signed card's own time. A card can wait up to a day, so the card shows how old the job is.
    pub asked: u64,
    /// The key's true reach, the first thing the card says ([`reach_line`]); None for a card that has no such line.
    pub reach: Option<String>,
    /// What a read key riding on the card can see ([`read_key_line`]); it stays on the card's face.
    pub read_key: Option<String>,
}

/// What the card shows: its rows when every check passed, else the one-line reason and nothing to tap.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CardView {
    pub kind: Option<CardKind>,
    pub event_id: String,
    /// The key that signed the card (hex), so the applet can say who asks.
    pub author: String,
    pub refused: Option<String>,
    pub rows: Vec<RowView>,
}

/// The card `ev` as it stands now. A card answered here is shown as it was when answered, even once it has expired.
pub fn view(ev: &Event, trusted: &[PublicKey], seal: &SealKey, answers: &Answers, now: u64) -> CardView {
    let kind = card_kind(&ev.content);
    let refused = |r: Refusal| CardView {
        kind,
        event_id: ev.id.to_hex(),
        author: ev.pubkey.to_hex(),
        refused: Some(r.message().into()),
        rows: vec![],
    };
    let earlier = answers.for_card(&ev.id);
    let checked = match check_card(ev, trusted, seal, now) {
        Err(Refusal::Expired) if !earlier.is_empty() => {
            check_card(ev, trusted, seal, earlier.iter().map(|a| a.at).min().unwrap_or(now))
        }
        other => other,
    };
    let card = match checked {
        Ok(c) => c,
        Err(r) => return refused(r),
    };
    if answers.replays(&card) {
        return refused(Refusal::Replayed);
    }
    let rows = card
        .rows
        .iter()
        .map(|r| RowView {
            rid: r.rid.clone(),
            action: r.action.clone(),
            credential: r.credential.clone(),
            class: r.class,
            scope: r.scope.clone(),
            ttl_s: r.ttl_s,
            uses: r.uses,
            payload: r.payload.clone(),
            request_digest: r.request_digest.clone(),
            expires: r.expires,
            answer: earlier
                .iter()
                .find(|a| a.rid == r.rid)
                .map(|a| AnswerView { decision: a.decision, at: a.at, until: a.until, sent: a.sent }),
            always_unlock: always_unlock(r.class, &r.action, &r.payload),
            asked: ev.created_at.as_secs(),
            reach: reach_line(&r.action, &r.scope),
            read_key: read_key_line(&r.action, &r.scope),
        })
        .collect();
    CardView { kind: Some(card.kind), event_id: ev.id.to_hex(), author: card.author.to_hex(), refused: None, rows }
}

/// "45 s", "10 min", "14 h" (CARD.md §4), as the card shows a window.
pub fn span(ttl: u64) -> String {
    if ttl < 120 {
        format!("{ttl} s")
    } else if ttl < 7200 {
        format!("{} min", ttl / 60)
    } else {
        let h = ttl as f64 / 3600.0;
        if h.fract() == 0.0 {
            format!("{h:.0} h")
        } else {
            format!("{h:.1} h")
        }
    }
}

/// What the device's own unlock prompt says before an approval goes out: (title, reason), built here from the checked
/// view and exactly the requests `rids` names, never from words the applet sends. Errors when a request isn't on the card
/// or the card can't be approved.
pub fn approval_summary(view: &CardView, rids: &[String]) -> Result<(String, String)> {
    if let Some(why) = &view.refused {
        return Err(invalid(why.clone()));
    }
    let rows: Vec<&RowView> = rids
        .iter()
        .map(|rid| view.rows.iter().find(|r| &r.rid == rid).ok_or_else(|| invalid("that request isn't on this card")))
        .collect::<Result<_>>()?;
    if rows.iter().enumerate().any(|(i, r)| rows[..i].iter().any(|s| s.rid == r.rid)) {
        return Err(invalid("a request was named twice"));
    }
    let uses = |n: u64| format!("{n} use{}", if n == 1 { "" } else { "s" });
    let job = |r: &RowView| format!("job {} {}", &r.request_digest[..4], &r.request_digest[4..8]);
    let one = |r: &RowView| format!("{} · {}, {}, {}", r.credential, r.action, span(r.ttl_s), uses(r.uses));
    // a mint for a child that never expires says so here too (P3: `child_ttl_s: null`)
    let permanent = |r: &RowView| {
        if r.action == "mint.cloudflare" && r.payload.get("child_ttl_s").is_some_and(Value::is_null) {
            " This makes a permanent token."
        } else {
            ""
        }
    };
    match rows.as_slice() {
        [] => Err(invalid("nothing was chosen")),
        [r] if view.kind == Some(CardKind::Single) => {
            let power = if r.class == Class::Powerful { "powerful " } else { "" };
            // the reach alone, where the card has one: the device's own prompt is one short paragraph, never the agent's words
            let what = r.reach.as_deref().unwrap_or(&r.scope);
            let riding = r.read_key.as_deref().map(|k| format!(" {k}")).unwrap_or_default();
            Ok((
                format!("Approve a {power}credential"),
                format!("Uni: {}. {}.{riding}{} Exact {}.", one(r), what.trim_end_matches(['.', '!', '?']), permanent(r), job(r)),
            ))
        }
        rs => Ok((
            format!("Approve {} of Uni's morning grants", rs.len()),
            rs.iter().map(|r| format!("{} ({})", one(r), job(r))).collect::<Vec<_>>().join("; ") + ".",
        )),
    }
}

/// The actions only the broker words itself (a caller's request can't use them), so the first line of their scope is the
/// broker's, from fields it checked. Everyone else's scope is that caller's words. `github.ruleset.apply`: the broker
/// reserves every `github.*` action for its own op.
const BROKER_WORDED: [&str; 4] = ["job.cloudflare", "mint.cloudflare", "lookup.cloudflare", "github.ruleset.apply"];

/// The first line of a card's scope when it says the key's true reach (uni-ops sealed/card_text.py).
pub fn reach_line(action: &str, scope: &str) -> Option<String> {
    let first = scope.lines().next()?.trim();
    (BROKER_WORDED.contains(&action) && ["🔴 ", "🟡 ", "🟢 "].iter().any(|d| first.starts_with(d))).then(|| first.to_string())
}

/// The line of a broker-worded scope saying what a read key riding on the card can see. It sits above the agent's words,
/// so only a line before "Uni says:" counts.
pub fn read_key_line(action: &str, scope: &str) -> Option<String> {
    if !BROKER_WORDED.contains(&action) {
        return None;
    }
    scope.lines().take_while(|l| !l.starts_with("Uni says:")).find(|l| l.starts_with("Read key: ")).map(str::to_string)
}

/// Keys small enough for the grace: the names and settings of zones, and nothing else today. A template this table
/// doesn't know is big.
const SMALL_TEMPLATES: [&str; 1] = ["zone-read"];

fn all_small(templates: Option<&Value>) -> bool {
    templates
        .and_then(Value::as_array)
        .is_some_and(|ts| !ts.is_empty() && ts.iter().all(|t| t.as_str().is_some_and(|t| SMALL_TEMPLATES.contains(&t))))
}

/// Whether a powerful credential opens here only for a small key: decided from the signed payload's templates, never from
/// the card's words. What the grace skips is the second unlock inside a few minutes of the last one.
pub fn small_key(action: &str, payload: &Value) -> bool {
    match action {
        "lookup.cloudflare" => *payload == serde_json::json!({"v": 1, "lookup": "discover"}),
        "job.cloudflare" => {
            all_small(payload.get("templates"))
                && match payload.get("checks") {
                    None => true,
                    Some(c) => all_small(c.get("templates")),
                }
        }
        "mint.cloudflare" => {
            payload.get("template").and_then(Value::as_str).is_some_and(|t| SMALL_TEMPLATES.contains(&t))
                && payload.get("destination").and_then(Value::as_str) == Some("job")
                && payload.get("child_ttl_s").and_then(Value::as_u64).is_some_and(|t| t > 0 && t <= LONG_LIVED_CHILD_S)
        }
        _ => false,
    }
}

/// Whether approving a request always needs the device's own unlock, even within the grace: a powerful credential unless
/// it opens only for a small key ([`small_key`]), or a mint whose child token is permanent, long-lived or of no stated
/// lifetime. Everything else is routine.
pub fn always_unlock(class: Class, action: &str, payload: &Value) -> bool {
    if class == Class::Powerful {
        return !small_key(action, payload);
    }
    let child = payload.get("child_ttl_s");
    if action.starts_with("mint.") || child.is_some() {
        // 0 is "no expiry" to many token APIs: as permanent
        return !child.and_then(Value::as_u64).is_some_and(|t| t > 0 && t <= LONG_LIVED_CHILD_S);
    }
    false
}

/// Whether approving `rids` on this card needs a fresh device unlock: any chosen request that always does, and anything
/// that can't be approved at all (refused, a request not on the card, nothing chosen) errs the same way.
pub fn needs_fresh_unlock(view: &CardView, rids: &[String]) -> bool {
    view.refused.is_some()
        || rids.is_empty()
        || rids.iter().any(|rid| view.rows.iter().find(|r| &r.rid == rid).map_or(true, |r| r.always_unlock))
}
