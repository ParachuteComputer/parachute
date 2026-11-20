package computer.parachute.app

// Hand-written. Notifications while the app is closed, the main path (docs/design/SERVICES.md, "Notifications through
// an open push service"): the person's UnifiedPush distributor (ntfy, from F-Droid, or another; no Google services)
// holds one connection for every app on the phone and hands this receiver what an applet's push gateway sent. Android
// starts it in a fresh process after the app was swiped away; it is plain Kotlin (no Rust, no web view), and posts
// through MessageNotices.kt, the one notification path.
//
// Each gateway gets its own UnifiedPush instance (named by the gateway's origin, `instanceFor`): its own endpoint and
// push keys, so one gateway can't push as another. A push is the gateway's minimal JSON — {v: 1, relay, room, event,
// kind, why, to} — sealed (RFC 8291) to that instance's keys; one that doesn't open with them is dropped, so the push
// server (or anyone who learns the endpoint) can't make a notification. It is shown only for what an allowed applet
// asked (the list NotifyPlugin.kt keeps: one whose gateway owns the instance the push came in on, for the key the phone
// uses now (`to` is `me`), on the push's relay, for a room it named or any, mentions or `from`), as "A message for you
// in <room>". Nothing from a push is written to the log beyond that one arrived.

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import org.unifiedpush.android.connector.FailedReason
import org.unifiedpush.android.connector.UnifiedPush
import org.unifiedpush.android.connector.data.PushEndpoint
import org.unifiedpush.android.connector.data.PushMessage

class PushService : org.unifiedpush.android.connector.PushService() {
  companion object {
    private const val TAG = "ParachutePush"
    private const val PREFS = "parachute_push"
    private val ROOM = Regex("^[A-Za-z0-9_-]{1,64}$")
    private val HEX_KEY = Regex("^[0-9a-f]{64}$")
    private val GID = Regex("^[A-Za-z0-9_-]{8,64}$")
    private val SIGNAL = Regex("^[a-z0-9]+(-[a-z0-9]+)*$")

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** The UnifiedPush instance for a gateway: its origin (scheme, host, port). The one place it is worked out. */
    fun instanceFor(gateway: String): String? = try {
      val u = java.net.URI(gateway)
      val scheme = u.scheme?.lowercase()
      val host = u.host?.lowercase()
      if (scheme == null || host == null) null else "$scheme://$host" + (if (u.port != -1) ":${u.port}" else "")
    } catch (e: Exception) { null }

    /** The endpoint and keys the distributor gave this instance, or null before it has (or after it took them back). */
    fun endpoint(ctx: Context, instance: String): JSONObject? {
      val raw = prefs(ctx).getString("ep:$instance", null) ?: return null
      return try { JSONObject(raw) } catch (e: Exception) { null }
    }

    /** Has any instance an endpoint (Settings: "connected"). */
    fun anyEndpoint(ctx: Context): Boolean = prefs(ctx).all.keys.any { it.startsWith("ep:") }

    /** The instances asked of the distributor (to move them when the person picks another). */
    fun instances(ctx: Context): List<String> {
      val a = try { JSONArray(prefs(ctx).getString("instances", "[]")) } catch (e: Exception) { JSONArray() }
      return (0 until a.length()).map { a.optString(it) }.filter { it.isNotEmpty() }
    }

    fun asked(ctx: Context, instance: String) {
      if (instance in instances(ctx)) return
      prefs(ctx).edit().putString("instances", JSONArray(instances(ctx) + instance).toString()).commit()
    }

    fun forget(ctx: Context, instance: String) { prefs(ctx).edit().remove("ep:$instance").commit() }

    /** The instance is let go: not asked for any more, no endpoint kept. */
    fun drop(ctx: Context, instance: String) {
      prefs(ctx).edit().remove("ep:$instance").putString("instances", JSONArray(instances(ctx) - instance).toString()).commit()
    }

    /** Let an instance go at the distributor, keeping the person's pick: the connector forgets the saved distributor
     *  when its last instance is unregistered, and the next gateway's instance is asked of the same one. */
    fun unregister(ctx: Context, instance: String) {
      val pick = UnifiedPush.getSavedDistributor(ctx)
      try { UnifiedPush.unregister(ctx, instance) } catch (e: Exception) { }
      if (pick != null && UnifiedPush.getSavedDistributor(ctx) == null) UnifiedPush.saveDistributor(ctx, pick)
    }

    /** Before one instance per gateway, the default instance held the one endpoint: forget it. True when there was one
     *  (the caller unregisters it from the distributor). */
    fun dropLegacy(ctx: Context): Boolean {
      val p = prefs(ctx)
      if (!p.contains("endpoint")) return false
      p.edit().remove("endpoint").remove("p256dh").remove("auth").commit()
      return true
    }

    /** The (gateway, relay) pairs the shell registered (JSON), kept for NotifyService.listening. */
    fun registered(ctx: Context): String = prefs(ctx).getString("registered", "[]") ?: "[]"

    fun setRegistered(ctx: Context, pairs: String) { prefs(ctx).edit().putString("registered", pairs).commit() }

    /** The instances some registered (gateway, relay) pair still uses. */
    fun inUse(ctx: Context): Set<String> {
      val a = try { JSONArray(registered(ctx)) } catch (e: Exception) { return emptySet() }
      return (0 until a.length()).mapNotNull { a.optJSONObject(it)?.optString("gateway")?.let(::instanceFor) }.toSet()
    }

    /** Is this applet's ask served by push: a registration for its gateway and relay, and an endpoint to push to? */
    fun serves(ctx: Context, gateway: String, relay: String): Boolean {
      val instance = instanceFor(gateway) ?: return false
      if (endpoint(ctx, instance) == null) return false
      // a distributor uninstalled since keeps its endpoint here but delivers nothing: then push serves nobody
      val using = org.unifiedpush.android.connector.UnifiedPush.getAckDistributor(ctx)
        ?: org.unifiedpush.android.connector.UnifiedPush.getSavedDistributor(ctx) ?: return false
      if (using !in org.unifiedpush.android.connector.UnifiedPush.getDistributors(ctx)) return false
      val a = try { JSONArray(registered(ctx)) } catch (e: Exception) { return false }
      return (0 until a.length()).any { a.optJSONObject(it)?.let { p -> p.optString("gateway") == gateway && p.optString("relay") == relay } == true }
    }
  }

