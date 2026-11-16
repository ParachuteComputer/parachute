package computer.parachute.app

import android.content.Intent
import android.content.res.Configuration
import android.os.Bundle
import android.view.View
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
      WindowInsetsCompat.Builder(insets).setInsets(sides, Insets.NONE).setInsets(WindowInsetsCompat.Type.ime(), Insets.NONE).build()
    }
  }

  // The strips follow the page's light or dark ground (the activity isn't recreated when the mode changes).
  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    paintGround(findViewById(android.R.id.content))
  }

  private fun paintGround(v: View) {
    val night = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    v.setBackgroundColor(if (night) 0xFF171613.toInt() else 0xFFF2EDE2.toInt())
  }

  // A link tapped while the activity exists becomes its intent: if the deep-link plugin isn't loaded yet (the process was
  // just recreated), it reads the link from here when it loads; a later recreate still drops it (above).
  override fun onNewIntent(intent: Intent) {
    setIntent(intent)
    super.onNewIntent(intent)
  }
}
