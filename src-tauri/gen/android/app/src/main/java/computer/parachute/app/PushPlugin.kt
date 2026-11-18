package computer.parachute.app

// Hand-written. The Rust side's way to the UnifiedPush connector (src-tauri/src/notify.rs): which distributors are
// installed, use one (the person's pick, else the one in use or the only one) and wait for its endpoint, hand Rust the
// endpoint and push keys for a gateway registration, and the fallback listener's switch. Registered from Rust; no
// JavaScript-facing permission.

import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.unifiedpush.android.connector.INSTANCE_DEFAULT
import org.unifiedpush.android.connector.UnifiedPush

@InvokeArg
class PushSetupArgs {
  var distributor: String? = null
  var fallback: Boolean? = null
}

@InvokeArg
class PushRegisteredArgs {
  lateinit var pairs: String
}

@TauriPlugin
class PushPlugin(private val activity: Activity) : Plugin(activity) {
  companion object {
    private const val WAIT_MS = 20_000L
    private val main = Handler(Looper.getMainLooper())
    // setups waiting for the distributor's answer (answered on the main thread)
    private val waiting = ArrayList<() -> Unit>()

    /** PushService.kt: the distributor answered (an endpoint, or none). */
    fun endpointChanged(ctx: Context, ok: Boolean) {
      main.post {
        val w = ArrayList(waiting)
        waiting.clear()
        w.forEach { it() }
      }
    }
  }

  private fun label(pkg: String): String = try {
    val pm = activity.packageManager
    pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
  } catch (e: PackageManager.NameNotFoundException) { pkg }

  private fun status(): JSObject {
    val out = JSObject()
    val ds = JSArray()
    for (d in UnifiedPush.getDistributors(activity)) ds.put(JSObject().put("id", d).put("name", label(d)))
    out.put("distributors", ds)
    out.put("distributor", UnifiedPush.getAckDistributor(activity) ?: UnifiedPush.getSavedDistributor(activity))
    out.put("endpoint", PushService.endpoint(activity) != null)
    out.put("fallback", NotifyService.fallbackOn(activity))
    return out
  }

  @Command
  fun status(invoke: Invoke) {
    invoke.resolve(status())
  }

  /** The (gateway, relay) pairs Rust registered: the fallback listener leaves those to push (NotifyService.listening). */
  @Command
  fun registered(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(PushRegisteredArgs::class.java)
      PushService.setRegistered(activity, org.json.JSONArray(args.pairs).toString())
      NotifyService.sync(activity)
      invoke.resolve(status())
    } catch (e: Exception) {
      invoke.reject("couldn't keep the registrations: ${e.javaClass.simpleName}")
    }
  }

  /** The endpoint and keys, for the registration Rust signs; rejected when there is none yet. */
  @Command
  fun endpoint(invoke: Invoke) {
    val e = PushService.endpoint(activity) ?: return invoke.reject("no endpoint yet")
    invoke.resolve(JSObject(e.toString()))
  }

  @Command
  fun setup(invoke: Invoke) {
    val args = try { invoke.parseArgs(PushSetupArgs::class.java) } catch (e: Exception) { PushSetupArgs() }
    args.fallback?.let { on ->
      NotifyService.setFallback(activity, on)
      NotifyService.sync(activity)
      return invoke.resolve(status())
    }
    val installed = UnifiedPush.getDistributors(activity)
    val pick = args.distributor?.takeIf { it in installed }
      ?: UnifiedPush.getAckDistributor(activity)
      ?: UnifiedPush.getSavedDistributor(activity)?.takeIf { it in installed }
      ?: installed.singleOrNull()
    if (args.distributor != null && pick != args.distributor) return invoke.reject("that push service isn't installed")
    if (pick == null) {
      // several and none chosen: the person picks one in Settings (no chooser pops up on its own)
      return invoke.reject(if (installed.isEmpty()) "no push service installed" else "pick a push service in Settings")
    }
    UnifiedPush.saveDistributor(activity, pick)
    register(invoke)
  }

  /** Ask the distributor for an endpoint and answer when it gives one (or after a while, with the state as it is). */
  private fun register(invoke: Invoke) {
    var done = false
    val answer = { if (!done) { done = true; invoke.resolve(status()) } }
    main.post { waiting.add(answer) }
    main.postDelayed({ waiting.remove(answer); answer() }, WAIT_MS)
    UnifiedPush.register(activity, INSTANCE_DEFAULT, "Parachute: messages for you while it is closed", null)
  }
}
