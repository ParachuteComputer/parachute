package computer.parachute.app

// Hand-written. Notifications while the app is closed, the main path (docs/design/SERVICES.md, "Notifications through
// an open push service"): the person's UnifiedPush distributor (ntfy, from F-Droid, or another; no Google services)
// holds one connection for every app on the phone and hands this receiver what an applet's push gateway sent. Android
// starts it in a fresh process after the app was swiped away; it is plain Kotlin (no Rust, no web view), and posts
// through MessageNotices.kt, the one notification path.
//
// A push is the gateway's minimal JSON — {v: 1, relay, room, event, kind, why} — sealed (RFC 8291) to keys the
// connector made for this phone; one that doesn't open with them is dropped, so the push server (or anyone who learns the
// endpoint) can't make a notification. It is shown only for what an allowed applet asked (the list NotifyPlugin.kt
// keeps: one that names a gateway, on the push's relay, for a room it named or any, mentions or `from`), as "A message
// for you in <room>". (The push doesn't say which gateway sent it; only a gateway this phone registered with has its keys.)
// Nothing from a push is written to the log beyond that one arrived.

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import org.unifiedpush.android.connector.FailedReason
import org.unifiedpush.android.connector.data.PushEndpoint
import org.unifiedpush.android.connector.data.PushMessage

class PushService : org.unifiedpush.android.connector.PushService() {
  companion object {
    private const val TAG = "ParachutePush"
    private const val PREFS = "parachute_push"
    private val ROOM = Regex("^[A-Za-z0-9_-]{1,64}$")
    private val EVENT = Regex("^[0-9a-f]{64}$")

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** The endpoint and keys the distributor gave this phone, or null before it has (or after it took them back). */
    fun endpoint(ctx: Context): JSONObject? {
      val p = prefs(ctx)
      val url = p.getString("endpoint", null) ?: return null
      val key = p.getString("p256dh", null) ?: return null
      val auth = p.getString("auth", null) ?: return null
      return JSONObject().put("endpoint", url).put("p256dh", key).put("auth", auth)
    }

    fun forget(ctx: Context) {
      val registered = registered(ctx)
      prefs(ctx).edit().clear().putString("registered", registered).commit()
    }

    /** The (gateway, relay) pairs the shell registered (JSON), kept for NotifyService.listening. */
    fun registered(ctx: Context): String = prefs(ctx).getString("registered", "[]") ?: "[]"

    fun setRegistered(ctx: Context, pairs: String) { prefs(ctx).edit().putString("registered", pairs).commit() }

    /** Is this applet's ask served by push: a registration for its gateway and relay, and an endpoint to push to? */
    fun serves(ctx: Context, gateway: String, relay: String): Boolean {
      if (gateway.isEmpty() || endpoint(ctx) == null) return false
      val a = try { JSONArray(registered(ctx)) } catch (e: Exception) { return false }
      return (0 until a.length()).any { a.optJSONObject(it)?.let { p -> p.optString("gateway") == gateway && p.optString("relay") == relay } == true }
    }
  }

  override fun onNewEndpoint(endpoint: PushEndpoint, instance: String) {
    val keys = endpoint.pubKeySet
    if (keys == null) {
      // without keys a push can't be sealed to this phone: no registration is made with it
      Log.w(TAG, "the distributor gave an endpoint without push keys")
      forget(this)
      PushPlugin.endpointChanged(this, false)
      return
    }
    prefs(this).edit().putString("endpoint", endpoint.url).putString("p256dh", keys.pubKey).putString("auth", keys.auth).commit()
    Log.i(TAG, "the distributor gave an endpoint")
    // the fallback listener stops for what push now serves
    try { NotifyService.sync(this) } catch (e: Exception) { }
    PushPlugin.endpointChanged(this, true)
  }

  override fun onRegistrationFailed(reason: FailedReason, instance: String) {
    Log.w(TAG, "the distributor refused the registration: $reason")
    forget(this)
    PushPlugin.endpointChanged(this, false)
  }

  override fun onUnregistered(instance: String) {
    Log.i(TAG, "unregistered from the distributor")
    forget(this)
    try { NotifyService.sync(this) } catch (e: Exception) { }
    PushPlugin.endpointChanged(this, false)
  }

  override fun onMessage(message: PushMessage, instance: String) {
    if (!message.decrypted) {
      Log.w(TAG, "a push that didn't open with this phone's keys: dropped")
      return
    }
    val o = try { JSONObject(String(message.content, Charsets.UTF_8)) } catch (e: Exception) { null }
    val relay = o?.optString("relay") ?: ""
    val room = o?.optString("room") ?: ""
    val event = o?.optString("event") ?: ""
    val why = o?.optString("why") ?: ""
    if (o == null || o.optInt("v") != 1 || o.optInt("kind") != 9 || relay.isEmpty() || !ROOM.matches(room) || !EVENT.matches(event) || why !in setOf("mention", "from")) {
      Log.w(TAG, "a push that isn't a gateway's: dropped")
      return
    }
    // a gateway that restarts reads back a little and may push a message again: shown once
    if (!firstTime(event)) {
      Log.i(TAG, "a push already shown: dropped")
      return
    }
    val entry = entryFor(relay, room, why)
    if (entry == null) {
      Log.i(TAG, "a push no allowed applet asked for: dropped")
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

  /** Not seen before (the last 200 event ids pushed are kept). */
  private fun firstTime(event: String): Boolean {
    val p = prefs(this)
    val ids = (p.getString("pushed", "") ?: "").split(" ").filter { it.isNotEmpty() }
    if (event in ids) return false
    p.edit().putString("pushed", (ids.takeLast(199) + event).joinToString(" ")).apply()
    return true
  }

  /** The allowed applet this push is for: one that named a gateway, on this relay, for this room (or all of its rooms),
   *  asking for this kind of message. */
  private fun entryFor(relay: String, room: String, why: String): JSONObject? {
    val all = try { JSONArray(NotifyService.saved(this)) } catch (e: Exception) { return null }
    for (i in 0 until all.length()) {
      val e = all.optJSONObject(i) ?: continue
      if (e.optString("gateway").isEmpty() || e.optString("relay") != relay) continue
      val rooms = e.optJSONArray("rooms")
      if (rooms != null && (0 until rooms.length()).none { rooms.optString(it) == room }) continue
      val asks = if (why == "mention") e.optBoolean("mentions") else (e.optJSONArray("from")?.length() ?: 0) > 0
      if (asks) return e
    }
    return null
  }
}
