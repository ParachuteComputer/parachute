// Override of the wry 0.55.1 template (src/android/kotlin/RustWebView.kt). The generated copy under
// generated/ is excluded from compilation in app/build.gradle.kts. Only the init scripts differ: each is guarded (main frame, app origin) on every path that runs it.
// src-tauri/build.rs fails an Android build if wry is not 0.55.1, so this copy cannot silently go stale.
// Copyright 2020-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

@file:Suppress("unused", "SetJavaScriptEnabled")

package computer.parachute.app

import android.annotation.SuppressLint
import android.webkit.*
import android.content.Context
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import kotlin.collections.Map

@SuppressLint("RestrictedApi")
class RustWebView(context: Context, rawInitScripts: Array<String>, val id: String): WebView(context) {
    // Every init script carries the main-frame and app-origin guard, on both paths wry uses to run them: document-start
    // registration below, and RustWebViewClient.onPageStarted, which runs them by hand on pages it did not serve (a hub's
    // sign-in page). So a remote page in the main frame gets no Tauri internals either.
    val initScripts: Array<String> = rawInitScripts.map { MainFrameOnly.guard(it) }.toTypedArray()
    val isDocumentStartScriptEnabled: Boolean

    init {
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.setGeolocationEnabled(true)
        settings.databaseEnabled = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.javaScriptCanOpenWindowsAutomatically = true

        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            isDocumentStartScriptEnabled = true
            // wry registers these for every frame ("*") and ignores for_main_frame_only, which put
            // __TAURI_INTERNALS__ into sealed applet frames. Main-frame origins only, plus a top-window guard.
            for (script in initScripts) {
                WebViewCompat.addDocumentStartJavaScript(this, script, MainFrameOnly.ORIGINS);
            }
        } else {
          isDocumentStartScriptEnabled = false
        }

        
    }

    fun loadUrlMainThread(url: String) {
        post {
          loadUrl(url)
        }
    }

    fun loadUrlMainThread(url: String, additionalHttpHeaders: Map<String, String>) {
        post {
          loadUrl(url, additionalHttpHeaders)
        }
    }

    override fun loadUrl(url: String) {
        if (!Rust.shouldOverride(id, url)) {
            super.loadUrl(url);
        }
    }

    override fun loadUrl(url: String, additionalHttpHeaders: Map<String, String>) {
        if (!Rust.shouldOverride(id, url)) {
            super.loadUrl(url, additionalHttpHeaders);
        }
    }

    fun loadHTMLMainThread(html: String) {
        post {
          super.loadData(html, "text/html", null)
        }
    }

    fun evalScript(id: Int, script: String) {
        post {
            super.evaluateJavascript(script) { result ->
                Rust.onEval(this.id, id, result)
            }
        }
    }

    fun clearAllBrowsingData() {
        try {
            super.getContext().deleteDatabase("webviewCache.db")
            super.getContext().deleteDatabase("webview.db")
            super.clearCache(true)
            super.clearHistory()
            super.clearFormData()
        } catch (ex: Exception) {
            Logger.error("Unable to create temporary media capture file: " + ex.message)
        }
    }

    fun getCookies(url: String): String {
        val cookieManager = CookieManager.getInstance()
        return cookieManager.getCookie(url)
    }

    
}
