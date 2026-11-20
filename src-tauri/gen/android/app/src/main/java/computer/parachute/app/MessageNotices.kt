package computer.parachute.app

// Hand-written. The one way a message becomes a notification, for both paths that hear about one while the app is
// closed: a push from the person's UnifiedPush distributor (PushService.kt, the main path) and the fallback listener's
// own relay connection (NotifyService.kt, on unless turned off, for what no push serves). One notification per room, tagged with the room id,
// counting what is unseen; a group summary with the total (the launcher's badge); a tap opens
// parachute://notify?subject=…&room=…&event=… (src/services/notifyLink.ts). Nothing is shown while the app is in front,
// and what was shown is cleared when it comes back.

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

object MessageNotices {
  private const val TAG = "ParachuteNotify"
  const val CHANNEL = "messages"
  private const val GROUP = "computer.parachute.app.MESSAGES"
  private const val SUMMARY_ID = 2
  private const val MESSAGE_ID = 3 // one per room, tagged with the room id
  private const val MAX_LINES = 5

  /** MainActivity is resumed: nothing is shown. */
  @Volatile @JvmStatic var appInFront = false

  class Newest(val title: String, val text: String, val app: String, val link: String, val whenMs: Long)

  // what is shown, per room: unseen count, the last few lines and the newest message (the activity clears it from the
  // main thread; the paths' threads write it)
  private val lock = Any()
  private val unseen = HashMap<String, Int>()
  private val lines = HashMap<String, ArrayDeque<String>>()
  private val newest = HashMap<String, Newest>()
  // rooms added and not flushed yet (by either path): a flush leaves their counts alone
  private val unflushed = HashSet<String>()

