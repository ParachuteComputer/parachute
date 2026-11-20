package computer.parachute.app

// Hand-written. The Rust side's way to NotifyService.kt (src-tauri/src/notify.rs checks the list first): keep what
// granted applets asked to be told about, ask for the notification permission when Rust says to (Android 13+: once, the
// first time it is needed, never again by itself; notify.rs `take_ask`), start or stop the service to match, and open
// the phone's notification settings for Parachute. Registered from Rust; no JavaScript-facing permission.

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONArray

@InvokeArg
class ConfigureArgs {
  lateinit var entries: String
  var signals: String? = null
  /** Rust's word that this is the one time to ask for the permission. */
  var ask: Boolean = false
}

@TauriPlugin
class NotifyPlugin(private val activity: Activity) : Plugin(activity) {
  private fun status(): JSObject {
    val out = JSObject()
    out.put("running", NotifyService.running)
    out.put("permission", NotificationManagerCompat.from(activity).areNotificationsEnabled())
    out.put("entries", try { JSONArray(NotifyService.saved(activity)).length() } catch (e: Exception) { 0 })
    return out
  }

  @Command
  fun configure(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(ConfigureArgs::class.java)
      val n = JSONArray(args.entries).length()
      if (!NotifyService.save(activity, args.entries) || !NotifyService.saveSignals(activity, args.signals ?: "[]")) {
        invoke.reject("could not keep the list")
        return
      }
      if (args.ask && n > 0 && Build.VERSION.SDK_INT >= 33 &&
        ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
      ) {
        // the service runs without it; what it would show waits until the person allows it (Settings opens the switch)
        ActivityCompat.requestPermissions(activity, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 7301)
      }
      NotifyService.sync(activity)
      // `running` is the service as it was a moment ago; `on` is what was just asked of it
      val out = status()
      out.put("on", n > 0)
      invoke.resolve(out)
    } catch (e: Exception) {
      invoke.reject("notifications couldn't be set: ${e.javaClass.simpleName}")
    }
  }

  @Command
  fun status(invoke: Invoke) {
    invoke.resolve(status())
  }

  @Command
  fun openSettings(invoke: Invoke) {
    try {
      activity.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, activity.packageName))
      invoke.resolve()
    } catch (e: Exception) {
      invoke.reject("the phone's settings couldn't be opened: ${e.javaClass.simpleName}")
    }
  }
}
