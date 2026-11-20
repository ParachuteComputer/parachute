package computer.parachute.app

// Hand-written. The device unlock before an approval (src-tauri/src/keyring.rs, docs/design/KEYRING.md), from the Uni
// app's KeystorePlugin: BiometricPrompt with a strong biometric or the screen lock (PIN, pattern, password) from
// Android 11, the screen-lock confirmation before that. A phone with no screen lock can't approve what needs the
// unlock. The prompt's words are Rust's, never a web page's. Also the screen-off count, which ends the unlock's grace. Only the shell's Rust side calls these: the plugin is registered from Rust and has no JavaScript
// permission.
//
// The grace ends when the screen goes off (Aaron, 11-18: "5 min after an unlock, ends on screen lock"): the count goes
// up on the screen turning off, not on leaving the app. And the idle lock's clock (src-tauri/src/levels.rs): the newest
// touch the activity got, and the longest quiet gap between two touches since Rust last asked.

import android.app.Activity
import android.app.KeyguardManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.activity.result.ActivityResult
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.util.concurrent.atomic.AtomicLong

@InvokeArg
class UnlockArgs {
  lateinit var title: String
  lateinit var reason: String
}

@TauriPlugin
class UnlockPlugin(private val activity: Activity) : Plugin(activity) {
  companion object {
    /** Each time the screen goes off (it locks then, or soon after): the end of any grace. */
    private val screenOff = AtomicLong(0)
    @Volatile private var watching = false

    /** The newest touch (wall clock, ms, as Rust's), and the longest quiet gap between two since Rust last asked
     *  (measured on the clock that counts sleep, so a phone asleep in a pocket counts its time). */
    @Volatile private var lastTouch = 0L
    @Volatile private var lastTouchUp = 0L
    @Volatile private var longestGap = 0L
    private val touchLock = Any()

    /** MainActivity.onUserInteraction. */
    fun touched() {
      val up = SystemClock.elapsedRealtime()
      synchronized(touchLock) {
        if (lastTouchUp > 0) longestGap = maxOf(longestGap, up - lastTouchUp)
        lastTouchUp = up
        lastTouch = System.currentTimeMillis()
      }
    }
  }

  init {
    // once a process: the screen turning off ends the grace (keyring.rs asks `epoch`)
    if (!watching) {
      watching = true
      ContextCompat.registerReceiver(activity.applicationContext, object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) { screenOff.incrementAndGet() }
      }, IntentFilter(Intent.ACTION_SCREEN_OFF), ContextCompat.RECEIVER_NOT_EXPORTED)
    }
  }

  private val handler = Handler(Looper.getMainLooper())
  private var asking: Invoke? = null
  private var prompt: BiometricPrompt? = null
  private val waitingForScreen = mutableListOf<Invoke>()
  private val timeout = Runnable { finish(false, "The device unlock timed out") }

  private fun finish(ok: Boolean, why: String = "The device unlock was cancelled or failed") {
    val invoke = asking ?: return
    asking = null
    handler.removeCallbacks(timeout)
    prompt?.cancelAuthentication()
    prompt = null
    if (ok) invoke.resolve() else invoke.reject(why)
  }

  @Command
  fun authenticate(invoke: Invoke) {
    activity.runOnUiThread {
      if (asking != null) {
        invoke.reject("A device unlock is already showing")
        return@runOnUiThread
      }
      val keyguard = activity.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
      if (!keyguard.isDeviceSecure) {
        invoke.reject("Set a screen lock on this device first")
        return@runOnUiThread
      }
      try {
        val args = invoke.parseArgs(UnlockArgs::class.java)
        asking = invoke
        handler.postDelayed(timeout, 60_000)
        if (Build.VERSION.SDK_INT < 30) {
          // a strong biometric or the screen lock in one prompt isn't offered before Android 11
          @Suppress("DEPRECATION")
          val intent = keyguard.createConfirmDeviceCredentialIntent(args.title, args.reason)
          if (intent == null) finish(false, "Set a screen lock on this device first")
          else startActivityForResult(invoke, intent, "credentialResult")
        } else {
          val host = activity as? FragmentActivity
          if (host == null) {
            finish(false, "The device unlock isn't available")
            return@runOnUiThread
          }
          val p = BiometricPrompt(host, ContextCompat.getMainExecutor(activity), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
              if (asking === invoke) finish(true)
            }
            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
              if (asking === invoke) finish(false)
            }
          })
          prompt = p
          p.authenticate(BiometricPrompt.PromptInfo.Builder()
            .setTitle(args.title)
            .setDescription(args.reason)
            .setAllowedAuthenticators(BIOMETRIC_STRONG or DEVICE_CREDENTIAL)
            .build())
        }
      } catch (_: Exception) {
        finish(false, "The device unlock isn't available")
      }
    }
  }

  @ActivityCallback
  private fun credentialResult(invoke: Invoke, result: ActivityResult) {
    if (asking === invoke) finish(result.resultCode == Activity.RESULT_OK)
  }

  override fun onResume() {
    val waiting = waitingForScreen.toList()
    waitingForScreen.clear()
    waiting.forEach { answer(it, true) }
  }

  private fun answer(invoke: Invoke, resumed: Boolean) {
    val out = JSObject()
    out.put("epoch", screenOff.get())
    out.put("resumed", resumed)
    invoke.resolve(out)
  }

  /** The screen-off count, and whether the app is in front. Just after an unlock the unlock's own screen may
   *  still be closing: the answer waits up to two seconds for the app to come back. */
  /** The idle lock's clock: the newest touch and the longest quiet gap since the last ask (which this resets). */
  @Command
  fun touches(invoke: Invoke) {
    val out = JSObject()
    synchronized(touchLock) {
      out.put("last", lastTouch)
      out.put("gap", longestGap)
      longestGap = 0L
    }
    invoke.resolve(out)
  }

  @Command
  fun epoch(invoke: Invoke) {
    activity.runOnUiThread {
      val resumed = (activity as? LifecycleOwner)?.lifecycle?.currentState?.isAtLeast(Lifecycle.State.RESUMED) == true
      if (resumed) answer(invoke, true)
      else {
        waitingForScreen.add(invoke)
        handler.postDelayed({ if (waitingForScreen.remove(invoke)) answer(invoke, false) }, 2_000)
      }
    }
  }
}