  override fun onNewEndpoint(endpoint: PushEndpoint, instance: String) {
    if (instance !in instances(this)) {
      // an instance this app no longer asks for (the default one, from before one per gateway): let go there too
      Log.i(TAG, "an endpoint for an instance not in use: unregistered")
      unregister(this, instance)
      return
    }
    val keys = endpoint.pubKeySet
    if (keys == null) {
      // without keys a push can't be sealed to this phone: no registration is made with it
      Log.w(TAG, "the distributor gave an endpoint without push keys")
      forget(this, instance)
      PushPlugin.endpointChanged(this, instance, false)
      return
    }
    val e = JSONObject().put("endpoint", endpoint.url).put("p256dh", keys.pubKey).put("auth", keys.auth)
    prefs(this).edit().putString("ep:$instance", e.toString()).commit()
    Log.i(TAG, "the distributor gave an endpoint")
    // the fallback listener stops for what push now serves
    try { NotifyService.sync(this) } catch (e: Exception) { }
    PushPlugin.endpointChanged(this, instance, true)
  }

  override fun onRegistrationFailed(reason: FailedReason, instance: String) {
    // asked again with an endpoint kept (once a run: PushPlugin.endpoint) and refused this time (offline, a hiccup):
    // the endpoint that was working stays, rather than push and the own connection both serving one applet
    Log.w(TAG, "the distributor refused the registration: $reason")
    if (endpoint(this, instance) == null) forget(this, instance)
    PushPlugin.endpointChanged(this, instance, false)
  }

  override fun onUnregistered(instance: String) {
    Log.i(TAG, "unregistered from the distributor")
    forget(this, instance)
    try { NotifyService.sync(this) } catch (e: Exception) { }
    PushPlugin.endpointChanged(this, instance, false)
  }

