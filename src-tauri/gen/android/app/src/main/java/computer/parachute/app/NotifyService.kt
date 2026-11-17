package computer.parachute.app

// Hand-written. Notifications while the app is closed (docs/design/KEYRING.md, "Notifications while closed"): a
// foreground service (type remoteMessaging, its quiet ongoing line "Listening for your rooms") that keeps its own relay
// connection for what granted applets asked to be told about (the list NotifyPlugin.kt keeps; checked by notify.rs).
//
// It signs one thing, the relay's NIP-42 sign-in, through Rust (`signAuth`, notify.rs): the everyday key is decrypted
// from the Keystore for that call and the bytes are zeroed after. Then one subscription per room (Buzz sends live events
// only to a one-room subscription), paced under the relay's rate. A new message that names the person (`p`) or comes
// from a `from` key, never their own, is shown as "<who> in <room>" and its first words; a tap opens
// parachute://notify?subject=…&room=…&event=…. Nothing is shown while the app is in front, and what was shown is cleared
// when it comes back. Nothing about a message (and never the key) is written to the log.

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

class NotifyService : Service() {
  companion object {
    private const val TAG = "ParachuteNotify"
    private const val PREFS = "parachute_notify"
    private const val CHANNEL_LISTENING = "listening"
    private const val CHANNEL_MESSAGES = "messages"
    private const val GROUP = "computer.parachute.app.MESSAGES"
    private const val ONGOING_ID = 1
    private const val SUMMARY_ID = 2
    private const val MESSAGE_ID = 3 // one per room, tagged with the room id
    /** Buzz's limit for apps is a burst of 10 then 7 a second; one frame every 150 ms stays under it. */
    private const val PACE_MS = 150L
    private const val REDISCOVER_MIN = 15L
    /** The phone's and the relay's clocks differ: a message counts as new from this long before "now". */
    private const val SKEW_S = 10L
    /** A dead connection is noticed within two pings; after it, rooms are read again from this long before it was last up. */
    private const val GAP_S = 2 * 60L + SKEW_S
    /** A restarted service (the app's process ended) picks up where the last one was, if that was this recent. */
    private const val RESUME_S = 10 * 60L
    /** Messages that arrive together are shown together: one alert, one update per room. */
    private const val FLUSH_MS = 800L
    private const val MAX_TEXT = 140
    private const val MAX_LINES = 5

    /** MainActivity is resumed: nothing is shown. */
    @Volatile @JvmStatic var appInFront = false
    @Volatile @JvmStatic var running = false

    // what is shown, per room: unseen count, the last few lines and the newest message (the activity clears it from the
    // main thread; the service's thread writes it)
    private val lock = Any()
    private val unseen = HashMap<String, Int>()
    private val lines = HashMap<String, ArrayDeque<String>>()
    private val newest = HashMap<String, Newest>()

    private class Newest(val title: String, val text: String, val app: String, val link: String, val whenMs: Long)

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** The relay's NIP-42 sign-in for `relay` and `challenge`, signed with `secret` (the kept key's text). notify.rs. */
    @JvmStatic external fun signAuth(secret: ByteArray, relay: String, challenge: String): String?

    fun saved(ctx: Context): String = prefs(ctx).getString("entries", "[]") ?: "[]"

    fun save(ctx: Context, entries: String): Boolean = prefs(ctx).edit().putString("entries", entries).commit()

    /** Start (or reload) the service when the list asks for anything, stop it when it doesn't. */
    fun sync(ctx: Context) {
      val n = try { JSONArray(saved(ctx)).length() } catch (e: Exception) { 0 }
      val intent = Intent(ctx, NotifyService::class.java)
      if (n > 0) ContextCompat.startForegroundService(ctx, intent) else ctx.stopService(intent)
    }

    /** The key is going: forget the list and stop. */
    fun turnOff(ctx: Context) {
      save(ctx, "[]")
      ctx.stopService(Intent(ctx, NotifyService::class.java))
      clearShown(ctx)
    }