  fun channel(ctx: Context) {
    ctx.getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(CHANNEL, "Messages", NotificationManager.IMPORTANCE_HIGH).apply {
      description = "Messages that name you, or come from someone an applet listens for."
    })
  }

  fun link(subject: String, room: String?, event: String?): String = Uri.Builder().scheme("parachute").authority("notify")
    .appendQueryParameter("subject", subject)
    .apply { if (room != null) appendQueryParameter("room", room) }
    .apply { if (event != null) appendQueryParameter("event", event) }
    .build().toString()

  private const val SIGNAL_ID = 4 // one per applet's signal, tagged "<applet's opaque id>/<signal>"

  /** An applet's signal (PushService.onSignal): one notification per signal, its count as the number (the launcher's
   *  badge), replaced as the count changes. No words from the applet's data: its name, the count, the signal's name. */
  fun signal(ctx: Context, tag: String, title: String, text: String, count: Int, link: String) {
    channel(ctx)
    // it sounds only when the count rises (something new); a count going down (read elsewhere) changes it quietly
    val shown = ctx.getSystemService(NotificationManager::class.java).activeNotifications.firstOrNull { it.id == SIGNAL_ID && it.tag == tag }?.notification?.number ?: 0
    try {
      NotificationManagerCompat.from(ctx).notify(tag, SIGNAL_ID, NotificationCompat.Builder(ctx, CHANNEL)
        .setSmallIcon(R.drawable.ic_notify)
        .setContentTitle(title)
        .setContentText(text)
        .setNumber(count)
        .setSilent(count <= shown)
        .setCategory(NotificationCompat.CATEGORY_STATUS)
        .setPriority(NotificationCompat.PRIORITY_DEFAULT)
        .setAutoCancel(true)
        .setContentIntent(open(ctx, link, tag.hashCode()))
        .build())
    } catch (e: SecurityException) {
      Log.w(TAG, "not allowed to notify")
    }
  }

  fun clearSignal(ctx: Context, tag: String) { ctx.getSystemService(NotificationManager::class.java).cancel(tag, SIGNAL_ID) }

  /** May anything be shown now? Not while the app is in front, not without the permission. */
  fun mayShow(ctx: Context): Boolean =
    !appInFront && !(Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)

  /** Keep a message for the next flush. */
  fun add(ctx: Context, room: String, line: String, n: Newest) {
    val active = activeRooms(ctx)
    synchronized(lock) {
      // a notification the person swiped away starts again from one
      if (room !in active && room !in unflushed) { unseen.remove(room); lines.remove(room) }
      unflushed.add(room)
      unseen[room] = (unseen[room] ?: 0) + 1
      val l = lines.getOrPut(room) { ArrayDeque() }
      l.addLast(line)
      while (l.size > MAX_LINES) l.removeFirst()
      newest[room] = n
    }
  }

  private fun activeRooms(ctx: Context): Set<String> =
    ctx.getSystemService(NotificationManager::class.java).activeNotifications.filter { it.id == MESSAGE_ID }.mapNotNull { it.tag }.toSet()

  /** Post what came in for these rooms: one notification per room, and the group's summary with the total. */
  fun flush(ctx: Context, rooms: List<String>) {
    synchronized(lock) { unflushed.removeAll(rooms.toSet()) }
    if (appInFront) return
    channel(ctx)
    val active = activeRooms(ctx)
    val compat = NotificationManagerCompat.from(ctx)
    try {
      var latest: Newest? = null
      for (room in rooms) {
        val (count, recent, n) = synchronized(lock) { Triple(unseen[room] ?: 0, lines[room]?.toList() ?: emptyList(), newest[room]) }
        if (n == null || count == 0) continue // cleared meanwhile
        val style = if (count > 1) NotificationCompat.InboxStyle().also { st -> recent.forEach { st.addLine(it) } } else NotificationCompat.BigTextStyle().bigText(n.text)
        compat.notify(room, MESSAGE_ID, NotificationCompat.Builder(ctx, CHANNEL)
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
          .setContentIntent(open(ctx, n.link, room.hashCode()))
          .build())
        if (latest == null || n.whenMs >= latest.whenMs) latest = n
      }
      val total = synchronized(lock) {
        // only rooms still on screen count toward the total
        for (r in unseen.keys.toList()) if (r !in active && r !in rooms && r !in unflushed) { unseen.remove(r); lines.remove(r); newest.remove(r) }
        unseen.values.sum()
      }
      if (latest == null || total == 0) return
      compat.notify(SUMMARY_ID, NotificationCompat.Builder(ctx, CHANNEL)
        .setSmallIcon(R.drawable.ic_notify)
        .setContentTitle("$total new")
        .setNumber(total)
        .setGroup(GROUP)
        .setGroupSummary(true)
        .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
        .setOnlyAlertOnce(true)
        .setAutoCancel(true)
        .setContentIntent(open(ctx, latest.link, 0))
        .build())
      Log.i(TAG, "shown: ${rooms.size} room(s), $total unseen")
    } catch (e: SecurityException) {
      Log.w(TAG, "not allowed to notify")
    }
    // the app came to the front while these went up: it has them in view
    if (appInFront) clearShown(ctx)
  }

  fun clearShown(ctx: Context) {
    val rooms = synchronized(lock) {
      val r = unseen.keys.toList()
      unseen.clear()
      unflushed.clear()
      lines.clear()
      newest.clear()
      r
    }
    // the ones known here by name (one posted a moment ago may not be listed as active yet), then any others
    val nm = ctx.getSystemService(NotificationManager::class.java)
    for (r in rooms) nm.cancel(r, MESSAGE_ID)
    nm.cancel(SUMMARY_ID)
    for (s in nm.activeNotifications) if (s.id == MESSAGE_ID || s.id == SIGNAL_ID) nm.cancel(s.tag, s.id)
  }

  private fun open(ctx: Context, link: String, code: Int): PendingIntent {
    val i = Intent(Intent.ACTION_VIEW, Uri.parse(link), ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return PendingIntent.getActivity(ctx, code, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }
}
