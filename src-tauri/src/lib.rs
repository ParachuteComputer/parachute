//! Parachute's shell: one window around the app, the seal applets need on desktop, and the two facts the applet
//! self-test is keyed on (the app's version and the webview runtime). Everything else lives in the web app.

use tauri::{Runtime, Url};

/// Where the hub sends the person back after signing in, as the shell registers it. A hub keeps the name "Parachute"
/// for its own apps and for redirects only the person's own device can receive: loopback is one. Nothing listens on
/// this port: the shell catches the navigation in its own webview (`signin_return`) and hands the code to the app.
pub const SIGNIN_RETURN: &str = "http://127.0.0.1:47219/oauth/callback";

/// The app's own address for its sign-in callback, with the hub's query.
fn app_callback(query: Option<&str>) -> Option<Url> {
    let base = if tauri::is_dev() {
        "http://localhost:1420"
    } else if cfg!(any(target_os = "android", target_os = "windows")) {
        "https://tauri.localhost"
    } else {
        "tauri://localhost"
    };
    let mut url = Url::parse(&format!("{base}/oauth/callback")).ok()?;
    url.set_query(query);
    Some(url)
}

/// Is this the hub sending the person back (the exact loopback address the shell registers)?
fn is_signin_return(url: &Url) -> bool {
    url.scheme() == "http" && url.host_str() == Some("127.0.0.1") && url.port() == Some(47219) && url.path() == "/oauth/callback"
}

/// Catches the hub's redirect to `SIGNIN_RETURN` in the main webview and loads the app's own callback instead.
fn signin_return<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::<R>::new("signin-return")
        .on_navigation(|webview, url| {
            if !is_signin_return(url) {
                return true;
            }
            if let Some(target) = app_callback(url.query()) {
                let webview = webview.clone();
                // navigate after this callback returns: the webview is mid-navigation here
                tauri::async_runtime::spawn(async move {
                    if let Err(err) = webview.navigate(target) {
                        log::warn!("sign-in return: could not load the app's callback: {err}");
                    }
                });
            }
            false
        })
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(signin_return())
        .invoke_handler(tauri::generate_handler![app_version, webview_runtime])
        .setup(|app| {
            #[cfg(desktop)]
            {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    seal_webview(&window);
                }
            }
            #[cfg(mobile)]
            let _ = app;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Parachute");
}

/// The app's version, from tauri.conf.json.
#[tauri::command]
fn app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

/// The wry and Tauri versions in this build. A stored self-test pass is keyed on it, so a dependency bump (which could
/// move the bridge) forces the test to run again.
#[tauri::command]
fn webview_runtime() -> String {
    // a build that can't say which wry it carries keys no pass: "" keeps applets off (src/applet/selftest/runtime.ts)
    match env!("PARACHUTE_WRY_VERSION") {
        "unknown" => String::new(),
        wry => format!("wry {wry} tauri {}", tauri::VERSION),
    }
}

/// Close the two holes a sealed applet's frame would otherwise have on desktop: the bridge to native code
/// (wry's `ipc` message handler) and WebRTC, which ignores the frame's content policy. Copied from the Uni app's shell.
/// The app reaches its few commands through Tauri's custom protocol, not this handler, on desktop.
#[cfg(desktop)]
fn seal_webview(window: &tauri::WebviewWindow) {
    let label = window.label().to_string();
    let logged = label.clone();
    if let Err(err) = window.with_webview(move |webview| {
        #[cfg(target_os = "linux")]
        {
            use webkit2gtk::{SettingsExt, UserContentManagerExt, WebViewExt};
            let view = webview.inner();
            match view.user_content_manager() {
                Some(manager) => manager.unregister_script_message_handler("ipc"),
                None => log::warn!("seal_webview({label}): no user content manager; ipc handler left registered"),
            }
            match view.settings() {
                Some(settings) => {
                    settings.set_enable_webrtc(false);
                    settings.set_enable_media_stream(false);
                }
                None => log::warn!("seal_webview({label}): no settings; WebRTC left as built"),
            }
        }
        #[cfg(target_os = "macos")]
        {
            use objc2::runtime::{Bool, NSObjectProtocol};
            // SAFETY: on macOS `inner()` is the live WKWebView, and `with_webview` runs this on the main thread. The
            // private selector is checked before it is sent.
            unsafe {
                let wk = &*webview.inner().cast::<objc2_web_kit::WKWebView>();
                let config = wk.configuration();
                config.userContentController().removeScriptMessageHandlerForName(objc2_foundation::ns_string!("ipc"));
                let prefs = config.preferences();
                if prefs.respondsToSelector(objc2::sel!(_setPeerConnectionEnabled:)) {
                    let () = objc2::msg_send![&*prefs, _setPeerConnectionEnabled: Bool::NO];
                } else {
                    log::warn!("seal_webview({label}): WKPreferences has no _setPeerConnectionEnabled:; WebRTC left on");
                }
            }
        }
        #[cfg(not(any(target_os = "linux", target_os = "macos")))]
        let _ = (webview, label);
    }) {
        log::warn!("seal_webview({logged}): with_webview failed ({err}); webview left unsealed");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_exact_loopback_return_is_caught() {
        assert!(is_signin_return(&Url::parse("http://127.0.0.1:47219/oauth/callback?code=a&state=b").unwrap()));
        for other in [
            "http://127.0.0.1:47220/oauth/callback?code=a",
            "http://localhost:47219/oauth/callback?code=a",
            "https://127.0.0.1:47219/oauth/callback?code=a",
            "http://127.0.0.1:47219/oauth/callbackx?code=a",
            "https://hub.example/oauth/callback?code=a",
        ] {
            assert!(!is_signin_return(&Url::parse(other).unwrap()), "{other}");
        }
    }

    #[test]
    fn the_hubs_query_reaches_the_app() {
        let url = app_callback(Some("code=abc&state=xyz")).unwrap();
        assert_eq!(url.path(), "/oauth/callback");
        assert_eq!(url.query(), Some("code=abc&state=xyz"));
    }
}
