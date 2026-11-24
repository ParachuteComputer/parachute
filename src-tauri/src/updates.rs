//! Updates outside an app store (docs/LAUNCH.md "An update channel"): a build made with `PARACHUTE_UPDATE_FEED` set
//! (the address of a `latest.json` beside the builds) reads that feed when asked, and the screens offer a newer build
//! there (src/shell/updates.ts). The feed is the build's: nothing from a vault, an applet or the webview can point it
//! elsewhere. On Android, Download is `update_install`: the app downloads the APK itself (only from the feed's own
//! origin), checks it against the feed's sha256, and hands it to Android's installer (gen/android/.../UpdatePlugin.kt),
//! which asks the person and installs it only when it is signed with the same key as the app it replaces. On a Mac the
//! file opens in the browser and the person opens the dmg.

// The download and its checks run only on Android (the Mac's Download is the browser); elsewhere only the tests use them.
#![cfg_attr(not(target_os = "android"), allow(dead_code))]

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

// (an iPhone build never has a feed: build.rs refuses one, and TestFlight and the App Store update it)
const PLATFORM: &str = if cfg!(target_os = "android") { "android" } else if cfg!(target_os = "macos") { "mac" } else if cfg!(target_os = "ios") { "ios" } else if cfg!(target_os = "windows") { "windows" } else { "linux" };

/// Only https, or http to this machine (a test feed).
fn feed_url(raw: &str) -> Result<url::Url, String> {
    let u = url::Url::parse(raw.trim()).map_err(|_| "This build's update address isn't one.".to_string())?;
    let local = matches!(u.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"));
    if u.scheme() == "https" || (u.scheme() == "http" && local) { Ok(u) } else { Err("This build's update address isn't https.".into()) }
}

/// The feed, read now; `None` when this build has none.
#[tauri::command]
pub async fn update_feed() -> Result<Option<Feed>, String> {
    let Some((url, body)) = read_feed().await? else { return Ok(None) };
    Ok(Some(Feed { feed: url.to_string(), body, platform: PLATFORM }))
}

/// This build's feed and what it says now; `None` when this build has none.
async fn read_feed() -> Result<Option<(url::Url, String)>, String> {
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
    Ok(Some((url, body)))
}

// ── Download and install (Android) ──

/** An APK is tens of MB; anything this large isn't one. */
const APK_MAX: u64 = 400 * 1024 * 1024;
/** A download that sends nothing for this long has stalled. */
const STALL: Duration = Duration::from_secs(60);

/// What the screens show while it runs (src/shell/updates.ts `Step`).
#[derive(serde::Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "stage", rename_all = "lowercase")]
pub enum Step {
    /// bytes so far, of `total` (0: the server didn't say)
    Download { got: u64, total: u64 },
    /// handed to the installer: the feed's build (`commit`, `at`); `checked`: the file matched the feed's sha256 (false:
    /// the feed has none for it)
    Install { checked: bool, commit: String, at: u64 },
}

/// What the feed names for this device: its file (on the feed's own origin), the file's sha256 when the feed gives one,
/// and the build. The feed as src/shell/feed.ts reads it, but a sum that isn't one is refused here, not ignored.
#[derive(Debug, PartialEq)]
struct Pick {
    url: url::Url,
    sha256: Option<String>,
    commit: String,
    at: u64,
}

fn pick(body: &str, feed: &url::Url, platform: &str) -> Result<Pick, String> {
    let bad = || "The update list isn't one.".to_string();
    let v: serde_json::Value = serde_json::from_str(body).map_err(|_| bad())?;
    if v.get("v").and_then(|n| n.as_u64()) != Some(1) {
        return Err(bad());
    }
    let at = v.get("at").and_then(|n| n.as_u64()).filter(|&a| a > 0 && a <= (1u64 << 53)).ok_or_else(bad)?;
    let commit = v.get("commit").and_then(|c| c.as_str())
        .filter(|c| (7..=40).contains(&c.len()) && c.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)))
        .ok_or_else(bad)?
        .to_string();
    let name = v.get("files").and_then(|f| f.get(platform)).and_then(|n| n.as_str()).filter(|n| !n.is_empty())
        .ok_or("The update list has no file for this device.")?;
    let url = feed.join(name).map_err(|_| "The update's address isn't one.".to_string())?;
    if url.origin() != feed.origin() || !matches!(url.scheme(), "https" | "http") {
        return Err("The update's address isn't beside this build's update list.".into());
    }
    let sha256 = match v.get("sha256").and_then(|s| s.get(platform)) {
        None | Some(serde_json::Value::Null) => None,
        Some(serde_json::Value::String(s)) if crate::door::hex64(&s.to_ascii_lowercase()) => Some(s.to_ascii_lowercase()),
        Some(_) => return Err("The update list's checksum for this file isn't one.".into()),
    };
    Ok(Pick { url, sha256, commit, at })
}

