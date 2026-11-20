//! Security levels (docs/design/APP-RECORD.md "Security levels"): how careful this device is, per action, and the idle
//! lock. One small gate the shell keeps here, natively: the web side never says which level holds or that the person
//! unlocked.
//!
//! - **Actions.** `approvals`: Uni's routine approval cards and held sends (a powerful card always asks at least the
//!   unlock). `code`: approving an applet's code (never below the unlock). `join`: an http service's join op, asking to
//!   join a private network with the person's key. `idle`: minutes untouched before Parachute asks the unlock to open
//!   (0: off).
//! - **Levels.** `none` (the tap alone), `unlock` (the device unlock), `passcode` (this device's passcode, then the
//!   unlock). A grace (keyring.rs) may cover a routine unlock; it never covers the passcode.
//! - **Kept** in the app's data folder (`levels.json`). The app record's `security` only raises them (`raise`).
//!   Lowering anything takes the person's signed approval from an unlocked device: signed here (`levels_lower`: the
//!   passcode when this device has one, then the unlock, then the key signs it), or another device's, signed with the
//!   key this device holds and dated after the last change here (`levels_adopt`). A vault edit alone changes nothing
//!   but upward.
//! - **The idle lock.** The last touch is kept here (the web side reports real input; Android's activity reports every
//!   touch itself, with the longest quiet gap between two). Past the minutes, Parachute is locked until the device
//!   unlock: every unlock-gated call refuses meanwhile, and a touch never unlocks it.
use std::future::Future;
use std::path::{Path, PathBuf};

use nostr::{Event, JsonUtil, PublicKey};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, Runtime, State};
use zeroize::Zeroizing;

use crate::approve::{PasscodeState, APPROVAL_KIND};
use crate::door::Refusal;
use crate::key::KeyState;
use crate::keyring::KeyringState;

const LEVELS_FILE: &str = "levels.json";
const IDLE_FILE: &str = "idle.json";
/// The longest idle lock: a day.
pub const IDLE_MAX: u32 = 24 * 60;
/// The last touch is written at most this often (and on every unlock).
const WRITE_EVERY_MS: u64 = 30_000;
/// How far ahead of this device's clock a lowering may be dated.
const SKEW_S: u64 = 600;
/// The subject's `applet` on a lowering's approval: never an applet's id (an applet's approval names its manifest id,
/// and its record is an applet note).
pub const SECURITY_SUBJECT: &str = "security";

fn no(code: &'static str, message: impl Into<String>) -> Refusal {
    Refusal { code, message: message.into() }
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    None,
    Unlock,
    Passcode,
}