  override fun onMessage(message: PushMessage, instance: String) {
    if (!message.decrypted) {
      Log.w(TAG, "a push that didn't open with this phone's keys: dropped")
      return
    }
    val o = try { JSONObject(String(message.content, Charsets.UTF_8)) } catch (e: Exception) { null }
    if (o?.optString("kind") == "signal") return onSignal(o, instance)
    val relay = o?.optString("relay") ?: ""
    val room = o?.optString("room") ?: ""
    val event = o?.optString("event") ?: ""
    val why = o?.optString("why") ?: ""
    val to = o?.optString("to") ?: ""
    if (o == null || o.optInt("v") != 1 || o.optInt("kind") != 9 || relay.isEmpty() || !ROOM.matches(room) || !HEX_KEY.matches(event) || why !in setOf("mention", "from") || !HEX_KEY.matches(to)) {
      Log.w(TAG, "a push that isn't a gateway's: dropped")
      return
    }
    val entry = entryFor(instance, to, relay, room, why)
    if (entry == null) {
      // also a push from a gateway on another's instance, or for a key this phone no longer uses
      Log.i(TAG, "a push no allowed applet asked for: dropped")
      return
    }
    // a gateway that restarts reads back a little and may push a message again: shown once (counted only for a push
    // that passed the checks above, so a dropped one can't hide the real one)
    if (!firstTime(event)) {
      Log.i(TAG, "a push already shown: dropped")
      return
    }
    Log.i(TAG, "a push for an allowed applet")
    if (!MessageNotices.mayShow(this)) return
    val name = entry.optJSONObject("names")?.optString(room)?.takeIf { it.isNotBlank() }
    val title = if (name != null) "A message for you in $name" else "A message for you"
    val text = if (why == "mention") "It names you" else "From someone you listen for"
    val link = MessageNotices.link(entry.getString("subject"), room, event)
    MessageNotices.add(this, room, text, MessageNotices.Newest(title, text, entry.optString("name"), link, System.currentTimeMillis()))
    MessageNotices.flush(this, listOf(room))
  }

  /** A count changed (docs/design/APP-RECORD.md "Signals"): `{v: 1, kind: "signal", subject, signal, count, to}`. Shown
   *  for an allowed applet's signal whose gateway owns the instance it came in on, for the key the phone uses now, as
   *  "Ideas · 2 new" over the signal's own words; a count of 0 (opened on another device) takes it away. */
  private fun onSignal(o: JSONObject, instance: String) {
    val subject = o.optString("subject")
    val signal = o.optString("signal")
    val to = o.optString("to")
    val count = o.optInt("count", -1)
    if (o.optInt("v") != 1 || !GID.matches(subject) || signal.length > 40 || !SIGNAL.matches(signal) || count < 0 || count > 9999 || !HEX_KEY.matches(to)) {
      Log.w(TAG, "a signal push that isn't a gateway's: dropped")
      return
    }
    val all = try { JSONArray(NotifyService.savedSignals(this)) } catch (e: Exception) { JSONArray() }
    val entry = (0 until all.length()).mapNotNull { all.optJSONObject(it) }.firstOrNull {
      it.optString("gid") == subject && it.optString("signal") == signal && instanceFor(it.optString("gateway")) == instance && it.optString("me") == to
    }
    if (entry == null) {
      Log.i(TAG, "a signal no allowed applet sends here: dropped")
      return
    }
    Log.i(TAG, "a signal for an allowed applet")
    val tag = "$subject/$signal"
    if (count == 0) { MessageNotices.clearSignal(this, tag); return }
    if (!MessageNotices.mayShow(this)) return
    val name = entry.optString("name")
    MessageNotices.signal(this, tag, "$name · $count new", entry.optString("label"), count, MessageNotices.link(entry.optString("subject"), null, null))
  }

  /** Not seen before (the last 200 event ids pushed are kept). */
  private fun firstTime(event: String): Boolean {
    val p = prefs(this)
    val ids = (p.getString("pushed", "") ?: "").split(" ").filter { it.isNotEmpty() }
    if (event in ids) return false
    p.edit().putString("pushed", (ids.takeLast(199) + event).joinToString(" ")).apply()
    return true
  }

  /** The allowed applet this push is for: one whose gateway owns the instance it came in on, for the key the phone uses
   *  now, on this relay, for this room (or all of its rooms), asking for this kind of message. */
  private fun entryFor(instance: String, to: String, relay: String, room: String, why: String): JSONObject? {
    val all = try { JSONArray(NotifyService.saved(this)) } catch (e: Exception) { return null }
    for (i in 0 until all.length()) {
      val e = all.optJSONObject(i) ?: continue
      val gateway = e.optString("gateway")
      if (gateway.isEmpty() || instanceFor(gateway) != instance || e.optString("me") != to || e.optString("relay") != relay) continue
      val rooms = e.optJSONArray("rooms")
      if (rooms != null && (0 until rooms.length()).none { rooms.optString(it) == room }) continue
      val asks = if (why == "mention") e.optBoolean("mentions") else (e.optJSONArray("from")?.length() ?: 0) > 0
      if (asks) return e
    }
    return null
  }
}
