package computer.parachute.app

// Hand-written. The Rust side's way to NotifyService.kt (src-tauri/src/notify.rs checks the list first): keep what
// granted applets asked to be told about, ask for the notification permission the first time it is needed (Android 13+),
// and start or stop the service to match. Registered from Rust; no JavaScript-facing permission.

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Build
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
      if (n > 0 && Build.VERSION.SDK_INT >= 33 &&
        ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
      ) {
        // the service runs without it; what it would show waits until the person allows it
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
}
