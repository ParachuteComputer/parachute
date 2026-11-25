// What each applet saved on this device (docs/WRITE-AN-APPLET.md "Saved state"): its drafts, where it was, and what
// it keeps with `storage`. One file per applet in the app's data folder, written whole each time, synced to disk and
// then renamed over the old one, so a force-stop or a power cut leaves the last whole copy, never half of one. The web
// side hands the JSON as text and checks it first (src/applet/modules/saved.ts, src/shell/saved.ts); this side checks
// only that it is a JSON object within the size, and keeps it. The file's name is a hash of the applet's subject (its
// vault and note on this device), so no subject can name a path.
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime};

/// The most one applet keeps (the web side's limit, with room for JSON's own quoting).
pub const SAVED_MAX: usize = 300 * 1024;
const DIR: &str = "saved";

#[derive(Serialize, Debug)]
pub struct Refusal {
    code: &'static str,
    message: String,
}
fn no(code: &'static str, message: impl Into<String>) -> Refusal {
    Refusal { code, message: message.into() }
}

pub(crate) fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// The file an applet's saved state is kept in: `<dir>/<sha256 of the subject>.json`.
pub fn file_for(dir: &Path, subject: &str) -> PathBuf {
    use nostr::hashes::{sha256, Hash};
    dir.join(format!("{}.json", hex(sha256::Hash::hash(subject.as_bytes()).as_byte_array())))
}

fn dir_of<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, Refusal> {
    Ok(app.path().app_data_dir().map_err(|_| no("storage", "The app's data folder isn't available."))?.join(DIR))
}

fn subject_ok(s: &str) -> bool {
    !s.is_empty() && s.len() <= 1000
}

/// What was kept for this subject: the JSON text, or `{}` when nothing was.
pub fn read(dir: &Path, subject: &str) -> Result<String, Refusal> {
    match std::fs::read(file_for(dir, subject)) {
        Ok(b) => match serde_json::from_slice::<serde_json::Value>(&b) {
            Ok(v) if v.is_object() => Ok(String::from_utf8(b).unwrap_or_else(|_| "{}".into())),
            // what can't be read is nothing saved, not an error the applet could do anything about
            _ => Ok("{}".into()),
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok("{}".into()),
        Err(_) => Err(no("storage", "What this applet saved can't be read.")),
    }
}

/// Keep `json` (a JSON object) for this subject; an empty object removes the file.
pub fn write(dir: &Path, subject: &str, json: &str) -> Result<(), Refusal> {
    if json.len() > SAVED_MAX {
        return Err(no("too_large", "What this applet saved is more than it may keep."));
    }
    let v: serde_json::Value = serde_json::from_str(json).map_err(|_| no("bad_request", "Saved state must be JSON."))?;
    let Some(obj) = v.as_object() else { return Err(no("bad_request", "Saved state must be a JSON object.")) };
    let path = file_for(dir, subject);
    if obj.is_empty() {
        return match std::fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err(no("storage", "What this applet saved can't be cleared.")),
        };
    }
    std::fs::create_dir_all(dir).map_err(|_| no("storage", "The app's data folder can't be written."))?;
    let tmp = path.with_extension("json.tmp");
    let done = (|| -> std::io::Result<()> {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(json.as_bytes())?;
        f.sync_all()?;
        std::fs::rename(&tmp, &path)?;
        // the rename on disk too, so a power cut can't bring the older copy back
        if let Ok(d) = std::fs::File::open(dir) {
            let _ = d.sync_all();
        }
        Ok(())
    })();
    done.map_err(|_| {
        let _ = std::fs::remove_file(&tmp);
        no("storage", "What this applet saved couldn't be written.")
    })
}

#[tauri::command]
pub async fn saved_get<R: Runtime>(app: AppHandle<R>, subject: String) -> Result<String, Refusal> {
    if !subject_ok(&subject) {
        return Err(no("bad_request", "No such applet."));
    }
    read(&dir_of(&app)?, &subject)
}

#[tauri::command]
pub async fn saved_put<R: Runtime>(app: AppHandle<R>, subject: String, json: String) -> Result<(), Refusal> {
    if !subject_ok(&subject) {
        return Err(no("bad_request", "No such applet."));
    }
    write(&dir_of(&app)?, &subject, &json)
}

// ── Files an applet keeps until they are sent (a recording, a picture: T-476) ──
// Beside its saved state, in a folder of its own (`<dir>/<sha256 of the subject>.files/`), one file a key, named by the
// key's hash so no key can name a path. Written whole (synced, then renamed) like the saved state; 25 MB a file and
// 100 MB in all for one applet. The web side checks the same (src/applet/modules/storage.ts); its key list is kept here
// beside the files (`keys.json`), so the files' own names never need to be read back as keys.

/** One file it keeps. */
pub const FILE_MAX: usize = 25 * 1024 * 1024;
/** All of one applet's files. */
pub const FILES_MAX: u64 = 100 * 1024 * 1024;

