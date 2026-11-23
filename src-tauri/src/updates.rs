//! Updates outside an app store (docs/LAUNCH.md "An update channel"): a build made with `PARACHUTE_UPDATE_FEED` set
//! (the address of a `latest.json` beside the builds) reads that feed when asked, and the screens offer a newer build
//! there (src/shell/updates.ts). The feed is the build's: nothing from a vault, an applet or the webview can point it
//! elsewhere. On Android, Download is `update_install`: the app downloads the APK itself (only from the feed's own
//! origin), checks it against the feed's sha256, and hands it to Android's installer (gen/android/.../UpdatePlugin.kt),
//! which asks the person and installs it only when it is signed with the same key as the app it replaces. On a Mac the
//! file opens in the browser and the person opens the dmg.

use std::path::Path;
use std::time::Duration;

/// The feed this build reads, if it was built with one.
const FEED: Option<&str> = option_env!("PARACHUTE_UPDATE_FEED");
/// A feed is a few lines; anything larger isn't one.
const FEED_MAX: usize = 64 * 1024;

#[derive(serde::Serialize)]
pub struct Feed {
    /// where it was read from (the screens resolve the files it names against it, on its own origin only)
    feed: String,
    /// what it said
    body: String,
    /// which build of the files this device takes
    platform: &'static str,
}

const PLATFORM: &str = if cfg!(target_os = "android") { "android" } else if cfg!(target_os = "macos") { "mac" } else if cfg!(target_os = "windows") { "windows" } else { "linux" };

/// Only https, or http to this machine (a test feed).
fn feed_url(raw: &str) -> Result<url::Url, String> {
    let u = url::Url::parse(raw.trim()).map_err(|_| "This build's update address isn't one.".to_string())?;
    let local = matches!(u.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"));
    if u.scheme() == "https" || (u.scheme() == "http" && local) { Ok(u) } else { Err("This build's update address isn't https.".into()) }
}

/// The feed, read now; `None` when this build has none.
#[tauri::command]
pub async fn update_feed() -> Result<Option<Feed>, String> {
    let Some(raw) = FEED.filter(|f| !f.trim().is_empty()) else { return Ok(None) };
    let url = feed_url(raw)?;
    let http = crate::door::http_client(Duration::from_secs(15)).map_err(|_| "Couldn't check for updates.".to_string())?;
    let mut res = http.get(url.clone()).send().await.map_err(|_| "Couldn't reach the update address.".to_string())?;
    if !res.status().is_success() {
        return Err(format!("The update address answered {}.", res.status().as_u16()));
    }
    let mut body = Vec::new();
    while let Some(chunk) = res.chunk().await.map_err(|_| "Couldn't read the update address.".to_string())? {
        body.extend_from_slice(&chunk);
        if body.len() > FEED_MAX {
            return Err("The update address sent too much.".into());
        }
    }
    let body = String::from_utf8(body).map_err(|_| "The update address sent something else.".to_string())?;
    Ok(Some(Feed { feed: url.to_string(), body, platform: PLATFORM }))
}

// ── Download and install (Android) ──

/** An APK is tens of MB; anything this large isn't one. */
const APK_MAX: u64 = 400 * 1024 * 1024;
/** A download that sends nothing for this long has stalled. */
const STALL: Duration = Duration::from_secs(60);

/// What the screens show while it runs (src/shell/updates.ts `Step`).
#[derive(serde::Serialize, Clone, Debug, PartialEq)]
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
#[serde(tag = "stage", rename_all = "lowercase")]
pub enum Step {
    /// bytes so far, of `total` (0: the server didn't say)
    Download { got: u64, total: u64 },
    /// handed to the installer; `checked`: the file matched the feed's sha256 (false: the feed has none for it)
    Install { checked: bool },
}

/// The file to download: on the feed's own origin (as the screens resolve it), over https or http to this machine.
fn install_url(raw: &str, feed: &url::Url) -> Result<url::Url, String> {
    let u = url::Url::parse(raw).map_err(|_| "The update's address isn't one.".to_string())?;
    if u.origin() != feed.origin() || !matches!(u.scheme(), "https" | "http") {
        return Err("The update's address isn't beside this build's update list.".into());
    }
    Ok(u)
}

/// A sha256 as the feed writes it: 64 hex digits (any case).
fn sum_of(raw: Option<&str>) -> Result<Option<String>, String> {
    match raw.map(str::trim).filter(|s| !s.is_empty()) {
        None => Ok(None),
        Some(s) if s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit()) => Ok(Some(s.to_ascii_lowercase())),
        Some(_) => Err("The update list's checksum for this file isn't one.".into()),
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Downloads `url` to `dest`, hashing as it goes; `step` hears the bytes so far. With `want`, a file whose sha256 differs
/// is removed and refused. Returns whether it was checked (a feed without a sha256 can't be).
pub async fn fetch_checked(
    http: &reqwest::Client,
    url: url::Url,
    want: Option<&str>,
    dest: &Path,
    mut step: impl FnMut(u64, u64),
) -> Result<bool, String> {
    use sha2::{Digest, Sha256};
    use std::io::Write;
    let want = sum_of(want)?;
    let mut res = http.get(url).send().await.map_err(|_| "Couldn't reach the update's address.".to_string())?;
    if !res.status().is_success() {
        return Err(format!("The update's address answered {}.", res.status().as_u16()));
    }
    let total = res.content_length().unwrap_or(0);
    if total > APK_MAX {
        return Err("The update's file is too large to be Parachute.".into());
    }
    let part = dest.with_extension("part");
    let mut out = std::fs::File::create(&part).map_err(|e| format!("Couldn't save the update: {e}"))?;
    let mut hash = Sha256::new();
    let mut got: u64 = 0;
    let mut said: u64 = 0;
    step(0, total);
    let read = async {
        loop {
            let chunk = tokio::time::timeout(STALL, res.chunk())
                .await
                .map_err(|_| "The download stalled. Try again on a better connection.".to_string())?
                .map_err(|_| "The download broke off. Try again.".to_string())?;
            let Some(chunk) = chunk else { break };
            got += chunk.len() as u64;
            if got > APK_MAX {
                return Err("The update's file is too large to be Parachute.".to_string());
            }
            hash.update(&chunk);
            out.write_all(&chunk).map_err(|e| format!("Couldn't save the update: {e}"))?;
            // about every 1%, and at least every 4 MB without a length
            if got - said >= (total / 100).max(256 * 1024).min(4 << 20) {
                said = got;
                step(got, total);
            }
        }
        if total > 0 && got != total {
            return Err("The download broke off. Try again.".to_string());
        }
        out.sync_all().map_err(|e| format!("Couldn't save the update: {e}"))?;
        step(got, total);
        Ok(())
    };
    let done = read.await;
    drop(out);
    let checked = match (&done, &want) {
        (Ok(()), Some(w)) if hex(&hash.finalize()) != *w => {
            Err("The downloaded file isn't the one the update list names (its checksum differs), so it wasn't installed.".to_string())
        }
        (Ok(()), w) => Ok(w.is_some()),
        (Err(e), _) => Err(e.clone()),
    };
    match checked {
        Ok(c) => {
            std::fs::rename(&part, dest).map_err(|e| format!("Couldn't save the update: {e}"))?;
            Ok(c)
        }
        Err(e) => {
            let _ = std::fs::remove_file(&part);
            Err(e)
        }
    }
}

#[cfg(target_os = "android")]
struct UpdateHandle<R: tauri::Runtime>(tauri::plugin::PluginHandle<R>);

/// Registers the Kotlin `UpdatePlugin` on Android; nothing elsewhere. Rust calls it; the web side has no permission.
pub fn plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::<R>::new("parachute-update")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                use tauri::Manager;
                let handle = _api.register_android_plugin("computer.parachute.app", "UpdatePlugin")?;
                _app.manage(UpdateHandle(handle));
            }
            Ok(())
        })
        .build()
}