impl Level {
    fn word(self) -> &'static str {
        match self {
            Level::None => "none",
            Level::Unlock => "unlock",
            Level::Passcode => "passcode",
        }
    }
    fn of(w: &str) -> Option<Level> {
        match w {
            "none" => Some(Level::None),
            "unlock" => Some(Level::Unlock),
            "passcode" => Some(Level::Passcode),
            _ => None,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct Levels {
    pub approvals: Level,
    pub code: Level,
    pub join: Level,
    /// Minutes; 0: no idle lock.
    pub idle: u32,
}

/// Aaron's defaults (11-18): approvals and approving code take the unlock, joining a network the passcode, no idle lock.
pub const DEFAULTS: Levels = Levels { approvals: Level::Unlock, code: Level::Unlock, join: Level::Passcode, idle: 0 };

/// What a record (or a person) asks: a field left out leaves that one as it is.
#[derive(Deserialize, Serialize, Default, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Asked {
    #[serde(default)]
    pub approvals: Option<Level>,
    #[serde(default)]
    pub code: Option<Level>,
    #[serde(default)]
    pub join: Option<Level>,
    #[serde(default)]
    pub idle: Option<u32>,
}

/// The rules no level drops: approving code takes the unlock; the idle lock is at most a day.
pub fn floored(l: Levels) -> Levels {
    Levels { code: l.code.max(Level::Unlock), idle: l.idle.min(IDLE_MAX), ..l }
}

/// The stricter of two idle locks: the shorter one; off (0) is the loosest.
pub fn stricter_idle(a: u32, b: u32) -> u32 {
    match (a, b) {
        (0, x) | (x, 0) => x,
        (a, b) => a.min(b),
    }
}

/// `cur` with whatever `asked` makes stricter, and nothing it would make looser.
pub fn raise(cur: Levels, asked: &Asked) -> Levels {
    floored(Levels {
        approvals: asked.approvals.map_or(cur.approvals, |a| a.max(cur.approvals)),
        code: asked.code.map_or(cur.code, |a| a.max(cur.code)),
        join: asked.join.map_or(cur.join, |a| a.max(cur.join)),
        idle: asked.idle.map_or(cur.idle, |a| stricter_idle(cur.idle, a.min(IDLE_MAX))),
    })
}

/// Whether `next` is looser than `cur` anywhere.
pub fn loosens(cur: Levels, next: Levels) -> bool {
    next.approvals < cur.approvals || next.code < cur.code || next.join < cur.join || stricter_idle(cur.idle, next.idle) != next.idle
}

/// The levels as a lowering's approval names them (its `code`): the same text on every device, read back by
/// `parse_code`. The web side writes the same (src/shell/levels.ts `codeOf`).
pub fn code_of(l: Levels) -> String {
    format!("levels:v1:approvals={},code={},join={},idle={}", l.approvals.word(), l.code.word(), l.join.word(), l.idle)
}

pub fn parse_code(s: &str) -> Option<Levels> {
    let rest = s.strip_prefix("levels:v1:")?;
    let mut parts = rest.split(',');
    let mut field = |name: &str| parts.next().and_then(|p| p.strip_prefix(name)).and_then(|p| p.strip_prefix('='));
    let approvals = Level::of(field("approvals")?)?;
    let code = Level::of(field("code")?)?;
    let join = Level::of(field("join")?)?;
    let idle_text = field("idle")?;
    if parts.next().is_some() || idle_text.is_empty() || idle_text.len() > 4 || !idle_text.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let idle: u32 = idle_text.parse().ok()?;
    let l = Levels { approvals, code, join, idle };
    (floored(l) == l).then_some(l)
}

/// The levels as kept, and when they last changed here (unix seconds): a lowering signed before that doesn't count.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct Kept {
    pub levels: Levels,
    pub since: u64,
}

/// What is kept at `path`; missing is the defaults (approving code at the passcode on a device that already asked one
/// before levels existed, as it did then); unreadable is an error, so nothing quietly drops to the defaults.
pub fn read_kept(path: &Path, passcode_kept: bool) -> Result<Kept, Refusal> {
    match std::fs::read(path) {
        Ok(b) => serde_json::from_slice::<Kept>(&b).map(|k| Kept { levels: floored(k.levels), ..k }).map_err(|_| no("storage", "This device's security levels can't be read.")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            Ok(Kept { levels: if passcode_kept { Levels { code: Level::Passcode, ..DEFAULTS } } else { DEFAULTS }, since: 0 })
        }
        Err(_) => Err(no("storage", "This device's security levels can't be read.")),
    }
}

/// What a lowering's approval must be to count here: a kind 30479 whose signature holds, signed by `own` (the key this
/// device holds), approving the security subject, dated after `kept.since` and not ahead of the clock. Its levels.
pub fn adoptable(ev: &Event, own: &PublicKey, kept: &Kept, now: u64) -> Result<Levels, Refusal> {
    let refused = |why: &str| no("refused", format!("That change of security levels doesn't count here: {why}."));
    if ev.kind.as_u16() != APPROVAL_KIND {
        return Err(refused("it isn't an approval"));
    }
    if ev.verify().is_err() {
        return Err(refused("its signature doesn't hold"));
    }
    if &ev.pubkey != own {
        return Err(refused("it isn't signed with your key"));
    }
    let c: Value = serde_json::from_str(&ev.content).map_err(|_| refused("it can't be read"))?;
    if c.pointer("/subject/applet").and_then(Value::as_str) != Some(SECURITY_SUBJECT) || c.get("approved").and_then(Value::as_bool) != Some(true) {
        return Err(refused("it isn't about security levels"));
    }
    let at = ev.created_at.as_secs();
    if at > now + SKEW_S {
        return Err(refused("it is dated in the future"));
    }
    if at <= kept.since {
        return Err(refused("this device changed its levels after it was signed"));
    }
    c.get("code").and_then(Value::as_str).and_then(parse_code).ok_or_else(|| refused("it names no levels"))
}