    /** The app is in front: what was shown is cleared, and the service is started again if the list asks for it and
     *  it isn't running (Android may have declined to restart it while the app was away). */
    fun appResumed(ctx: Context) {
      appInFront = true
      clearShown(ctx)
      if (!running) try { sync(ctx) } catch (e: Exception) { Log.w(TAG, "couldn't start: ${e.javaClass.simpleName}") }
    }

    /** The app leaves the front: what came before now, the person has had in front of them. */
    fun appPaused(ctx: Context) {
      appInFront = false
      prefs(ctx).edit().putLong("front", System.currentTimeMillis() / 1000).apply()
    }

    private fun clearShown(ctx: Context) {
      val rooms = synchronized(lock) {
        val r = unseen.keys.toList()
        unseen.clear()
        lines.clear()
        newest.clear()
        r
      }
      // the ones known here by name (one posted a moment ago may not be listed as active yet), then any others
      val nm = ctx.getSystemService(NotificationManager::class.java)
      for (r in rooms) nm.cancel(r, MESSAGE_ID)
      nm.cancel(SUMMARY_ID)
      for (s in nm.activeNotifications) if (s.id == MESSAGE_ID) nm.cancel(s.tag, s.id)
    }
  }

  private data class Entry(
    val relay: String, val me: String, val rooms: List<String>?, val mentions: Boolean, val from: Set<String>,
    val subject: String, val name: String,
  )

  // Everything runs on this one thread. OkHttp still calls back after the service is gone (a closing socket fails), and
  // a delayed task may still be waiting: once it is shut down, both are dropped rather than crash the app's process.
  private val exec = ScheduledThreadPoolExecutor(1).apply { executeExistingDelayedTasksAfterShutdownPolicy = false }

  private fun guarded(r: () -> Unit) = Runnable {
    try { r() } catch (e: Exception) { Log.w(TAG, "a task failed: ${e.javaClass.simpleName}") }
  }

  private fun post(r: () -> Unit) {
    try { exec.execute(guarded(r)) } catch (e: RejectedExecutionException) { }
  }

  private fun later(ms: Long, r: () -> Unit) {
    try { exec.schedule(guarded(r), ms, TimeUnit.MILLISECONDS) } catch (e: RejectedExecutionException) { }
  }

  private val http = OkHttpClient.Builder().pingInterval(60, TimeUnit.SECONDS).build()
  private val conns = HashMap<String, Conn>() // by relay and me
  private val authors = HashMap<String, String>() // pubkey -> name
  private val seen = LinkedHashSet<String>()
  /** Messages from this time on are new: now, or where a recent earlier run left off, never before the app was last in front. */
  private var fromS = 0L
  private var ticks: ScheduledFuture<*>? = null
  @Volatile private var lastStartId = 0
  private var reloaded = false // a connection made after the first reload is new from now
  private var wake: PowerManager.WakeLock? = null
  private var tick = 0L
  private val pending = LinkedHashSet<String>() // rooms with something to show at the next flush

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    try { System.loadLibrary("parachute_lib") } catch (e: UnsatisfiedLinkError) { Log.w(TAG, "native library not loaded") }
    val nm = getSystemService(NotificationManager::class.java)
    nm.createNotificationChannel(NotificationChannel(CHANNEL_LISTENING, "Listening for your rooms", NotificationManager.IMPORTANCE_LOW).apply {
      description = "Shown while Parachute listens for messages with the app closed."
      setShowBadge(false)
    })
    nm.createNotificationChannel(NotificationChannel(CHANNEL_MESSAGES, "Messages", NotificationManager.IMPORTANCE_HIGH).apply {
      description = "Messages that name you, or come from someone an applet listens for."
    })
    val now = System.currentTimeMillis() / 1000
    val alive = prefs(this).getLong("alive", 0L)
    val front = prefs(this).getLong("front", 0L)
    fromS = maxOf(if (now - alive <= RESUME_S) alive - GAP_S else now - SKEW_S, front)
    Log.i(TAG, "created")
    begin()
  }

  // Start listening, from wherever Android starts the service. Swiping the app away ends its process (Tauri exits with its
  // activity), and Android brings the service back in a new one: sometimes through onStartCommand, sometimes only through
  // onCreate and onTaskRemoved (when the old process ended before the task's removal was delivered).
  private fun begin(): Boolean {
    try {
      ServiceCompat.startForeground(this, ONGOING_ID, ongoing(), if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING else 0)
    } catch (e: Exception) {
      // Android 12+ refuses a foreground service started from the background (ForegroundServiceStartNotAllowedException)
      Log.w(TAG, "not allowed to run in the foreground: ${e.javaClass.simpleName}")
      stopSelf()
      return false
    }
    running = true
    post { reload() }
    return true
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    lastStartId = startId
    Log.i(TAG, if (intent == null) "started again by Android" else "started")
    return if (begin()) START_STICKY else START_NOT_STICKY
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    Log.i(TAG, "the app's task was removed")
    begin()
  }

  override fun onDestroy() {
    running = false
    post {
      conns.values.forEach { it.close() }
      conns.clear()
    }
    exec.shutdown()
    super.onDestroy()
  }

  private fun ongoing(): Notification {
    val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
    return NotificationCompat.Builder(this, CHANNEL_LISTENING)
      .setSmallIcon(R.drawable.ic_notify)
      .setContentTitle("Listening for your rooms")
      .setOngoing(true)
      .setSilent(true)
      .setShowWhen(false)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .setContentIntent(open)
      .build()
  }

  // ---- the list -----------------------------------------------------------------------------------------------------

  private fun entries(): List<Entry> = try {
    val a = JSONArray(saved(this))
    (0 until a.length()).map { i ->
      val o = a.getJSONObject(i)
      val rooms = o.optJSONArray("rooms")?.let { r -> (0 until r.length()).map { r.getString(it) } }
      val from = o.optJSONArray("from")?.let { f -> (0 until f.length()).map { f.getString(it) }.toSet() } ?: emptySet()
      Entry(o.getString("relay"), o.getString("me"), rooms, o.optBoolean("mentions"), from, o.getString("subject"), o.getString("name"))
    }
  } catch (e: Exception) {
    Log.w(TAG, "the kept list doesn't read: ${e.javaClass.simpleName}")
    emptyList()
  }

  /** On the executor: one connection per relay and key, matching the list. */
  private fun reload() {
    val want = entries().groupBy { it.relay + " " + it.me }
    Log.i(TAG, "the list asks for ${want.size} relay connection(s)")
    if (want.isEmpty()) {
      stopAll()
      return
    }
    for ((k, c) in conns.toList()) if (k !in want) { c.close(); conns.remove(k) }
    for ((k, es) in want) {
      val c = conns[k]
      if (c != null && c.entries == es) continue
      c?.close()
      val from = if (reloaded) System.currentTimeMillis() / 1000 - SKEW_S else fromS
      conns[k] = Conn(es.first().relay, es.first().me, es, from).also { it.connect() }
    }
    reloaded = true
    // once a minute: note that the connections are up (a later run resumes from there); every 15, find rooms again
    ticks?.cancel(false)
    ticks = exec.scheduleWithFixedDelay(guarded {
      tick++
      val now = System.currentTimeMillis() / 1000
      if (conns.values.map { it.alive(now) }.any { it }) prefs(this).edit().putLong("alive", now).apply()
      if (tick % REDISCOVER_MIN == 0L) conns.values.forEach { it.discover() }
    }, 1, 1, TimeUnit.MINUTES)
  }

  /** The list was for `me`'s key and the key is gone or another: forget it, unless a new list came in meanwhile. */
  private fun dropListFor(me: String) {
    if (entries().any { it.me == me }) save(this, "[]")
    reload()
  }

  private fun stopAll() {
    conns.values.forEach { it.close() }
    conns.clear()
    ticks?.cancel(false)
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    // a start asked for after the last one seen here (a new list) keeps the service; one brought back by Android
    // through onCreate alone has no start id
    if (lastStartId == 0) stopSelf() else stopSelf(lastStartId)
  }

  // ---- one relay ----------------------------------------------------------------------------------------------------

  private inner class Conn(val relay: String, val me: String, val entries: List<Entry>, private val startS: Long) {
    private var ws: WebSocket? = null
    private var gen = 0
    private var closed = false
    private var authId: String? = null
    private var authed = false
    private var backoffMs = 2_000L
    private var aliveS = 0L // the last time this connection was known to be up (0: not yet)
    private val roomFrom = HashMap<String, Long>() // room -> its messages are new from then
    private var firstPass = true
    private var resubscribing = false
    private val out = ArrayDeque<String>()
    private var draining = false
    private var nextSub = 0
    private val roomSubs = HashMap<String, String>() // room -> sub id
    private val subRooms = HashMap<String, String>() // sub id -> room
    private var discoverSub: String? = null
    private var discovered = HashSet<String>()
    private var found = HashSet<String>()
    private val roomNames = HashMap<String, String>()
    private val profileSubs = HashMap<String, String>() // sub id -> pubkey
    private val waiting = HashMap<String, MutableList<() -> Unit>>() // pubkey -> notifications waiting for a name

    private fun sub(prefix: String) = prefix + (nextSub++).toString(36)

    /** Up, and listening in every room it wants: only then does "last up" move (a resume reads from before it). */
    fun alive(now: Long): Boolean {
      val up = authed && ws != null && discoverSub == null && !resubscribing && roomSubs.keys.containsAll(wanted())
      if (up) aliveS = now
      return up
    }

    fun connect() {
      if (closed) return
      val g = ++gen
      authed = false; authId = null; resubscribing = false
      out.clear(); roomSubs.clear(); subRooms.clear(); profileSubs.clear(); discoverSub = null
      ws = http.newWebSocket(Request.Builder().url(relay).build(), object : WebSocketListener() {
        override fun onMessage(webSocket: WebSocket, text: String) { post { if (g == gen) message(text) } }
        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { post { if (g == gen) lost("failed: ${t.javaClass.simpleName}") } }
        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) { webSocket.close(1000, null) }
        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { post { if (g == gen) lost("closed $code") } }
      })
    }

    fun close() {
      closed = true
      gen++
      ws?.close(1000, null)
      ws = null
    }

    private fun lost(why: String) {
      if (closed) return
      Log.i(TAG, "relay connection lost ($why); again in ${backoffMs / 1000}s")
      if (authed) aliveS = System.currentTimeMillis() / 1000
      authed = false // down until signed in again: "last up" stays at the loss
      gen++
      ws?.cancel()
      ws = null
      val wait = backoffMs + (Math.random() * 1000).toLong()
      backoffMs = minOf(backoffMs * 2, 300_000L)
      later(wait) { connect() }
    }

    /** Frames go out one every PACE_MS; the sign-in goes first. */
    private fun send(frame: JSONArray, first: Boolean = false) {
      if (first) out.addFirst(frame.toString()) else out.addLast(frame.toString())
      if (!draining) drain()
    }

    private fun drain() {
      val w = ws
      val f = out.removeFirstOrNull()
      if (w == null || f == null) { draining = false; return }
      draining = true
      w.send(f)
      later(PACE_MS) { drain() }
    }

    private fun message(text: String) {
      val m = try { JSONArray(text) } catch (e: Exception) { return }
      when (m.optString(0)) {
        "AUTH" -> signIn(m.optString(1))
        "OK" -> if (m.optString(1) == authId) {
          if (m.optBoolean(2)) {
            authed = true
            backoffMs = 2_000L
            Log.i(TAG, "signed in to the relay")
            discover()
          } else {
            Log.w(TAG, "the relay refused the sign-in: ${m.optString(3).take(80)}")
            lost("sign-in refused")
          }
        }
        "EVENT" -> event(m.optString(1), m.optJSONObject(2) ?: return)
        "EOSE" -> eose(m.optString(1))
        "CLOSED" -> closedSub(m.optString(1), m.optString(2))
        "NOTICE" -> Log.i(TAG, "relay notice: ${m.optString(1).take(120)}")
      }
    }

    private fun signIn(challenge: String) {
      val opened = try { KeptSecrets.open(this@NotifyService, KeptSecrets.EVERYDAY) } catch (e: Exception) {
        Log.w(TAG, "the key store didn't answer: ${e.javaClass.simpleName}")
        lost("key store"); return
      }
      when (opened) {
        is KeptSecrets.Opened.Secret -> {
          val signed = try { signAuth(opened.bytes, relay, challenge) } catch (e: Throwable) { null } finally { opened.bytes.fill(0) }
          val ev = signed?.let { try { JSONObject(it) } catch (e: Exception) { null } }
          if (ev == null) { Log.w(TAG, "the sign-in couldn't be signed"); lost("unsigned"); return }
          if (ev.optString("pubkey") != me) {
            // the key was replaced since the list was made: the list is for another key
            Log.w(TAG, "the kept key isn't the list's: stopping")
            post { dropListFor(me) }
            return
          }
          authId = ev.getString("id")
          send(JSONArray().put("AUTH").put(ev), first = true)
        }
        is KeptSecrets.Opened.NoKey -> lost("the key store didn't find its key")
        else -> {
          Log.w(TAG, "no key to sign in with: stopping")
          post { dropListFor(me) }
        }
      }
    }

    /** Which rooms: the named ones, and every room the person is in when an applet asked for all. */
    fun discover() {
      if (!authed) return
      if (entries.any { it.rooms == null }) {
        discoverSub?.let { send(JSONArray().put("CLOSE").put(it)) }
        val s = sub("d")
        discoverSub = s
        found = HashSet()
        send(JSONArray().put("REQ").put(s).put(JSONObject().put("kinds", JSONArray().put(39002)).put("#p", JSONArray().put(me)).put("limit", 500)))
      } else {
        subscribe()
      }
    }

    private fun wanted(): Set<String> {
      val rooms = LinkedHashSet<String>()
      for (e in entries) if (e.rooms == null) rooms.addAll(discovered) else rooms.addAll(e.rooms)
      return rooms
    }

    private fun subscribe() {
      val want = wanted()
      for ((room, s) in roomSubs.toList()) if (room !in want) {
        send(JSONArray().put("CLOSE").put(s))
        roomSubs.remove(room); subRooms.remove(s)
      }
      val unnamed = want.filter { it !in roomNames }
      if (unnamed.isNotEmpty()) {
        send(JSONArray().put("REQ").put(sub("n")).put(JSONObject().put("kinds", JSONArray().put(39000)).put("#d", JSONArray(unnamed)).put("limit", unnamed.size)))
      }
      val now = System.currentTimeMillis() / 1000
      for (room in want) if (room !in roomSubs) {
        // a room listened to from the start is new from fromS; one found later, from now
        val from = roomFrom.getOrPut(room) { if (firstPass) startS else now - SKEW_S }
        // after a lost connection or a closed subscription, read from before it was last up (`seen` drops repeats)
        val since = if (aliveS > 0) maxOf(from, aliveS - GAP_S) else from
        val s = sub("r")
        roomSubs[room] = s; subRooms[s] = room
        send(JSONArray().put("REQ").put(s).put(JSONObject().put("kinds", JSONArray().put(9)).put("#h", JSONArray().put(room)).put("since", since)))
      }
      firstPass = false
      Log.i(TAG, "listening in ${roomSubs.size} rooms")
    }

    private fun eose(s: String) {
      when {
        s == discoverSub -> { send(JSONArray().put("CLOSE").put(s)); discoverSub = null; discovered = found; subscribe() }
        s.startsWith("n") -> send(JSONArray().put("CLOSE").put(s))
        profileSubs.containsKey(s) -> {
          send(JSONArray().put("CLOSE").put(s))
          val pk = profileSubs.remove(s)!!
          if (pk !in authors) authors[pk] = ""
          waiting.remove(pk)?.forEach { it() }
        }
      }
    }

    private fun closedSub(s: String, why: String) {
      val room = subRooms.remove(s) ?: run {
        if (s == discoverSub) {
          // keep the rooms found last time, and ask again
          discoverSub = null
          val g = gen
          Log.i(TAG, "the relay closed the room list (${why.substringBefore(':')}); again in 30s")
          later(30_000) { if (g == gen) discover() }
        }
        profileSubs.remove(s)?.let { pk -> authors.putIfAbsent(pk, ""); waiting.remove(pk)?.forEach { it() } }
        return
      }
      roomSubs.remove(room)
      Log.i(TAG, "the relay closed a room's subscription (${why.substringBefore(':')})")
      if (Regex("^(rate-limited|auth-required|error)").containsMatchIn(why)) {
        if (!resubscribing) {
          resubscribing = true
          val g = gen
          later(30_000) { resubscribing = false; if (g == gen && authed) subscribe() }
        }
      }
    }

    private fun event(s: String, ev: JSONObject) {
      when {
        s == discoverSub && ev.optInt("kind") == 39002 -> tag(ev, "d")?.let { found.add(it) }
        s.startsWith("n") && ev.optInt("kind") == 39000 -> {
          val d = tag(ev, "d") ?: return
          roomNames[d] = tag(ev, "name") ?: return
        }
        profileSubs.containsKey(s) && ev.optInt("kind") == 0 -> {
          val meta = try { JSONObject(ev.optString("content")) } catch (e: Exception) { null }
          val name = meta?.optString("display_name")?.takeIf { it.isNotBlank() } ?: meta?.optString("name")?.takeIf { it.isNotBlank() }
          if (name != null) authors[ev.optString("pubkey")] = name.take(60)
        }
        subRooms.containsKey(s) -> chat(subRooms[s]!!, ev)
      }
    }

    private fun chat(room: String, ev: JSONObject) {
      val id = ev.optString("id")
      val author = ev.optString("pubkey")
      if (ev.optInt("kind") != 9 || id.isEmpty() || author == me) return
      if (tag(ev, "h") != room || ev.optLong("created_at") < (roomFrom[room] ?: return)) return
      if (!seen.add(id)) return
      if (seen.size > 2000) seen.remove(seen.first())
      val named = tags(ev, "p").contains(me)
      val entry = entries.firstOrNull { e -> (e.rooms == null || room in e.rooms) && ((e.mentions && named) || author in e.from) } ?: return
      val post = { show(entry, room, roomNames[room], authorName(author), ev) }
      if (author in authors) post() else {
        val list = waiting.getOrPut(author) { mutableListOf() }
        list.add(post)
        if (list.size == 1) {
          val s = sub("p")
          profileSubs[s] = author
          send(JSONArray().put("REQ").put(s).put(JSONObject().put("kinds", JSONArray().put(0)).put("authors", JSONArray().put(author)).put("limit", 1)))
          // a relay that never answers still gets the message shown
          later(5_000) { waiting.remove(author)?.forEach { it() } }
        }
      }
    }

    private fun authorName(pk: String) = authors[pk]?.takeIf { it.isNotEmpty() } ?: (pk.take(8) + "…")
  }

  private fun tag(ev: JSONObject, name: String): String? = tags(ev, name).firstOrNull()

  private fun tags(ev: JSONObject, name: String): List<String> {
    val t = ev.optJSONArray("tags") ?: return emptyList()
    return (0 until t.length()).mapNotNull { i -> t.optJSONArray(i)?.takeIf { it.optString(0) == name && it.length() > 1 }?.optString(1) }
  }

  // ---- showing ------------------------------------------------------------------------------------------------------

  /** The first words of a message, as a line: markdown pictures and fenced blocks said in a word. */
  private fun gist(ev: JSONObject): String {
    var s = ev.optString("content")
    s = s.replace(Regex("```[\\s\\S]*?(```|$)"), " ")
    s = s.replace(Regex("!\\[[^\\]]*]\\([^)]*\\)"), "Picture")
    s = s.replace(Regex("[*_`#>]+"), "").replace(Regex("\\s+"), " ").trim()
    if (s.isEmpty()) s = if (tags(ev, "imeta").isNotEmpty()) "Sent a file" else "New message"
    return if (s.length > MAX_TEXT) s.take(MAX_TEXT - 1).trimEnd() + "…" else s
  }

  /** Keep the message for the next flush. Nothing while the app is in front, or without the permission. */
  private fun show(entry: Entry, room: String, roomName: String?, author: String, ev: JSONObject) {
    if (appInFront) return
    if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
    val text = gist(ev)
    val link = Uri.Builder().scheme("parachute").authority("notify")
      .appendQueryParameter("subject", entry.subject)
      .appendQueryParameter("room", room)
      .appendQueryParameter("event", ev.optString("id"))
      .build().toString()
    val active = activeRooms()
    synchronized(lock) {
      // a notification the person swiped away starts again from one
      if (room !in active && room !in pending) { unseen.remove(room); lines.remove(room) }
      unseen[room] = (unseen[room] ?: 0) + 1
      val l = lines.getOrPut(room) { ArrayDeque() }
      l.addLast("$author: $text")
      while (l.size > MAX_LINES) l.removeFirst()
      newest[room] = Newest("$author in ${roomName ?: "a room"}", text, entry.name, link, ev.optLong("created_at") * 1000)
    }
    if (pending.isEmpty()) {
      awake()
      later(FLUSH_MS) { flush() }
    }
    pending.add(room)
  }

  private fun activeRooms(): Set<String> =
    getSystemService(NotificationManager::class.java).activeNotifications.filter { it.id == MESSAGE_ID }.mapNotNull { it.tag }.toSet()

  /** Post what came in since the last flush: one notification per room, and the group's summary with the total. */
  private fun flush() {
    try { flushNow() } finally { asleep() }
  }

  /** The phone may sleep between a message arriving and the flush: a short wake lock holds it awake until shown. */
  private fun awake() {
    val w = wake ?: getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "parachute:notify").also {
      it.setReferenceCounted(false)
      wake = it
    }
    w.acquire(10_000L)
  }

  private fun asleep() {
    wake?.let { if (it.isHeld) it.release() }
  }

  private fun flushNow() {
    val rooms = pending.toList()
    pending.clear()
    if (appInFront) return
    val active = activeRooms()
    val compat = NotificationManagerCompat.from(this)
    try {
      var latest: Newest? = null
      for (room in rooms) {
        val (count, recent, n) = synchronized(lock) { Triple(unseen[room] ?: 0, lines[room]?.toList() ?: emptyList(), newest[room]) }
        if (n == null || count == 0) continue // cleared meanwhile
        val style = if (count > 1) NotificationCompat.InboxStyle().also { st -> recent.forEach { st.addLine(it) } } else NotificationCompat.BigTextStyle().bigText(n.text)
        compat.notify(room, MESSAGE_ID, NotificationCompat.Builder(this, CHANNEL_MESSAGES)
          .setSmallIcon(R.drawable.ic_notify)
          .setContentTitle(n.title)
          .setContentText(n.text)
          .setStyle(style)
          .setSubText(n.app)
          .setNumber(count)
          .setWhen(n.whenMs)
          .setShowWhen(true)
          .setCategory(NotificationCompat.CATEGORY_MESSAGE)
          .setPriority(NotificationCompat.PRIORITY_HIGH)
          .setGroup(GROUP)
          .setAutoCancel(true)
          .setContentIntent(open(n.link, room.hashCode()))
          .build())
        if (latest == null || n.whenMs >= latest.whenMs) latest = n
      }
      val total = synchronized(lock) {
        // only rooms still on screen count toward the total
        for (r in unseen.keys.toList()) if (r !in active && r !in rooms) { unseen.remove(r); lines.remove(r); newest.remove(r) }
        unseen.values.sum()
      }
      if (latest == null || total == 0) return
      compat.notify(SUMMARY_ID, NotificationCompat.Builder(this, CHANNEL_MESSAGES)
        .setSmallIcon(R.drawable.ic_notify)
        .setContentTitle("$total new")
        .setNumber(total)
        .setGroup(GROUP)
        .setGroupSummary(true)
        .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
        .setOnlyAlertOnce(true)
        .setAutoCancel(true)
        .setContentIntent(open(latest.link, 0))
        .build())
      Log.i(TAG, "shown: ${rooms.size} room(s), $total unseen")
    } catch (e: SecurityException) {
      Log.w(TAG, "not allowed to notify")
    }
    // the app came to the front while these went up: it has them in view
    if (appInFront) clearShown(this)
  }

  private fun open(link: String, code: Int): PendingIntent {
    val i = Intent(Intent.ACTION_VIEW, Uri.parse(link), this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return PendingIntent.getActivity(this, code, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }
}
