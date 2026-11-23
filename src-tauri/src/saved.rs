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
}