/// Download on Android: the feed's file, checked against its sha256, into the app's cache (`cache/update/`, the one
/// folder UpdatePlugin.kt installs from), then Android's installer. Answers when Android has (a refusal in plain words);
/// on an install Android closes the app first.
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn update_install<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    url: String,
    sha256: Option<String>,
    on_step: tauri::ipc::Channel<Step>,
) -> Result<(), String> {
    use tauri::Manager;
    let Some(raw) = FEED.filter(|f| !f.trim().is_empty()) else { return Err("This build has no updates.".into()) };
    let url = install_url(&url, &feed_url(raw)?)?;
    let handle = app.try_state::<UpdateHandle<R>>().map(|h| h.0.clone()).ok_or("The installer isn't registered.")?;
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("update");
    // one download at a time, and nothing an earlier one left
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Couldn't save the update: {e}"))?;
    let apk = dir.join("parachute-update.apk");
    let http = crate::door::http_client(Duration::from_secs(30 * 60)).map_err(|_| "Couldn't download the update.".to_string())?;
    let checked = fetch_checked(&http, url, sha256.as_deref(), &apk, |got, total| {
        let _ = on_step.send(Step::Download { got, total });
    })
    .await?;
    let _ = on_step.send(Step::Install { checked });
    #[derive(serde::Serialize)]
    struct Args<'a> {
        path: &'a str,
    }
    let done = handle
        .run_mobile_plugin_async::<serde_json::Value>("install", Args { path: &apk.to_string_lossy() })
        .await
        .map(|_| ())
        .map_err(|e| e.to_string());
    let _ = std::fs::remove_dir_all(&dir);
    done
}

