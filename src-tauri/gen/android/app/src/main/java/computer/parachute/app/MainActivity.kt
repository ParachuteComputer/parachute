package computer.parachute.app

import android.content.Intent
import android.content.res.Configuration
import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
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
    // buttons or gesture line. So the page sits inside the system bars (and a camera cutout), with the app's paper
    // colour in the strips around it.
    val content = findViewById<View>(android.R.id.content)
    val night = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    content.setBackgroundColor(if (night) 0xFF201E1A.toInt() else 0xFFFBF8F1.toInt())
    ViewCompat.setOnApplyWindowInsetsListener(content) { v, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      insets
    }
  }

  // A link tapped while the activity exists becomes its intent: if the deep-link plugin isn't loaded yet (the process was
  // just recreated), it reads the link from here when it loads; a later recreate still drops it (above).
  override fun onNewIntent(intent: Intent) {
    setIntent(intent)
    super.onNewIntent(intent)
  }
}