fn files_dir(dir: &Path, subject: &str) -> PathBuf {
    file_for(dir, subject).with_extension("files")
}
fn key_file(dir: &Path, subject: &str, key: &str) -> PathBuf {
    use nostr::hashes::{sha256, Hash};
    files_dir(dir, subject).join(hex(sha256::Hash::hash(key.as_bytes()).as_byte_array()))
}
fn key_ok(k: &str) -> bool {
    !k.is_empty() && k.chars().count() <= 100
}
fn synced_write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_extension("tmp");
    let done = (|| -> std::io::Result<()> {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        std::fs::rename(&tmp, path)?;
        if let Some(d) = path.parent().and_then(|p| std::fs::File::open(p).ok()) {
            let _ = d.sync_all();
        }
        Ok(())
    })();
    if done.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    done
}

/** The keys of the files it keeps, sorted. */
pub fn file_keys(dir: &Path, subject: &str) -> Vec<String> {
    let mut keys: Vec<String> = std::fs::read(files_dir(dir, subject).join("keys.json")).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
    // only those whose file is there (a write that stopped between the file and the list)
    keys.retain(|k| key_file(dir, subject, k).is_file());
    keys.sort();
    keys.dedup();
    keys
}
fn write_keys(dir: &Path, subject: &str, keys: &[String]) -> Result<(), Refusal> {
    synced_write(&files_dir(dir, subject).join("keys.json"), serde_json::to_string(keys).unwrap_or_else(|_| "[]".into()).as_bytes()).map_err(|_| no("storage", "The files this applet keeps can't be listed."))
}

/** Keep `bytes` under `key` (replacing what was there). */
pub fn put_file(dir: &Path, subject: &str, key: &str, bytes: &[u8]) -> Result<(), Refusal> {
    if !key_ok(key) {
        return Err(no("bad_request", "A file's key is 1 to 100 characters."));
    }
    if bytes.len() > FILE_MAX {
        return Err(no("too_large", "A file it keeps is 25 MB at most."));
    }
    let mut keys = file_keys(dir, subject);
    let others: u64 = keys.iter().filter(|k| k.as_str() != key).filter_map(|k| std::fs::metadata(key_file(dir, subject, k)).ok()).map(|m| m.len()).sum();
    if others + bytes.len() as u64 > FILES_MAX {
        return Err(no("too_large", "The files this applet keeps on this device are full (100 MB)."));
    }
    std::fs::create_dir_all(files_dir(dir, subject)).map_err(|_| no("storage", "The app's data folder can't be written."))?;
    synced_write(&key_file(dir, subject, key), bytes).map_err(|_| no("storage", "The file couldn't be kept."))?;
    if !keys.iter().any(|k| k == key) {
        keys.push(key.to_string());
        write_keys(dir, subject, &keys)?;
    }
    Ok(())
}