/// What an action at `level` asks, in order: this device's passcode (checked here, every time), then the device
/// unlock (`unlock`: keyring.rs `confirm`, where a grace may cover a routine one). `none` asks nothing. A passcode
/// level on a device with no passcode is refused: the unlock alone never stands in for it. Whether a grace covered it.
pub async fn pass<F, Fut>(level: Level, passcode: &Path, codes: &PasscodeState, typed: Option<&str>, unlock: F) -> Result<bool, Refusal>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<bool, Refusal>>,
{
    match level {
        Level::None => Ok(false),
        Level::Unlock => unlock().await,
        Level::Passcode => {
            if !crate::approve::passcode_kept(passcode)? {
                return Err(no("passcode_unset", "This asks your passcode, and this device has none yet: set one in Settings → Security."));
            }
            codes.check(passcode, typed)?;
            unlock().await
        }
    }
}

// ── the idle lock ──

/// Is it past the idle lock? `last`: the last touch counted (unix ms). None, or a clock gone backwards, counts as past.
pub fn lapsed(idle_min: u32, last: Option<u64>, now: u64) -> bool {
    if idle_min == 0 {
        return false;
    }
    match last {
        None => true,
        Some(l) => now < l || now - l >= u64::from(idle_min) * 60_000,
    }
}

/// The idle clock: the last touch counted and whether Parachute is locked. Locked stays locked until the unlock.
#[derive(Default, Clone, Copy, Debug, PartialEq, Eq)]
pub struct Idle {
    pub last: Option<u64>,
    pub locked: bool,
}

impl Idle {
    /// A real touch at `now`: first the check below (a quiet time past the lock locks, and the touch then doesn't
    /// open it), then the touch counts. Whether it is locked.
    pub fn touch(&mut self, idle_min: u32, now: u64, native: Option<(u64, u64)>) -> bool {
        if self.check(idle_min, now, native) {
            return true;
        }
        self.last = Some(self.last.map_or(now, |l| l.max(now)));
        false
    }

    /// Whether it is locked now: the time since the last touch counted (or the native side's newest, when no later than
    /// now), and the native side's longest quiet gap between two touches since it was last asked (`native`: newest
    /// touch, gap; unix ms).
    pub fn check(&mut self, idle_min: u32, now: u64, native: Option<(u64, u64)>) -> bool {
        if self.locked {
            return true;
        }
        let gap = native.map_or(0, |(_, g)| g);
        // the native side's newest touch counts when it is no later than now and no quiet gap before it was too long
        let newest = native.map(|(l, _)| l).filter(|l| *l <= now);
        let last = match (self.last, newest) {
            (Some(a), Some(b)) => Some(a.max(b)),
            (a, b) => a.or(b),
        };
        if idle_min > 0 && (lapsed(idle_min, last, now) || gap >= u64::from(idle_min) * 60_000) {
            self.locked = true;
            return true;
        }
        self.last = last;
        false
    }

    pub fn unlocked(&mut self, now: u64) {
        *self = Idle { last: Some(now), locked: false };
    }

    /// How long until it locks with no touch (ms); None with no idle lock or when locked.
    pub fn left(&self, idle_min: u32, now: u64) -> Option<u64> {
        if idle_min == 0 || self.locked {
            return None;
        }
        let last = self.last?;
        Some((last + u64::from(idle_min) * 60_000).saturating_sub(now))
    }
}

#[derive(Serialize, Deserialize, Default)]
struct IdleKept {
    last: u64,
}

struct Inner {
    kept: Option<Kept>,
    idle: Idle,
    /// Whether the idle clock has been read from disk this run.
    idle_read: bool,
    written: u64,
}

pub struct LevelsState(tokio::sync::Mutex<Inner>);

impl Default for LevelsState {
    fn default() -> Self {
        LevelsState(tokio::sync::Mutex::new(Inner { kept: None, idle: Idle::default(), idle_read: false, written: 0 }))
    }
}

