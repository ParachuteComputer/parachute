//! An applet's links and saved files (docs/design/KEYRING.md "Voice, files, links, storage"). The web side checks
//! each call first (src/applet/files.ts); Rust checks the link and the name again, then does the work:
//! - `open_link`: http, https or mailto, in the system's browser.
//! - `save_file`: into Downloads under a free name ("notes (2).pdf"), never over a file. Desktop writes the folder
//!   itself; Android goes through MediaStore (gen/android/.../FilesPlugin.kt), which needs no storage permission. An
//!   iPhone has no Downloads an app can write to: the file goes into the app's Documents, which the Files app shows as
//!   On My iPhone → Parachute (UIFileSharingEnabled in Info.ios.plist).

use tauri::{AppHandle, Runtime};

/// A saved file: 25 MB at most (FILE_MAX in src/applet/files.ts).
pub const FILE_MAX: usize = 25 * 1024 * 1024;
/// A saved file's name, in characters (NAME_MAX in src/applet/files.ts).
const NAME_MAX: usize = 100;
/// A link, in bytes, as the web side allows.
const LINK_MAX: usize = 2000;

#[cfg(target_os = "android")]
struct FilesHandle<R: Runtime>(tauri::plugin::PluginHandle<R>);

/// Registers the Kotlin `FilesPlugin` on Android; nothing elsewhere. Rust calls it; the web side has no permission.
pub fn plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::<R>::new("parachute-files")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                use tauri::Manager;
                let handle = _api.register_android_plugin("computer.parachute.app", "FilesPlugin")?;
                _app.manage(FilesHandle(handle));
            }
            Ok(())
        })
        .build()
}

/// Characters a name or link may not hide: invisible format marks, bidi controls, variation selectors, private use.
/// (src/applet/contract.ts strips every Unicode Cf/Co/Cn and default-ignorable code point; without Unicode tables this
/// covers the ones in use, and the web side has already applied the full rule.)
fn hidden(c: char) -> bool {
    matches!(c as u32,
        0x00AD | 0x034F | 0x061C | 0x115F..=0x1160 | 0x17B4..=0x17B5 | 0x180B..=0x180F | 0x200B..=0x200F
        | 0x202A..=0x202E | 0x2060..=0x206F | 0x2800 | 0x3164 | 0xFE00..=0xFE0F | 0xFEFF | 0xFFA0 | 0xFFF0..=0xFFFB
        | 0x1BCA0..=0x1BCA3 | 0x1D173..=0x1D17A | 0xE0000..=0xE0FFF | 0xE000..=0xF8FF | 0xF0000..=0x10FFFF)
}

/// A web or mail address that may be opened: http, https or mailto, nothing hidden, no spaces or control characters
/// inside, and a URL that parses (with a host for http and https). The address to open, as parsed.
pub fn checked_link(raw: &str) -> Result<tauri::Url, String> {
    let url = raw.trim();
    let refuse = || Err("Only http, https and mailto links can be opened".to_string());
    if url.is_empty() || url.len() > LINK_MAX || url.chars().any(|c| c.is_control() || c.is_whitespace() || hidden(c)) {
        return refuse();
    }
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://") || lower.starts_with("mailto:")) {
        return refuse();
    }
    let Ok(parsed) = tauri::Url::parse(url) else { return refuse() };
    match parsed.scheme() {
        "mailto" => Ok(parsed),
        "http" | "https" if parsed.host_str().is_some_and(|h| !h.is_empty()) => Ok(parsed),
        _ => refuse(),
    }
}

/// Opens an http, https or mailto link in the system's browser (or mail app).
#[tauri::command]
pub fn open_link<R: Runtime>(app: AppHandle<R>, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let url = checked_link(&url)?;
    app.opener().open_url(url.as_str(), None::<&str>).map_err(|e| format!("Couldn't open the link: {e}"))
}

