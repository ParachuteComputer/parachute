package computer.parachute.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.enableEdgeToEdge

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
  }
}