fn data_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, Refusal> {
    app.path().app_data_dir().map_err(|_| no("storage", "The app's data folder isn't available."))
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

#[derive(Serialize, Clone, Copy, Debug)]
pub struct Status {
    pub levels: Levels,
    /// Whether this device keeps a passcode.
    pub passcode: bool,
    /// Whether Parachute is locked (the idle lock), and how long until it locks with no touch (ms).
    pub locked: bool,
    pub left_ms: Option<u64>,
}

impl LevelsState {
    async fn kept<R: Runtime>(&self, app: &AppHandle<R>, inner: &mut Inner) -> Result<Kept, Refusal> {
        if let Some(k) = inner.kept {
            return Ok(k);
        }
        let dir = data_dir(app)?;
        let k = read_kept(&dir.join(LEVELS_FILE), crate::approve::passcode_kept(&dir.join(crate::approve::PASSCODE_FILE))?)?;
        inner.kept = Some(k);
        Ok(k)
    }

    fn write(app_dir: &Path, k: &Kept) -> Result<(), Refusal> {
        crate::services::write_json(&app_dir.join(LEVELS_FILE), k).map_err(|_| no("storage", "This device's security levels couldn't be kept."))
    }

    /// The levels now (each action's level is read here, at the moment it is asked).
    pub async fn levels<R: Runtime>(&self, app: &AppHandle<R>) -> Result<Levels, Refusal> {
        let mut g = self.0.lock().await;
        Ok(self.kept(app, &mut g).await?.levels)
    }

    /// The idle clock, read from disk once a run: a last touch past the lock (or none, with the lock on) starts locked.
    async fn idle<R: Runtime>(&self, app: &AppHandle<R>, inner: &mut Inner) -> Result<u32, Refusal> {
        let min = self.kept(app, inner).await?.levels.idle;
        if !inner.idle_read {
            inner.idle_read = true;
            let kept: Option<IdleKept> = std::fs::read(data_dir(app)?.join(IDLE_FILE)).ok().and_then(|b| serde_json::from_slice(&b).ok());
            let last = kept.map(|k| k.last).filter(|l| *l > 0);
            inner.idle = Idle { last, locked: lapsed(min, last, now_ms()) };
        }
        Ok(min)
    }

    fn keep_idle<R: Runtime>(app: &AppHandle<R>, inner: &mut Inner, now: u64, force: bool) {
        if let Some(last) = inner.idle.last {
            if force || now.saturating_sub(inner.written) >= WRITE_EVERY_MS {
                inner.written = now;
                if let Ok(dir) = data_dir(app) {
                    let _ = crate::services::write_json(&dir.join(IDLE_FILE), &IdleKept { last });
                }
            }
        }
    }

    async fn status<R: Runtime>(&self, app: &AppHandle<R>, touched: bool) -> Result<Status, Refusal> {
        let native = platform::touches(app).await;
        let mut g = self.0.lock().await;
        let min = self.idle(app, &mut g).await?;
        let now = now_ms();
        let was = g.idle.locked;
        let locked = if touched { g.idle.touch(min, now, native) } else { g.idle.check(min, now, native) };
        if locked && !was {
            // the lock ends any grace an unlock earned
            if let Some(ring) = app.try_state::<KeyringState>() {
                ring.end_grace();
            }
        }
        Self::keep_idle(app, &mut g, now, false);
        let dir = data_dir(app)?;
        Ok(Status { levels: self.kept(app, &mut g).await?.levels, passcode: crate::approve::passcode_kept(&dir.join(crate::approve::PASSCODE_FILE))?, locked, left_ms: g.idle.left(min, now) })
    }

    /// The gate every leveled action goes through: refused while Parachute is locked, then `pass` (the passcode this
    /// device keeps, when the level asks it; then `unlock`). Whether a grace covered the unlock.
    pub async fn gate<R: Runtime, F, Fut>(&self, app: &AppHandle<R>, level: Level, typed: Option<&str>, unlock: F) -> Result<bool, Refusal>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<bool, Refusal>>,
    {
        if self.locked(app).await {
            return Err(no("locked", "Parachute is locked. Unlock it first."));
        }
        let path = data_dir(app)?.join(crate::approve::PASSCODE_FILE);
        let codes = app.try_state::<PasscodeState>().ok_or_else(|| no("storage", "The passcode isn't ready."))?;
        pass(level, &path, &codes, typed, unlock).await
    }

    /// Whether Parachute is locked now (keyring.rs refuses every unlock-gated call meanwhile).
    pub async fn locked<R: Runtime>(&self, app: &AppHandle<R>) -> bool {
        self.status(app, false).await.map(|s| s.locked).unwrap_or(true)
    }

    async fn set<R: Runtime>(&self, app: &AppHandle<R>, levels: Levels, since: u64) -> Result<Levels, Refusal> {
        let mut g = self.0.lock().await;
        let was = self.kept(app, &mut g).await?;
        let k = Kept { levels: floored(levels), since: since.max(was.since) };
        Self::write(&data_dir(app)?, &k)?;
        g.kept = Some(k);
        // an idle lock just turned on starts from now, not from a touch before it
        if was.levels.idle == 0 && k.levels.idle > 0 && !g.idle.locked {
            let now = now_ms();
            g.idle.last = Some(g.idle.last.unwrap_or(now).max(now));
            Self::keep_idle(app, &mut g, now, true);
        }
        Ok(k.levels)
    }
}

fn now_s() -> u64 {
    now_ms() / 1000
}

// ── the commands ──

#[tauri::command]
pub async fn levels_status<R: Runtime>(app: AppHandle<R>, levels: State<'_, LevelsState>) -> Result<Status, Refusal> {
    levels.status(&app, false).await
}

/// Raise this device's levels to what a record (or the person) asks, where that is stricter. Never lowers; asks nothing.
#[tauri::command]
pub async fn levels_raise<R: Runtime>(app: AppHandle<R>, levels: State<'_, LevelsState>, asked: Asked) -> Result<Levels, Refusal> {
    let cur = levels.levels(&app).await?;
    let next = raise(cur, &asked);
    if next == cur {
        return Ok(cur);
    }
    levels.set(&app, next, now_s()).await
}

/// Lower (or set) this device's levels, with the person's signed approval: `content` is the approval (src/shell/levels.ts
/// `lowering`), naming the levels in its `code`. The passcode when this device has one, then the device unlock, then
/// the key signs it; the levels are kept here and the signed approval handed back for the vault, where the person's
/// other devices find it.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn levels_lower<R: Runtime>(app: AppHandle<R>, keys: State<'_, KeyState>, ring: State<'_, KeyringState>, levels: State<'_, LevelsState>, content: String, d: String, passcode: Option<String>) -> Result<Event, Refusal> {
    crate::approve::check_content(&content, &d)?;
    let c: Value = serde_json::from_str(&content).map_err(|_| no("bad_request", "An approval is JSON."))?;
    if c.pointer("/subject/applet").and_then(Value::as_str) != Some(SECURITY_SUBJECT) || c.get("approved").and_then(Value::as_bool) != Some(true) {
        return Err(no("bad_request", "That isn't a change of security levels."));
    }
    let next = c.get("code").and_then(Value::as_str).and_then(parse_code).ok_or_else(|| no("bad_request", "That names no security levels."))?;
    let passcode = passcode.map(Zeroizing::new);
    let level = if crate::approve::passcode_kept(&data_dir(&app)?.join(crate::approve::PASSCODE_FILE))? { Level::Passcode } else { Level::Unlock };
    let reason = format!("Change how careful Parachute is on every device of yours: {}", plain(next));
    levels.gate(&app, level, passcode.as_ref().map(|p| p.as_str()), || ring.confirm(&app, "settings", "levels", false, "Change your security", &reason)).await?;
    let k = keys.get(&app).await.map_err(|m| no("no_key", m))?.ok_or_else(|| no("no_key", "This device has no key."))?;
    let ev = crate::services::sign_template(&k, APPROVAL_KIND, &content, &[vec!["d".into(), d]])?;
    levels.set(&app, next, ev.created_at.as_secs()).await?;
    Ok(ev)
}