/// Why a Download didn't reach Android's installer, or what Android said; `browser`: the way to the file failed (the
/// address, the network), so the browser's download may still work. Not for a file that was refused (its sum, its maker).
#[derive(serde::Serialize, Debug, PartialEq)]
pub struct Refused {
    pub message: String,
    pub browser: bool,
}

fn transfer(message: impl Into<String>) -> Refused {
    Refused { message: message.into(), browser: true }
}
fn file(message: impl Into<String>) -> Refused {
    Refused { message: message.into(), browser: false }
}

/// Downloads `url` to `dest`, hashing as it goes; `step` hears the bytes so far. With `want`, a file whose sha256 differs
/// is removed and refused. Returns whether it was checked (a feed without a sha256 can't be).
pub async fn fetch_checked(
    http: &reqwest::Client,
    url: url::Url,
    want: Option<&str>,
    dest: &Path,
    mut step: impl FnMut(u64, u64),
) -> Result<bool, Refused> {
    use sha2::{Digest, Sha256};
    use tokio::io::AsyncWriteExt;
    let want = want.map(str::to_ascii_lowercase);
    let mut res = http.get(url).send().await.map_err(|_| transfer("Couldn't reach the update's address."))?;
    if !res.status().is_success() {
        return Err(transfer(format!("The update's address answered {}.", res.status().as_u16())));
    }
    let total = res.content_length().unwrap_or(0);
    if total > APK_MAX {
        return Err(file("The update's file is too large to be Parachute."));
    }
    let saving = |e: std::io::Error| file(format!("Couldn't save the update: {e}"));
    let part = dest.with_extension("part");
    let mut out = tokio::fs::File::create(&part).await.map_err(saving)?;
    let mut hash = Sha256::new();
    let mut got: u64 = 0;
    let mut said: u64 = 0;
    step(0, total);
    let read = async {
        loop {
            let chunk = tokio::time::timeout(STALL, res.chunk())
                .await
                .map_err(|_| transfer("The download stalled. Try again on a better connection."))?
                .map_err(|_| transfer("The download broke off. Try again."))?;
            let Some(chunk) = chunk else { break };
            got += chunk.len() as u64;
            if got > APK_MAX {
                return Err(file("The update's file is too large to be Parachute."));
            }
            hash.update(&chunk);
            out.write_all(&chunk).await.map_err(saving)?;
            // about every 1%, and at least every 4 MB without a length
            if got - said >= (total / 100).max(256 * 1024).min(4 << 20) {
                said = got;
                step(got, total);
            }
        }
        if total > 0 && got != total {
            return Err(transfer("The download broke off. Try again."));
        }
        out.sync_all().await.map_err(saving)?;
        step(got, total);
        Ok(())
    };
    let done = read.await;
    drop(out);
    let checked = match (done, &want) {
        (Ok(()), Some(w)) if crate::saved::hex(&hash.finalize()) != *w => {
            Err(file("The downloaded file isn't the one the update list names (its checksum differs), so it wasn't installed."))
        }
        (Ok(()), w) => Ok(w.is_some()),
        (Err(e), _) => Err(e),
    };
    match checked {
        Ok(c) => {
            tokio::fs::rename(&part, dest).await.map_err(saving)?;
            Ok(c)
        }
        Err(e) => {
            let _ = tokio::fs::remove_file(&part).await;
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
                // the file an install left (Android closes the app before the try can remove it)
                if let Ok(cache) = _app.path().app_cache_dir() {
                    let _ = std::fs::remove_dir_all(cache.join("update"));
                }
            }
            Ok(())
        })
        .build()
}

/// Download on Android: what this build's feed names now (read here, so nothing the webview says picks the file or its
/// sum), checked against the feed's sha256 as it downloads into the app's cache (`cache/update/`, the one folder
/// UpdatePlugin.kt installs from), then Android's installer. Answers when Android has (a refusal in plain words); on an
/// install Android closes the app first. A second Download while Android's question is open replaces the first.
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn update_install<R: tauri::Runtime>(app: tauri::AppHandle<R>, on_step: tauri::ipc::Channel<Step>) -> Result<(), Refused> {
    use tauri::Manager;
    let Some((feed, body)) = read_feed().await.map_err(transfer)? else { return Err(file("This build has no updates.")) };
    let Pick { url, sha256, commit, at } = pick(&body, &feed, PLATFORM).map_err(file)?;
    let handle = app.try_state::<UpdateHandle<R>>().map(|h| h.0.clone()).ok_or_else(|| file("The installer isn't registered."))?;
    let dir = app.path().app_cache_dir().map_err(|e| file(e.to_string()))?.join("update");
    // this try's own file; what earlier tries left goes (a file already handed to Android was copied into its session)
    let _ = tokio::fs::remove_dir_all(&dir).await;
    tokio::fs::create_dir_all(&dir).await.map_err(|e| file(format!("Couldn't save the update: {e}")))?;
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let apk = dir.join(format!("parachute-{commit}-{nanos}.apk"));
    let http = crate::door::http_client(Duration::from_secs(30 * 60)).map_err(|_| transfer("Couldn't download the update."))?;
    let checked = fetch_checked(&http, url, sha256.as_deref(), &apk, |got, total| {
        let _ = on_step.send(Step::Download { got, total });
    })
    .await?;
    let _ = on_step.send(Step::Install { checked, commit, at });
    #[derive(serde::Serialize)]
    struct Args<'a> {
        path: &'a str,
    }
    let done = handle
        .run_mobile_plugin_async::<serde_json::Value>("install", Args { path: &apk.to_string_lossy() })
        .await
        .map(|_| ())
        .map_err(|e| file(e.to_string()));
    // only this try's file: a later try may be using the folder by now
    let _ = tokio::fs::remove_file(&apk).await;
    done
}

