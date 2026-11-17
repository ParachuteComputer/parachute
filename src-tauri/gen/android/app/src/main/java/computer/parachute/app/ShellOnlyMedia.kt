package computer.parachute.app

// Hand-written. wry's RustWebChromeClient (generated/, rewritten on every build) grants every page and frame any
// media it asks for. RustWebView.setWebChromeClient wraps it in this: the microphone goes only to the shell's own
// page (an app origin, MainFrameOnly.ORIGINS), for the recorder sheet (docs/design/KEYRING.md "Voice, files, links,
// storage"); anything else, and any camera, is denied. Every other call goes to wry's client unchanged.

import android.net.Uri
import android.util.Log
import android.view.View
import android.webkit.ConsoleMessage
import android.webkit.GeolocationPermissions
import android.webkit.JsPromptResult
import android.webkit.JsResult
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView

class ShellOnlyMedia(private val inner: WebChromeClient) : WebChromeClient() {
  companion object {
    private const val TAG = "ParachuteShellOnlyMedia"

    /** scheme://host[:port] in lower case, the default port left out; "" when it has no host (an opaque origin). */
    fun originOf(uri: Uri?): String {
      val scheme = uri?.scheme?.lowercase() ?: return ""
      val host = uri.host?.lowercase()?.takeIf { it.isNotEmpty() } ?: return ""
      val port = uri.port
      val defaultPort = (scheme == "http" && port == 80) || (scheme == "https" && port == 443)
      return if (port == -1 || defaultPort) "$scheme://$host" else "$scheme://$host:$port"
    }
  }

  override fun onPermissionRequest(request: PermissionRequest) {
    val resources = request.resources ?: emptyArray()
    val audioOnly = resources.isNotEmpty() && resources.all { it == PermissionRequest.RESOURCE_AUDIO_CAPTURE }
    val origin = originOf(request.origin)
    if (audioOnly && origin in MainFrameOnly.ORIGINS) {
      // wry's client asks Android for the microphone, then grants what was asked: audio only.
      inner.onPermissionRequest(request)
    } else {
      Log.w(TAG, "denied ${resources.joinToString()} to ${origin.ifEmpty { "a frame without an origin" }}")
      request.deny()
    }
  }

  override fun onShowFileChooser(
    webView: WebView,
    filePathCallback: ValueCallback<Array<Uri?>?>,
    fileChooserParams: FileChooserParams
  ): Boolean = inner.onShowFileChooser(webView, filePathCallback, fileChooserParams)

  override fun onShowCustomView(view: View, callback: CustomViewCallback) = inner.onShowCustomView(view, callback)

  override fun onHideCustomView() = inner.onHideCustomView()

  override fun onJsAlert(view: WebView, url: String, message: String, result: JsResult): Boolean =
    inner.onJsAlert(view, url, message, result)

  override fun onJsConfirm(view: WebView, url: String, message: String, result: JsResult): Boolean =
    inner.onJsConfirm(view, url, message, result)

  override fun onJsPrompt(view: WebView, url: String, message: String, defaultValue: String, result: JsPromptResult): Boolean =
    inner.onJsPrompt(view, url, message, defaultValue, result)

  override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) =
    inner.onGeolocationPermissionsShowPrompt(origin, callback)

  override fun onConsoleMessage(consoleMessage: ConsoleMessage): Boolean = inner.onConsoleMessage(consoleMessage)

  override fun onReceivedTitle(view: WebView, title: String) = inner.onReceivedTitle(view, title)
}
