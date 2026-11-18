package computer.parachute.app

// Hand-written. The Rust side's way to the UnifiedPush connector (src-tauri/src/notify.rs): which distributors are
// installed, use one (the person's pick, else the one in use or the only one), hand Rust a gateway's endpoint and push
// keys for its registration (one UnifiedPush instance per gateway, asked for when first needed and let go when no
// registration uses it), and the fallback listener's switch. Registered from Rust; no JavaScript-facing permission.

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

@InvokeArg
class PushEndpointArgs {
  lateinit var gateway: String
}

@TauriPlugin
class PushPlugin(private val activity: Activity) : Plugin(activity) {
  companion object {
    private const val WAIT_MS = 20_000L
    private val main = Handler(Looper.getMainLooper())
    private const val ANY = "*"
    // calls waiting for the distributor's answer, by instance (ANY: whichever answers first); on the main thread
    private val waiting = HashMap<String, ArrayList<() -> Unit>>()
    // the instances asked again of the distributor in this run of the app
    private val refreshed = HashMap<String, Long>()

    /** PushService.kt: the distributor answered for this instance (an endpoint, or none). */
    fun endpointChanged(ctx: Context, instance: String, ok: Boolean) {
      main.post {
        val w = (waiting.remove(instance) ?: arrayListOf()) + (waiting.remove(ANY) ?: arrayListOf())
        w.forEach { it() }
      }
    }
  }

  private val message = "Parachute: messages for you while it is closed"

  /** Answer when the distributor answers for `instance` (or ANY), or after a while with things as they are. */
  private fun await(instance: String, ms: Long = WAIT_MS, answer: () -> Unit) {
    var done = false
    val once = { if (!done) { done = true; answer() } }
    main.post { waiting.getOrPut(instance) { ArrayList() }.add(once) }
    main.postDelayed({ waiting[instance]?.remove(once); once() }, ms)
  }

  /** The default instance from before one per gateway: let go once. */
  private fun dropLegacy() {
    if (PushService.dropLegacy(activity)) PushService.unregister(activity, INSTANCE_DEFAULT)
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
    out.put("endpoint", PushService.anyEndpoint(activity))
    out.put("fallback", NotifyService.fallbackOn(activity))
    // what the own connection is serving now (nothing: it isn't running)
    out.put("listening", NotifyService.listening(activity).length())
    return out
  }

  @Command
  fun status(invoke: Invoke) {
    invoke.resolve(status())
  }

  /** The (gateway, relay) pairs Rust registered: the fallback listener leaves those to push (NotifyService.listening),
   *  and an instance no pair uses any more is let go at the distributor. */
  @Command
  fun registered(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(PushRegisteredArgs::class.java)
      PushService.setRegistered(activity, org.json.JSONArray(args.pairs).toString())
      val used = PushService.inUse(activity)
      for (i in PushService.instances(activity)) if (i !in used) {
        PushService.drop(activity, i)
        PushService.unregister(activity, i)
      }
      NotifyService.sync(activity)
      invoke.resolve(status())
    } catch (e: Exception) {
      invoke.reject("couldn't keep the registrations: ${e.javaClass.simpleName}")
    }
  }

  /** This gateway's endpoint and keys, for the registration Rust signs: its instance's, asked of the distributor the
   *  first time (and waited for); rejected when there is none. */
  @Command
  fun endpoint(invoke: Invoke) {
    val gateway = try { invoke.parseArgs(PushEndpointArgs::class.java).gateway } catch (e: Exception) { "" }
    val instance = PushService.instanceFor(gateway) ?: return invoke.reject("not a gateway's address")
    dropLegacy()
    val saved = UnifiedPush.getSavedDistributor(activity)
    // a distributor gone since: no endpoint to hand out (the gateway's registration then lapses; the own connection serves)
    if (saved == null || saved !in UnifiedPush.getDistributors(activity)) return invoke.reject("pick a push service in Settings")
    val kept = PushService.endpoint(activity, instance)
    // asked again of the distributor once per install of it (UnifiedPush's advice): one reinstalled since doesn't know
    // the old endpoint and answers with a new one, which then goes to the gateway. With one kept, the wait is short.
    val install = try { activity.packageManager.getPackageInfo(saved, 0).firstInstallTime } catch (e: Exception) { 0L }
    if (kept != null && refreshed[instance] == install) return invoke.resolve(JSObject(kept.toString()))
    refreshed[instance] = install
    PushService.asked(activity, instance)
    await(instance, if (kept != null) 5_000L else WAIT_MS) {
      val e = PushService.endpoint(activity, instance)
      if (e != null) invoke.resolve(JSObject(e.toString())) else invoke.reject("no endpoint yet")
    }
    UnifiedPush.register(activity, instance, message, null)
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
    dropLegacy()
    val moved = pick != UnifiedPush.getSavedDistributor(activity)
    UnifiedPush.saveDistributor(activity, pick)
    val instances = PushService.instances(activity)
    if (instances.isEmpty()) return invoke.resolve(status()) // each gateway's instance is asked for when it registers
    // every gateway's instance with this distributor; a new one's endpoints replace the old (Rust registers them again)
    if (moved) instances.forEach { PushService.forget(activity, it) }
    await(ANY) { invoke.resolve(status()) }
    instances.forEach { UnifiedPush.register(activity, it, message, null) }
  }
}
