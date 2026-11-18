fn main() {
    // The wry version the applet self-test pass is keyed on (see `webview_runtime`): read it from the lockfile.
    let lock = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.lock");
    println!("cargo:rerun-if-changed={}", lock.display());
    let text = std::fs::read_to_string(&lock).unwrap_or_else(|e| { println!("cargo:warning=reading {}: {e}", lock.display()); String::new() });
    let version = text
        .split("[[package]]")
        .find(|p| p.lines().any(|l| l.trim() == "name = \"wry\""))
        .and_then(|p| p.lines().find_map(|l| l.trim().strip_prefix("version = \"")?.strip_suffix('"')))
        .unwrap_or("unknown");
    println!("cargo:rustc-env=PARACHUTE_WRY_VERSION={version}");
    // gen/android/app/src/main/java/computer/parachute/app/{RustWebView,Ipc}.kt are copies of wry 0.55.1's templates
    // with the main-frame-only fix (MainFrameOnly.kt). ShellOnlyMedia.kt wraps wry's RustWebChromeClient and forwards each
    // method that template overrides. A different wry must have all three re-derived and the self-test re-run.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("android") && version != "0.55.1" {
        panic!("wry is {version}, but the Android RustWebView.kt/Ipc.kt overrides are derived from 0.55.1: re-derive them from the new wry templates (see MainFrameOnly.kt), then update this check");
    }
    tauri_build::build()
}