/// A name reduced to a bare file name, as `bareName` in src/applet/files.ts: no folder, no separator, no leading dot,
/// nothing a file system refuses, at most 100 characters with the extension kept. Never empty.
pub fn bare_name(raw: &str) -> String {
    let clean: String = raw.chars().filter(|&c| !c.is_control() && !hidden(c)).collect();
    let last = clean.rsplit(['/', '\\']).next().unwrap_or("");
    let replaced: String = last.chars().map(|c| if "<>:\"|?*".contains(c) { '_' } else { c }).collect();
    let mut n = replaced.trim().trim_start_matches(|c: char| c == '.' || c.is_whitespace())
        .trim_end_matches(|c: char| c == '.' || c.is_whitespace())
        .to_string();
    // Windows reads CON, NUL, COM1… (any extension) as a device, not a file: "_nul.txt"
    let stem = n.split('.').next().unwrap_or("").trim_end().to_ascii_uppercase();
    let device = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4 && (stem.starts_with("COM") || stem.starts_with("LPT")) && matches!(stem.as_bytes()[3], b'1'..=b'9'));
    if device {
        n.insert(0, '_');
    }
    let len = n.chars().count();
    if len > NAME_MAX {
        // the extension, counted in characters: kept when the dot isn't first and it is at most 11 with the dot
        let ext = match n.rfind('.') {
            Some(dot) if dot > 0 && n[dot..].chars().count() <= 11 => n[dot..].to_string(),
            _ => String::new(),
        };
        let stem: String = n[..n.len() - ext.len()].chars().take(NAME_MAX - ext.chars().count()).collect();
        n = format!("{}{ext}", stem.trim_end());
    }
    if n.is_empty() { "file".into() } else { n }
}

/// The k-th name tried for `name`: the name itself, then "name (2).ext", "name (3).ext"…
#[cfg(any(desktop, target_os = "ios", test))]
fn numbered(name: &str, k: u32) -> String {
    if k <= 1 {
        return name.to_string();
    }
    match name.rfind('.') {
        Some(dot) if dot > 0 => format!("{} ({k}){}", &name[..dot], &name[dot..]),
        _ => format!("{name} ({k})"),
    }
}

/// Writes `bytes` into `dir` as `name`, or the first free numbered name; never over a file that is there. Returns the
/// file name it got.
#[cfg(any(desktop, target_os = "ios", test))]
pub fn save_free(dir: &std::path::Path, name: &str, bytes: &[u8]) -> std::io::Result<String> {
    use std::io::{ErrorKind, Write};
    std::fs::create_dir_all(dir)?;
    for k in 1..=999 {
        let file_name = numbered(name, k);
        let path = dir.join(&file_name);
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut out) => {
                let written = out.write_all(bytes).and_then(|_| out.sync_all());
                if let Err(e) = written {
                    drop(out);
                    let _ = std::fs::remove_file(&path);
                    return Err(e);
                }
                return Ok(file_name);
            }
            Err(e) if e.kind() == ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    }
    Err(std::io::Error::new(ErrorKind::AlreadyExists, "too many files with this name"))
}

/// The file's bytes from base64, refused over 25 MB (before decoding when the text alone says so).
fn decoded(b64: &str) -> Result<Vec<u8>, String> {
    use nostr::base64::{engine::general_purpose::STANDARD, Engine};
    let too_big = || format!("A saved file is at most {} MB", FILE_MAX / (1024 * 1024));
    if b64.len() > FILE_MAX.div_ceil(3) * 4 {
        return Err(too_big());
    }
    let bytes = STANDARD.decode(b64.trim()).map_err(|_| "The file's bytes aren't base64".to_string())?;
    if bytes.len() > FILE_MAX {
        return Err(too_big());
    }
    Ok(bytes)
}