/// Elsewhere Download opens the file in the browser (src/shell/updates.ts); this is Android's.
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn update_install(_on_step: tauri::ipc::Channel<Step>) -> Result<(), Refused> {
    Err(file("Only the Android app installs its update itself."))
}

#[cfg(test)]
mod tests {
    use super::{feed_url, pick, Pick};

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
    fn the_feed_names_the_file_and_its_sum() {
        let feed = feed_url("https://builds.example.org/parachute/latest.json").unwrap();
        let sum = "9F86D081884C7D659A2FEAA0C55AD015A3BF4F1B2B0B822CD15D6C15B0F00A08";
        let body = |files: &str, sums: &str| format!(r#"{{"v":1,"at":2000,"commit":"abc1234","files":{files},"sha256":{sums}}}"#);
        assert_eq!(
            pick(&body(r#"{"android":"p-abc1234.apk"}"#, &format!(r#"{{"android":"{sum}"}}"#)), &feed, "android"),
            Ok(Pick {
                url: url::Url::parse("https://builds.example.org/parachute/p-abc1234.apk").unwrap(),
                sha256: Some(sum.to_ascii_lowercase()),
                commit: "abc1234".into(),
                at: 2000
            })
        );
        // an older feed, without sums: the file, unchecked
        let old = r#"{"v":1,"at":2000,"commit":"abc1234","files":{"android":"p.apk"}}"#;
        assert_eq!(pick(old, &feed, "android").unwrap().sha256, None);
        // a sum that isn't one is refused, not skipped
        assert!(pick(&body(r#"{"android":"p.apk"}"#, r#"{"android":"abc"}"#), &feed, "android").is_err());
        assert!(pick(&body(r#"{"android":"p.apk"}"#, r#"{"android":7}"#), &feed, "android").is_err());
        // only a file on the feed's own origin, over the feed's scheme
        for elsewhere in [r#""https://elsewhere.example/p.apk""#, r#""//elsewhere.example/p.apk""#, r#""http://builds.example.org/p.apk""#, r#""https://builds.example.org:8443/p.apk""#, r#""file:///sdcard/p.apk""#] {
            assert!(pick(&body(&format!(r#"{{"android":{elsewhere}}}"#), "{}"), &feed, "android").is_err(), "{elsewhere}");
        }
        assert!(pick(&body(r#"{"mac":"p.dmg"}"#, "{}"), &feed, "android").is_err());
        for bad in ["", "[]", r#"{"v":2,"at":2000,"commit":"abc1234","files":{"android":"p.apk"}}"#, r#"{"v":1,"at":0,"commit":"abc1234","files":{"android":"p.apk"}}"#, r#"{"v":1,"at":2000,"commit":"ABC1234","files":{"android":"p.apk"}}"#] {
            assert!(pick(bad, &feed, "android").is_err(), "{bad}");
        }
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
        crate::saved::hex(&Sha256::digest(bytes))
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
        let refused = super::fetch_checked(&http, url.clone(), Some(&sha(&other)), &dest, |_, _| {}).await.unwrap_err();
        // the file was refused, not the way to it: no browser for it either
        assert!(refused.message.contains("checksum differs") && !refused.browser);
        assert!(!dest.exists() && !dest.with_extension("part").exists());

        // an old feed without sums: still downloaded, and said to be unchecked
        assert_eq!(super::fetch_checked(&http, url.clone(), None, &dest, |_, _| {}).await, Ok(false));
        assert_eq!(std::fs::read(&dest).unwrap(), apk);

        // a file that isn't there: the way to it failed, so the browser's download is worth offering
        let mut gone = url;
        gone.set_port(Some(1)).unwrap();
        let unreachable = super::fetch_checked(&http, gone, None, &dest.with_file_name("x.apk"), |_, _| {}).await.unwrap_err();
        assert!(unreachable.browser, "{unreachable:?}");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
