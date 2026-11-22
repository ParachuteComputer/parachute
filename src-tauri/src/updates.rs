//! Updates outside an app store (docs/LAUNCH.md "An update channel"): a build made with `PARACHUTE_UPDATE_FEED` set
//! (the address of a `latest.json` beside the builds) reads that feed when asked, and the screens offer a newer build
//! there (src/shell/updates.ts). The feed is the build's: nothing from a vault, an applet or the webview can point it
//! elsewhere. The app only reads it; the file is downloaded and installed by the system (Android checks that it is
//! signed with the same key as the app it replaces; on a Mac the person opens the dmg).

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

#[cfg(test)]
mod tests {
    use super::feed_url;

    #[test]
    fn only_https_or_this_machine() {
        assert!(feed_url("https://example.org/parachute/latest.json").is_ok());
        assert!(feed_url("http://127.0.0.1:8099/latest.json").is_ok());
        assert!(feed_url("http://localhost:8099/latest.json").is_ok());
        assert!(feed_url("http://example.org/latest.json").is_err());
        assert!(feed_url("file:///etc/passwd").is_err());
        assert!(feed_url("not a url").is_err());
    }
}