/** The file kept under `key`, or None. */
pub fn get_file(dir: &Path, subject: &str, key: &str) -> Result<Option<Vec<u8>>, Refusal> {
    if !key_ok(key) {
        return Ok(None);
    }
    match std::fs::read(key_file(dir, subject, key)) {
        Ok(b) => Ok(Some(b)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(no("storage", "The file it kept can't be read.")),
    }
}

/** Forget the file under `key` (nothing there: nothing to do). */
pub fn drop_file(dir: &Path, subject: &str, key: &str) -> Result<(), Refusal> {
    if !key_ok(key) {
        return Ok(());
    }
    let mut keys = file_keys(dir, subject);
    let had = keys.len();
    keys.retain(|k| k != key);
    if keys.len() != had {
        write_keys(dir, subject, &keys)?;
    }
    match std::fs::remove_file(key_file(dir, subject, key)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(no("storage", "The file it kept can't be removed.")),
    }
}

/** Every file it keeps, gone (Revoke, signing out of its vault). */
pub fn clear_files(dir: &Path, subject: &str) -> Result<(), Refusal> {
    match std::fs::remove_dir_all(files_dir(dir, subject)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(no("storage", "The files it kept can't be removed.")),
    }
}

use nostr::base64::{engine::general_purpose::STANDARD as B64, Engine};

#[tauri::command]
pub async fn saved_file_put<R: Runtime>(app: AppHandle<R>, subject: String, key: String, body: String) -> Result<(), Refusal> {
    if !subject_ok(&subject) {
        return Err(no("bad_request", "No such applet."));
    }
    if body.len() > FILE_MAX.div_ceil(3) * 4 {
        return Err(no("too_large", "A file it keeps is 25 MB at most."));
    }
    let bytes = B64.decode(body.as_bytes()).map_err(|_| no("bad_request", "A file comes as base64."))?;
    put_file(&dir_of(&app)?, &subject, &key, &bytes)
}

#[tauri::command]
pub async fn saved_file_get<R: Runtime>(app: AppHandle<R>, subject: String, key: String) -> Result<Option<String>, Refusal> {
    if !subject_ok(&subject) {
        return Err(no("bad_request", "No such applet."));
    }
    Ok(get_file(&dir_of(&app)?, &subject, &key)?.map(|b| B64.encode(b)))
}

#[tauri::command]
pub async fn saved_file_drop<R: Runtime>(app: AppHandle<R>, subject: String, key: Option<String>) -> Result<(), Refusal> {
    if !subject_ok(&subject) {
        return Err(no("bad_request", "No such applet."));
    }
    let dir = dir_of(&app)?;
    match key {
        Some(k) => drop_file(&dir, &subject, &k),
        None => clear_files(&dir, &subject),
    }
}

#[tauri::command]
pub async fn saved_file_keys<R: Runtime>(app: AppHandle<R>, subject: String) -> Result<Vec<String>, Refusal> {
    if !subject_ok(&subject) {
        return Err(no("bad_request", "No such applet."));
    }
    Ok(file_keys(&dir_of(&app)?, &subject))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> PathBuf {
        let d = std::env::temp_dir().join(format!("parachute-saved-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn what_is_written_is_read_back_and_an_empty_object_clears_it() {
        let d = tmp();
        assert_eq!(read(&d, "home\0note1").unwrap(), "{}");
        write(&d, "home\0note1", r#"{"draft":"half a thought"}"#).unwrap();
        assert_eq!(read(&d, "home\0note1").unwrap(), r#"{"draft":"half a thought"}"#);
        // another applet's is its own
        assert_eq!(read(&d, "home\0note2").unwrap(), "{}");
        write(&d, "home\0note1", "{}").unwrap();
        assert_eq!(read(&d, "home\0note1").unwrap(), "{}");
        assert!(!file_for(&d, "home\0note1").exists());
    }

    #[test]
    fn only_a_json_object_within_the_size_is_kept_and_no_temp_file_is_left() {
        let d = tmp();
        write(&d, "s", r#"{"a":1}"#).unwrap();
        assert!(write(&d, "s", "[1,2]").is_err());
        assert!(write(&d, "s", "not json").is_err());
        let big = format!(r#"{{"a":"{}"}}"#, "x".repeat(SAVED_MAX));
        assert!(write(&d, "s", &big).is_err());
        // a refused write leaves the last good copy
        assert_eq!(read(&d, "s").unwrap(), r#"{"a":1}"#);
        let names: Vec<_> = std::fs::read_dir(&d).unwrap().map(|e| e.unwrap().file_name().into_string().unwrap()).collect();
        assert_eq!(names.len(), 1);
        assert!(names[0].ends_with(".json"));
    }

    #[test]
    fn a_subject_never_names_a_path() {
        let d = tmp();
        let f = file_for(&d, "../../etc/passwd");
        assert_eq!(f.parent().unwrap(), d.as_path());
        assert_eq!(f.file_name().unwrap().len(), 64 + 5);
    }

    #[test]
    fn a_garbled_file_reads_as_nothing_saved() {
        let d = tmp();
        std::fs::write(file_for(&d, "s"), b"{half").unwrap();
        assert_eq!(read(&d, "s").unwrap(), "{}");
    }

    #[test]
    fn a_kept_file_is_read_back_listed_dropped_and_cleared_and_another_applets_are_its_own() {
        let d = tmp();
        assert_eq!(get_file(&d, "a", "voice-1").unwrap(), None);
        put_file(&d, "a", "voice-1", b"opus bytes").unwrap();
        put_file(&d, "a", "pic-1", b"png bytes").unwrap();
        put_file(&d, "a", "voice-1", b"opus bytes again").unwrap();
        assert_eq!(get_file(&d, "a", "voice-1").unwrap().as_deref(), Some(&b"opus bytes again"[..]));
        assert_eq!(file_keys(&d, "a"), vec!["pic-1".to_string(), "voice-1".to_string()]);
        assert_eq!(get_file(&d, "b", "voice-1").unwrap(), None);
        drop_file(&d, "a", "voice-1").unwrap();
        assert_eq!(get_file(&d, "a", "voice-1").unwrap(), None);
        assert_eq!(file_keys(&d, "a"), vec!["pic-1".to_string()]);
        // the saved state beside them is untouched, and clearing the files leaves it
        write(&d, "a", r#"{"o":1}"#).unwrap();
        clear_files(&d, "a").unwrap();
        assert!(file_keys(&d, "a").is_empty());
        assert_eq!(read(&d, "a").unwrap(), r#"{"o":1}"#);
    }

    #[test]
    fn kept_files_hold_to_their_sizes_and_a_key_never_names_a_path() {
        let d = tmp();
        assert!(put_file(&d, "a", "big", &vec![0u8; FILE_MAX + 1]).is_err());
        let chunk = vec![1u8; FILE_MAX];
        for i in 0..4 {
            put_file(&d, "a", &format!("f{i}"), &chunk).unwrap();
        }
        // a fifth would pass 100 MB in all; replacing one of the four doesn't
        assert!(put_file(&d, "a", "f4", &chunk).is_err());
        put_file(&d, "a", "f0", &chunk).unwrap();
        assert!(put_file(&d, "a", "", b"x").is_err());
        let f = key_file(&d, "a", "../../etc/passwd");
        assert_eq!(f.parent().unwrap(), files_dir(&d, "a").as_path());
    }
}