/// Elsewhere Download opens the file in the browser (src/shell/updates.ts); this is Android's.
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn update_install(_url: String, _sha256: Option<String>, _on_step: tauri::ipc::Channel<Step>) -> Result<(), String> {
    Err("Only the Android app installs its update itself.".into())
}

#[cfg(test)]
mod tests {
    use super::{feed_url, install_url, sum_of};

    #[test]
    fn only_https_or_this_machine() {
        assert!(feed_url("https://example.org/parachute/latest.json").is_ok());
        assert!(feed_url("http://127.0.0.1:8099/latest.json").is_ok());
        assert!(feed_url("http://localhost:8099/latest.json").is_ok());
        assert!(feed_url("http://example.org/latest.json").is_err());
        assert!(feed_url("file:///etc/passwd").is_err());
        assert!(feed_url("not a url").is_err());
    }

    #[test]
    fn the_file_is_beside_the_feed() {
        let feed = feed_url("https://builds.example.org/parachute/latest.json").unwrap();
        assert!(install_url("https://builds.example.org/parachute/p-abc1234.apk", &feed).is_ok());
        assert!(install_url("https://builds.example.org/other/p.apk", &feed).is_ok());
        assert!(install_url("https://elsewhere.example/p.apk", &feed).is_err());
        assert!(install_url("http://builds.example.org/parachute/p.apk", &feed).is_err());
        assert!(install_url("https://builds.example.org:8443/p.apk", &feed).is_err());
        assert!(install_url("file:///sdcard/p.apk", &feed).is_err());
    }

    #[test]
    fn a_sum_is_64_hex_or_none() {
        let s = "9F86D081884C7D659A2FEAA0C55AD015A3BF4F1B2B0B822CD15D6C15B0F00A08";
        assert_eq!(sum_of(Some(s)).unwrap().as_deref(), Some(s.to_ascii_lowercase().as_str()));
        assert_eq!(sum_of(None).unwrap(), None);
        assert_eq!(sum_of(Some(" ")).unwrap(), None);
        assert!(sum_of(Some("abc")).is_err());
        assert!(sum_of(Some(&"g".repeat(64))).is_err());
    }

    /// Serves `body` once per connection on this machine, as a build's host would; the address to fetch.
    async fn serve(body: Vec<u8>) -> url::Url {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            while let Ok((mut sock, _)) = listener.accept().await {
                let body = body.clone();
                tokio::spawn(async move {
                    let mut buf = [0u8; 4096];
                    let _ = sock.read(&mut buf).await;
                    let head = format!("HTTP/1.1 200 OK\r\ncontent-length: {}\r\nconnection: close\r\n\r\n", body.len());
                    let _ = sock.write_all(head.as_bytes()).await;
                    let _ = sock.write_all(&body).await;
                });
            }
        });
        url::Url::parse(&format!("http://{addr}/parachute-abc1234.apk")).unwrap()
    }

    fn sha(bytes: &[u8]) -> String {
        use sha2::{Digest, Sha256};
        super::hex(&Sha256::digest(bytes))
    }

    #[tokio::test]
    async fn the_download_is_checked_against_the_feed() {
        let apk: Vec<u8> = (0..3_000_000u32).map(|i| (i % 251) as u8).collect();
        let url = serve(apk.clone()).await;
        let http = crate::door::http_client(std::time::Duration::from_secs(30)).unwrap();
        let dir = std::env::temp_dir().join(format!("parachute-update-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let dest = dir.join("parachute-update.apk");

        // the feed's sum: downloaded, checked, and the steps rise to the whole file
        let mut steps = vec![];
        let checked = super::fetch_checked(&http, url.clone(), Some(&sha(&apk)), &dest, |g, t| steps.push((g, t))).await;
        assert_eq!(checked, Ok(true));
        assert_eq!(std::fs::read(&dest).unwrap(), apk);
        assert_eq!(steps.first(), Some(&(0, apk.len() as u64)));
        assert_eq!(steps.last(), Some(&(apk.len() as u64, apk.len() as u64)));
        assert!(steps.len() >= 3 && steps.windows(2).all(|w| w[0].0 <= w[1].0));
        std::fs::remove_file(&dest).unwrap();

        // a tampered file (the sum of another): refused, and nothing is left to install
        let mut other = apk.clone();
        other[1_234_567] ^= 1;
        let refused = super::fetch_checked(&http, url.clone(), Some(&sha(&other)), &dest, |_, _| {}).await;
        assert!(refused.unwrap_err().contains("checksum differs"));
        assert!(!dest.exists() && !dest.with_extension("part").exists());

        // an old feed without sums: still downloaded, and said to be unchecked
        assert_eq!(super::fetch_checked(&http, url, None, &dest, |_, _| {}).await, Ok(false));
        assert_eq!(std::fs::read(&dest).unwrap(), apk);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