/// Take a lowering another device of the person's signed (read from the vault by the web side): only when it counts
/// here (`adoptable`).
#[tauri::command]
pub async fn levels_adopt<R: Runtime>(app: AppHandle<R>, keys: State<'_, KeyState>, levels: State<'_, LevelsState>, event: Value) -> Result<Levels, Refusal> {
    let ev = Event::from_json(event.to_string()).map_err(|_| no("bad_params", "An approval is a signed event."))?;
    let own = keys.get(&app).await.map_err(|m| no("no_key", m))?.ok_or_else(|| no("no_key", "This device has no key."))?.public_key();
    let kept = {
        let mut g = levels.0.lock().await;
        levels.kept(&app, &mut g).await?
    };
    let next = adoptable(&ev, &own, &kept, now_s())?;
    levels.set(&app, next, ev.created_at.as_secs()).await
}

/// A real touch, as the web side saw it (its own input, or a call from an applet during the person's activation).
#[tauri::command]
pub async fn idle_touch<R: Runtime>(app: AppHandle<R>, levels: State<'_, LevelsState>) -> Result<Status, Refusal> {
    levels.status(&app, true).await
}

/// Open Parachute again after the idle lock: the device unlock, always (no grace).
#[tauri::command]
pub async fn idle_unlock<R: Runtime>(app: AppHandle<R>, ring: State<'_, KeyringState>, levels: State<'_, LevelsState>) -> Result<Status, Refusal> {
    ring.ask(&app, "idle", "idle", false, "Open Parachute", "Unlock to open Parachute").await?;
    // the native gap of the quiet time before is spent here: it was what locked it
    let _ = platform::touches(&app).await;
    {
        let mut g = levels.0.lock().await;
        let now = now_ms();
        g.idle.unlocked(now);
        LevelsState::keep_idle(&app, &mut g, now, true);
    }
    levels.status(&app, false).await
}

