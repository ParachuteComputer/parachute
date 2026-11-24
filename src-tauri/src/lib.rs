//! Parachute's shell: one window around the app, the seal applets need on desktop, and the two facts the applet
//! self-test is keyed on (the app's version and the webview runtime), and the person's key (key.rs: kept, paired in by
//! pairing.rs, used to sign in to a hub by door.rs and for an allowed applet's services by services.rs). Everything else
//! lives in the web app.

mod approvals;
pub mod approve;
mod cards;
pub mod door;
mod files;
mod updates;
pub mod key;
pub mod keyring;
pub mod levels;
pub mod notify;
pub mod pairing;
pub mod saved;
pub mod services;

use tauri::{Runtime, Url};

/// Where the hub sends the person back after signing in, as the shell registers it. A core hub keeps the name
/// "Parachute" for its own apps and for redirects only the person's own device can receive: loopback is one (Parachute
/// Cloud doesn't count it: there the app registers under another name, src/vault/oauth.ts CLOUD_CLIENT_NAME). Nothing listens on
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

/// Android's half of the key store and the sign-in cookie (gen/android/.../KeyPlugin.kt), reachable from Rust only.
#[cfg(target_os = "android")]
pub(crate) mod android {
    pub struct KeyPluginHandle<R: tauri::Runtime>(pub tauri::plugin::PluginHandle<R>);
    /// The device unlock, the screen-off count and the idle lock's touches (gen/android/.../UnlockPlugin.kt):
    /// keyring.rs, levels.rs.
    pub struct UnlockPluginHandle<R: tauri::Runtime>(pub tauri::plugin::PluginHandle<R>);
}

fn unlock_plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::<R>::new("parachute-unlock")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                use tauri::Manager;
                let handle = _api.register_android_plugin("computer.parachute.app", "UnlockPlugin")?;
                _app.manage(android::UnlockPluginHandle(handle));
            }
            Ok(())
        })
        .build()
}

fn key_plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::<R>::new("parachute-key")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                use tauri::Manager;
                let handle = _api.register_android_plugin("computer.parachute.app", "KeyPlugin")?;
                _app.manage(android::KeyPluginHandle(handle));
            }
            Ok(())
        })
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // the pairing relay's socket and the hub's key door use rustls; its crypto is ring, installed once
    let _ = rustls::crypto::ring::default_provider().install_default();
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(signin_return())
        .plugin(key_plugin())
        .plugin(unlock_plugin())
        .plugin(notify::plugin())
        .plugin(notify::push_plugin())
        .plugin(files::plugin())
        .plugin(updates::plugin());
    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_barcode_scanner::init());
    // the native OK/Cancel before an approval where there is no device unlock to ask (keyring.rs); Rust calls it, the
    // web side has no permission for it
    #[cfg(all(desktop, not(target_os = "macos")))]
    let builder = builder.plugin(tauri_plugin_dialog::init());
    builder
        .manage(key::KeyState::default())
        .manage(pairing::PairState::default())
        .manage(services::ServicesState::default())
        .manage(keyring::KeyringState::default())
        .manage(approve::PasscodeState::default())
        .manage(levels::LevelsState::default())
        .manage(notify::NotifyState::default())
        .manage(notify::SignalState::default())
        .invoke_handler(tauri::generate_handler![
            app_version,
            webview_runtime,
            updates::update_feed,
            updates::update_install,
            files::open_link,
            files::save_file,
            saved::saved_get,
            saved::saved_put,
            approve::approval_sign,
            approve::passcode_set,
            levels::levels_status,
            levels::levels_raise,
            levels::levels_lower,
            levels::levels_adopt,
            levels::idle_touch,
            levels::idle_unlock,
            key::key_status,
            cards::svc_card_view,
            cards::svc_card_trust,
            cards::svc_card_answer,
            cards::svc_card_sent,
            cards::svc_secret_view,
            cards::svc_secret_send,
            cards::svc_secret_forget,
            keyring::keyring_status,
            keyring::keyring_make_approval,
            keyring::keyring_remove_approval,
            keyring::keyring_enrollment,
            keyring::approvers_add,
            keyring::approvers_remove,
            key::key_create,
            key::key_import,
            key::key_forget,
            pairing::pair_start,
            pairing::pair_confirm,
            pairing::pair_cancel,
            door::key_sign_in,
            door::hub_vaults,
            door::hub_home_records,
            door::hub_sharing_tool,
            door::hub_accept_invite,
            services::svc_open,
            services::svc_close,
            services::svc_relay_auth,
            services::svc_sign_event,
            services::svc_http,
            services::svc_upload,
            services::svc_media,
            services::svc_private_open,
            services::svc_private_save,
            services::svc_token_set,
            services::svc_token_has,
            services::svc_log,
            notify::notify_set,
            notify::notify_open_settings,
            notify::push_status,
            notify::push_setup,
            notify::push_register,
            notify::push_signals
        ])
        .setup(|app| {
            #[cfg(any(desktop, target_os = "ios"))]
            {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    seal_webview(&window);
                }
            }
            #[cfg(target_os = "android")]
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
/// The app reaches its few commands through Tauri's custom protocol, not this handler, on desktop and on an iPhone.
/// On an iPhone only the bridge is closed: WebRTC goes off only through a private WebKit call, which an App Store build
/// must not make, so the self-test finds it on and runs approved code only there, as on Android.
#[cfg(any(desktop, target_os = "ios"))]
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
        #[cfg(target_os = "ios")]
        {
            use objc2::{msg_send, rc::Retained, runtime::AnyObject};
            // SAFETY: on iOS `inner()` is the live WKWebView, and `with_webview` runs this on the main thread; both
            // messages are public WebKit API (WKWebView.configuration, WKUserContentController
            // removeScriptMessageHandlerForName:).
            unsafe {
                let wk = &*webview.inner().cast::<AnyObject>();
                let config: Retained<AnyObject> = msg_send![wk, configuration];
                let controller: Retained<AnyObject> = msg_send![&*config, userContentController];
                let () = msg_send![&*controller, removeScriptMessageHandlerForName: objc2_foundation::ns_string!("ipc")];
            }
            let _ = label;
        }
        #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "ios")))]
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