/// Saves a file into the person's Downloads under a free name. `bytes` is base64; returns the name it was saved as.
#[tauri::command]
pub async fn save_file<R: Runtime>(app: AppHandle<R>, name: String, bytes: String, mime: String) -> Result<String, String> {
    if name.trim().is_empty() {
        return Err("A saved file needs a name".into());
    }
    let name = bare_name(&name);
    let bytes = decoded(&bytes)?;
    save(&app, name, bytes, mime).await
}

#[cfg(any(desktop, target_os = "ios"))]
async fn save<R: Runtime>(app: &AppHandle<R>, name: String, bytes: Vec<u8>, _mime: String) -> Result<String, String> {
    use tauri::Manager;
    // Linux without xdg-user-dirs has no named Downloads folder: ~/Downloads.
    #[cfg(desktop)]
    let (dir, called): (Option<std::path::PathBuf>, &str) =
        (app.path().download_dir().ok().or_else(|| app.path().home_dir().ok().map(|h| h.join("Downloads"))), "Downloads");
    // the app's Documents: the Files app's On My iPhone → Parachute
    #[cfg(target_os = "ios")]
    let (dir, called): (Option<std::path::PathBuf>, &str) = (app.path().document_dir().ok(), "Parachute's folder in Files");
    let dir = dir.ok_or_else(|| format!("Couldn't find {called} on this device"))?;
    tauri::async_runtime::spawn_blocking(move || save_free(&dir, &name, &bytes))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("Couldn't save to {called}: {e}"))
}

/// Android: the bytes go to a file in the app's cache (`cache/save/`, the one folder FilesPlugin.kt reads from), which
/// the plugin copies into Downloads through MediaStore; the copy in the cache is then removed (and any an earlier save
/// left there over an hour ago, if the app was stopped mid-save).
#[cfg(target_os = "android")]
async fn save<R: Runtime>(app: &AppHandle<R>, name: String, bytes: Vec<u8>, mime: String) -> Result<String, String> {
    use std::sync::atomic::{AtomicU64, Ordering};
    use tauri::Manager;
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let handle = app.try_state::<FilesHandle<R>>().map(|h| h.0.clone()).ok_or("The file plugin isn't registered")?;
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("save");
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let tmp: std::path::PathBuf = dir.join(format!("{nanos}-{}.part", NEXT.fetch_add(1, Ordering::Relaxed)));
    let written = tmp.clone();
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::create_dir_all(&dir)?;
        let hour_ago = std::time::SystemTime::now() - std::time::Duration::from_secs(3600);
        for old in std::fs::read_dir(&dir)?.flatten() {
            if old.metadata().and_then(|m| m.modified()).is_ok_and(|t| t < hour_ago) {
                let _ = std::fs::remove_file(old.path());
            }
        }
        std::fs::write(&written, &bytes).inspect_err(|_| {
            let _ = std::fs::remove_file(&written);
        })
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("Couldn't save to Downloads: {e}"))?;
    #[derive(serde::Serialize)]
    struct Args<'a> {
        path: &'a str,
        name: &'a str,
        mime: &'a str,
    }
    #[derive(serde::Deserialize)]
    struct Saved {
        name: String,
    }
    let saved = handle
        .run_mobile_plugin_async::<Saved>("saveToDownloads", Args { path: &tmp.to_string_lossy(), name: &name, mime: &mime })
        .await
        .map_err(|e| e.to_string());
    let _ = std::fs::remove_file(&tmp);
    Ok(saved?.name)
}