/// The levels in the words the unlock prompt shows.
fn plain(l: Levels) -> String {
    let w = |x: Level| match x {
        Level::None => "a tap",
        Level::Unlock => "your unlock",
        Level::Passcode => "your passcode",
    };
    let idle = if l.idle == 0 { "never locks".to_string() } else { format!("locks after {} min", l.idle) };
    format!("approvals take {}, approving code {}, joining a network {}; Parachute {idle}.", w(l.approvals), w(l.code), w(l.join))
}

mod platform {
    use tauri::{AppHandle, Runtime};

    /// Android: the activity's newest touch (unix ms) and the longest quiet gap between two touches since last asked
    /// (gen/android/.../UnlockPlugin.kt). Elsewhere none: the web side reports touches.
    pub async fn touches<R: Runtime>(_app: &AppHandle<R>) -> Option<(u64, u64)> {
        #[cfg(target_os = "android")]
        {
            use tauri::Manager;
            #[derive(serde::Deserialize)]
            struct T {
                last: u64,
                gap: u64,
            }
            let h = _app.try_state::<crate::android::UnlockPluginHandle<R>>()?.0.clone();
            let t: T = h.run_mobile_plugin_async("touches", serde_json::json!({})).await.ok()?;
            (t.last > 0).then_some((t.last, t.gap))
        }
        #[cfg(not(target_os = "android"))]
        {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nostr::{EventBuilder, Keys, Kind, Tag, Timestamp};

    const MIN: u64 = 60_000;

    #[test]
    fn a_record_raises_a_device_and_never_lowers_it() {
        let strict = Levels { approvals: Level::Passcode, code: Level::Passcode, join: Level::Passcode, idle: 5 };
        // everything a record could say that is looser leaves the device as it is
        for asked in [
            Asked { approvals: Some(Level::None), code: Some(Level::None), join: Some(Level::None), idle: Some(0) },
            Asked { approvals: Some(Level::Unlock), code: Some(Level::Unlock), join: Some(Level::Unlock), idle: Some(60) },
            Asked { idle: Some(IDLE_MAX + 1), ..Asked::default() },
            Asked::default(),
        ] {
            assert_eq!(raise(strict, &asked), strict, "{asked:?}");
        }
        // stricter is taken, field by field
        let r = raise(DEFAULTS, &Asked { approvals: Some(Level::Passcode), idle: Some(10), ..Asked::default() });
        assert_eq!(r, Levels { approvals: Level::Passcode, code: Level::Unlock, join: Level::Passcode, idle: 10 });
        assert_eq!(raise(r, &Asked { idle: Some(3), ..Asked::default() }).idle, 3, "a shorter idle lock is stricter");
        assert_eq!(raise(r, &Asked { idle: Some(30), ..Asked::default() }).idle, 10);
        // a record naming "none" for code still leaves the unlock
        assert_eq!(raise(Levels { code: Level::None, ..DEFAULTS }, &Asked::default()).code, Level::Unlock);
        assert!(loosens(strict, DEFAULTS));
        assert!(loosens(Levels { idle: 5, ..DEFAULTS }, Levels { idle: 0, ..DEFAULTS }), "turning the idle lock off loosens");
        assert!(loosens(Levels { idle: 5, ..DEFAULTS }, Levels { idle: 10, ..DEFAULTS }));
        assert!(!loosens(DEFAULTS, Levels { idle: 5, ..DEFAULTS }));
        // what a record says in JSON: unknown words or fields are refused, not read as "none"
        assert!(serde_json::from_str::<Asked>(r#"{"approvals":"nothing"}"#).is_err());
        assert!(serde_json::from_str::<Asked>(r#"{"approve":"none"}"#).is_err());
    }

    #[test]
    fn the_levels_text_reads_back_exactly() {
        let l = Levels { approvals: Level::None, code: Level::Passcode, join: Level::Unlock, idle: 15 };
        // the web side writes the same text (src/shell/levels.test.ts has this line)
        assert_eq!(code_of(l), "levels:v1:approvals=none,code=passcode,join=unlock,idle=15");
        assert_eq!(parse_code(&code_of(l)), Some(l));
        assert_eq!(parse_code(&code_of(DEFAULTS)), Some(DEFAULTS));
        for bad in [
            "levels:v1:approvals=none,code=none,join=unlock,idle=15", // code below the unlock
            "levels:v1:approvals=none,code=unlock,join=unlock,idle=99999",
            "levels:v1:approvals=none,code=unlock,join=unlock,idle=15,extra=1",
            "levels:v1:code=unlock,approvals=none,join=unlock,idle=15",
            "levels:v1:approvals=none,code=unlock,join=unlock,idle=-1",
            "levels:v2:approvals=none,code=unlock,join=unlock,idle=1",
            "tsx:abc",
        ] {
            assert_eq!(parse_code(bad), None, "{bad}");
        }
    }

    async fn yes(called: &std::cell::Cell<bool>) -> Result<bool, Refusal> {
        called.set(true);
        Ok(false)
    }

    fn passcode_at(code: Option<&str>) -> (PathBuf, PasscodeState) {
        let d = std::env::temp_dir().join(format!("parachute-levels-{}-{}", std::process::id(), nostr::secp256k1::rand::random::<u64>()));
        std::fs::create_dir_all(&d).unwrap();
        let p = d.join(crate::approve::PASSCODE_FILE);
        let s = PasscodeState::default();
        if let Some(c) = code {
            crate::approve::set(&p, &s, None, Some(c)).unwrap();
        }
        (p, s)
    }

    #[tokio::test]
    async fn a_passcode_level_refuses_the_device_unlock_alone() {
        let (p, s) = passcode_at(Some("garden-gate"));
        let unlocked = std::cell::Cell::new(false);
        // the unlock would pass; without the passcode, or with a wrong one, it isn't even asked
        let e = pass(Level::Passcode, &p, &s, None, || yes(&unlocked)).await.unwrap_err();
        assert_eq!(e.code, "passcode");
        assert!(!unlocked.get());
        assert_eq!(pass(Level::Passcode, &p, &s, Some("garden-gat"), || yes(&unlocked)).await.unwrap_err().code, "passcode");
        assert!(!unlocked.get());
        // the passcode, then the unlock
        pass(Level::Passcode, &p, &s, Some("garden-gate"), || yes(&unlocked)).await.unwrap();
        assert!(unlocked.get());
        // the passcode alone isn't enough either: a refused unlock refuses
        let e = pass(Level::Passcode, &p, &s, Some("garden-gate"), || async { Err(no("unlock", "cancelled")) }).await.unwrap_err();
        assert_eq!(e.code, "unlock");
        // a device with no passcode can't pass a passcode level with its unlock
        let (none, s2) = passcode_at(None);
        let unlocked = std::cell::Cell::new(false);
        assert_eq!(pass(Level::Passcode, &none, &s2, Some("anything"), || yes(&unlocked)).await.unwrap_err().code, "passcode_unset");
        assert!(!unlocked.get());
        // the unlock level asks only the unlock; none asks nothing
        pass(Level::Unlock, &none, &s2, None, || yes(&unlocked)).await.unwrap();
        assert!(unlocked.get());
        let asked = std::cell::Cell::new(false);
        pass(Level::None, &none, &s2, None, || yes(&asked)).await.unwrap();
        assert!(!asked.get());
    }

    #[test]
    fn the_idle_lock_engages_after_its_minutes_and_a_touch_never_opens_it() {
        let t0 = 1_800_000_000_000u64;
        let mut i = Idle { last: Some(t0), locked: false };
        assert!(!i.check(5, t0 + 5 * MIN - 1, None));
        assert_eq!(i.left(5, t0 + 4 * MIN), Some(MIN));
        assert!(i.check(5, t0 + 5 * MIN, None), "five minutes untouched: locked");
        assert!(i.touch(5, t0 + 5 * MIN + 1, None), "a touch doesn't open it");
        assert!(i.check(5, t0 + 6 * MIN, Some((t0 + 6 * MIN, 0))), "nor the native side's touches");
        i.unlocked(t0 + 7 * MIN);
        assert!(!i.check(5, t0 + 8 * MIN, None));
        // touches keep it open
        let mut i = Idle { last: Some(t0), locked: false };
        for m in 1..30 {
            assert!(!i.touch(5, t0 + m * MIN, None));
        }
        // the first touch after a quiet time past the lock locks (the web side's touch is the check)
        assert!(i.touch(5, t0 + 40 * MIN, None));
        // off: never
        let mut i = Idle { last: Some(t0), locked: false };
        assert!(!i.check(0, t0 + 1000 * MIN, None));
        // no touch known (a first start with the lock on), or a clock gone backwards: locked
        assert!(Idle::default().check(5, t0, None));
        assert!(Idle { last: Some(t0), locked: false }.check(5, t0 - 1, None));
    }

    #[test]
    fn android_touches_keep_it_open_but_a_long_quiet_gap_between_them_locks() {
        let t0 = 1_800_000_000_000u64;
        // scrolling in an applet (no web-side touch): the activity's newest touch counts
        let mut i = Idle { last: Some(t0), locked: false };
        assert!(!i.check(5, t0 + 9 * MIN, Some((t0 + 8 * MIN, 2 * MIN))));
        assert_eq!(i.last, Some(t0 + 8 * MIN));
        // a quiet gap of five minutes between two touches locks, even if the newest touch is recent
        assert!(i.check(5, t0 + 20 * MIN, Some((t0 + 19 * MIN, 6 * MIN))));
        // a touch from the future (another clock) doesn't count
        let mut i = Idle { last: Some(t0), locked: false };
        assert!(i.check(5, t0 + 6 * MIN, Some((t0 + 60 * MIN, 0))));
    }

    fn approval(keys: &Keys, code: &str, at: u64, applet: &str) -> Event {
        let content = serde_json::json!({ "v": 1, "subject": { "hub": "https://hub.example", "vault": "home", "record": "security-uni", "applet": applet }, "n": at, "approved": true, "code": code, "scope": "", "at": "x", "expires": "y" });
        EventBuilder::new(Kind::from(APPROVAL_KIND), content.to_string())
            .tags([Tag::parse(["d", "https://hub.example|home|security-uni"]).unwrap()])
            .custom_created_at(Timestamp::from(at))
            .sign_with_keys(keys)
            .unwrap()
    }

    #[test]
    fn an_unsigned_or_old_or_foreign_lowering_weakens_nothing() {
        let me = Keys::generate();
        let now = 1_800_000_000u64;
        let kept = Kept { levels: Levels { idle: 5, join: Level::Passcode, ..DEFAULTS }, since: now - 100 };
        let off = Levels { idle: 0, join: Level::Unlock, ..DEFAULTS };
        let good = approval(&me, &code_of(off), now - 10, SECURITY_SUBJECT);
        assert_eq!(adoptable(&good, &me.public_key(), &kept, now).unwrap(), off);
        // its levels edited after signing: the signature breaks
        let mut edited = good.clone();
        edited.content = edited.content.replace("join=unlock", "join=none");
        assert!(adoptable(&edited, &me.public_key(), &kept, now).is_err());
        // signed by someone else's key (a vault writer, an agent)
        let other = approval(&Keys::generate(), &code_of(off), now - 10, SECURITY_SUBJECT);
        assert!(adoptable(&other, &me.public_key(), &kept, now).is_err());
        // signed before this device last changed its levels (an old approval put back)
        let old = approval(&me, &code_of(off), now - 200, SECURITY_SUBJECT);
        assert!(adoptable(&old, &me.public_key(), &kept, now).is_err());
        // an applet's code approval moved over
        assert!(adoptable(&approval(&me, &code_of(off), now - 10, "rooms"), &me.public_key(), &kept, now).is_err());
        assert!(adoptable(&approval(&me, "tsx:abc", now - 10, SECURITY_SUBJECT), &me.public_key(), &kept, now).is_err());
        // dated ahead of the clock, to block later changes
        assert!(adoptable(&approval(&me, &code_of(off), now + 3600, SECURITY_SUBJECT), &me.public_key(), &kept, now).is_err());
    }

    #[test]
    fn missing_levels_are_the_defaults_and_a_device_that_asked_a_passcode_keeps_asking_it() {
        let d = std::env::temp_dir().join(format!("parachute-levels-read-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        let p = d.join(LEVELS_FILE);
        let _ = std::fs::remove_file(&p);
        assert_eq!(read_kept(&p, false).unwrap().levels, DEFAULTS);
        assert_eq!(read_kept(&p, true).unwrap().levels.code, Level::Passcode);
        std::fs::write(&p, b"not json").unwrap();
        assert!(read_kept(&p, false).is_err(), "unreadable is an error, never the defaults");
    }
}
