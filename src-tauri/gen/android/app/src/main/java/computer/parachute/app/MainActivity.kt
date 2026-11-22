package computer.parachute.app

import android.content.Intent
import android.content.res.Configuration
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // A link the app was started with is handled once. When Android recreates the activity (from recents after the
    // process was killed, or after a configuration change) it hands back the original intent, and the deep-link
    // plugin would report that link again to a fresh webview. Only a fresh launch carries its link.
    if (savedInstanceState != null || (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) {
      intent = Intent(Intent.ACTION_MAIN)
    }
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // Edge to edge, the page would draw under the status bar and the navigation bar, and the webviews in use (124 on the
    // emulator) report neither as a safe area: the app's bar at the foot of the screen would sit under the phone's own
    // buttons or gesture line. So the page sits inside the system bars, a camera cutout and the keyboard, with the app's
    // ground colour in the strips around it. The insets are used up here, so a webview that does report them as a safe
    // area doesn't pad the page twice.
    val content = findViewById<View>(android.R.id.content)
    paintGround(content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { v, insets ->
      val sides = WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      val bars = insets.getInsets(sides)
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      v.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
      // the keyboard up or down: the page's root says so (`keyboard-up`), and the app's bar steps aside while one types
      // (styles.css). Android knows; the page would only guess from its size.
      val up = ime.bottom > 0
      if (up != keyboardUp) {
        keyboardUp = up
        webView(v)?.evaluateJavascript("document.documentElement.classList.toggle('keyboard-up', $up)", null)
      }
      WindowInsetsCompat.Builder(insets).setInsets(sides, Insets.NONE).setInsets(WindowInsetsCompat.Type.ime(), Insets.NONE).build()
    }
  }

  private var keyboardUp = false

  private fun webView(v: View): WebView? = when (v) {
    is WebView -> v
    is ViewGroup -> (0 until v.childCount).firstNotNullOfOrNull { webView(v.getChildAt(it)) }
    else -> null
  }

  // The strips follow the page's light or dark ground (the activity isn't recreated when the mode changes).
  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    paintGround(findViewById(android.R.id.content))
  }

  private fun ground(): Int {
    val night = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    return if (night) 0xFF1A1814.toInt() else 0xFFFBF8F1.toInt()
  }

  private fun paintGround(v: View) {
    v.setBackgroundColor(ground())
    webView(v)?.setBackgroundColor(ground())
  }

  // The webview is white until the page draws its first frame (a white flash at every start): it starts on the app's
  // ground instead, as the strips around it do.
  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webView.setBackgroundColor(ground())
  }

  // While the app is in front, NotifyService shows nothing, and what it showed is cleared: the person is looking. (It is
  // also started again here if Android declined to restart it while the app was away.)
  override fun onResume() {
    super.onResume()
    NotifyService.appResumed(this)
  }

  override fun onPause() {
    NotifyService.appPaused(this)
    super.onPause()
  }

  // Every touch and key the app gets, the idle lock's clock (UnlockPlugin.touched; src-tauri/src/levels.rs): scrolling
  // inside an applet's frame counts too, which the page can't see.
  override fun onUserInteraction() {
    super.onUserInteraction()
    UnlockPlugin.touched()
  }

  // A link tapped while the activity exists becomes its intent: if the deep-link plugin isn't loaded yet (the process was
  // just recreated), it reads the link from here when it loads; a later recreate still drops it (above).
  override fun onNewIntent(intent: Intent) {
    setIntent(intent)
    super.onNewIntent(intent)
  }
}