#[cfg(not(any(desktop, target_os = "android", target_os = "ios")))]
async fn save<R: Runtime>(_app: &AppHandle<R>, _name: String, _bytes: Vec<u8>, _mime: String) -> Result<String, String> {
    Err("Saving files isn't supported on this device yet".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_web_and_mail_links_open() {
        for ok in ["https://example.org/a?b=c#d", "http://example.org", "HTTPS://Example.org", "mailto:a@example.org", "  https://example.org  "] {
            assert!(checked_link(ok).is_ok(), "{ok:?}");
        }
        for bad in [
            "javascript:alert(1)", "file:///etc/passwd", "intent://x#Intent;end", "tel:123", "https://exa mple.org",
            "https://example.org/\u{202e}x", "https://exa\tmple.org", "https://", "data:text/html,x", "",
            "parachute://open?url=x", "//example.org",
        ] {
            assert!(checked_link(bad).is_err(), "{bad:?}");
        }
        assert!(checked_link(&format!("https://example.org/{}", "a".repeat(2000))).is_err());
    }

    #[test]
    fn names_are_reduced_as_the_web_side_does() {
        // the vectors of src/applet/devices.test.ts
        assert_eq!(bare_name("../../etc/passwd"), "passwd");
        assert_eq!(bare_name("C:\\Users\\x\\notes.txt"), "notes.txt");
        assert_eq!(bare_name(".bashrc"), "bashrc");
        assert_eq!(bare_name("..."), "file");
        assert_eq!(bare_name("a<b>:c?.pdf"), "a_b__c_.pdf");
        assert_eq!(bare_name("re\u{202e}port.pdf"), "report.pdf");
        let long = bare_name(&format!("{}.webm", "x".repeat(300)));
        assert_eq!(long.chars().count(), 100);
        assert!(long.ends_with(".webm"));
        // and more
        assert_eq!(bare_name(""), "file");
        assert_eq!(bare_name("a/"), "file");
        assert_eq!(bare_name(" note .txt. "), "note .txt");
        assert_eq!(bare_name("a\nb\u{0}.txt"), "ab.txt");
        assert_eq!(bare_name("Garden 🌱.md"), "Garden 🌱.md");
        assert_eq!(bare_name("nul.txt"), "_nul.txt");
        assert_eq!(bare_name("Com1"), "_Com1");
        assert_eq!(bare_name("console.txt"), "console.txt");
        assert_eq!(bare_name("COM0.txt"), "COM0.txt");
        assert_eq!(bare_name(&format!("nul.{}", "x".repeat(200))).chars().count(), 100);
        let long = bare_name(&"長".repeat(150));
        assert_eq!(long.chars().count(), 100);
        let no_ext = bare_name(&format!("{}.averyverylongextension", "x".repeat(120)));
        assert_eq!(no_ext.chars().count(), 100);
        assert!(no_ext.chars().all(|c| c == 'x'));
    }

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("parachute-files-{tag}-{}-{nanos}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn saves_take_a_free_name_and_never_overwrite() {
        let dir = temp_dir("free");
        assert_eq!(save_free(&dir, "a.txt", b"one").unwrap(), "a.txt");
        assert_eq!(save_free(&dir, "a.txt", b"two").unwrap(), "a (2).txt");
        assert_eq!(save_free(&dir, "a.txt", b"three").unwrap(), "a (3).txt");
        assert_eq!(std::fs::read(dir.join("a.txt")).unwrap(), b"one");
        assert_eq!(std::fs::read(dir.join("a (2).txt")).unwrap(), b"two");
        assert_eq!(save_free(&dir, "notes", b"x").unwrap(), "notes");
        assert_eq!(save_free(&dir, "notes", b"y").unwrap(), "notes (2)");
        assert_eq!(std::fs::read(dir.join("notes")).unwrap(), b"x");
        // a folder that isn't there yet is made
        let sub = dir.join("Downloads");
        assert_eq!(save_free(&sub, "b.pdf", b"").unwrap(), "b.pdf");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn bytes_over_25_mb_are_refused() {
        use nostr::base64::{engine::general_purpose::STANDARD, Engine};
        assert_eq!(decoded(&STANDARD.encode(b"hi")).unwrap(), b"hi");
        assert!(decoded("not base64!").is_err());
        assert_eq!(decoded(&STANDARD.encode(vec![0u8; FILE_MAX])).unwrap().len(), FILE_MAX);
        assert!(decoded(&STANDARD.encode(vec![0u8; FILE_MAX + 1])).is_err());
    }
}
