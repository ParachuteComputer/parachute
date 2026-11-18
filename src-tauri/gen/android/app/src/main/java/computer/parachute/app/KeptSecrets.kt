package computer.parachute.app

// Hand-written. How this app keeps a named secret (the person's everyday key, and later others): encrypted under one
// non-exportable AES-256-GCM key in the Android Keystore (alias `parachute_key`), with only the ciphertext and IV in
// this app's private preferences (`<name>.ct`, `<name>.iv`). KeyPlugin.kt saves, loads and clears them for the Rust side;
// NotifyService.kt opens the everyday key for one relay sign-in at a time. The plaintext never touches disk or the log.

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

object KeptSecrets {
  const val ALIAS = "parachute_key"
  const val PREFS = "parachute_key"
  /** The everyday key's name: key.rs, `Which::Everyday.slot()`. */
  const val EVERYDAY = "nostr_key"

  sealed class Opened {
    /** Nothing kept under this name. */
    object Nothing : Opened()
    /** Something is kept but the Keystore key that opens it isn't there (or, through Android 11, not there yet). */
    object NoKey : Opened()
    /** What is kept will never decrypt (its key was replaced, or it was damaged). */
    object Unreadable : Opened()
    /** The plaintext. The caller zeroes it. */
    class Secret(val bytes: ByteArray) : Opened()
  }

  fun prefs(ctx: Context): SharedPreferences = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun key(create: Boolean): SecretKey? {
    val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
    if (!create) return null
    val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    gen.init(
      KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .setRandomizedEncryptionRequired(true)
        .build()
    )
    return gen.generateKey()
  }

  /** Encrypt and keep `secret` under `name`. False when the preferences couldn't be written. */
  fun save(ctx: Context, name: String, secret: ByteArray): Boolean {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, key(true))
    val ct = cipher.doFinal(secret)
    return prefs(ctx).edit()
      .putString("$name.ct", Base64.encodeToString(ct, Base64.NO_WRAP))
      .putString("$name.iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
      .remove("$name.missing")
      .commit()
  }

  /** Decrypt what is kept under `name`. Keystore errors other than "this will never decrypt" are thrown. */
  fun open(ctx: Context, name: String): Opened {
    val p = prefs(ctx)
    val ct = p.getString("$name.ct", null)
    val iv = p.getString("$name.iv", null)
    if (ct == null || iv == null) return Opened.Nothing
    val k = key(false) ?: return Opened.NoKey
    val pt = try {
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, k, GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
      cipher.doFinal(Base64.decode(ct, Base64.NO_WRAP))
    } catch (e: javax.crypto.BadPaddingException) {
      null // includes AEADBadTagException: the tag doesn't verify
    } catch (e: java.security.InvalidAlgorithmParameterException) {
      null // a damaged IV (wrong length)
    } catch (e: IllegalArgumentException) {
      null // not base64
    }
    return if (pt == null) Opened.Unreadable else Opened.Secret(pt)
  }

  /** Forget `name`. The Keystore key goes only with the last secret it opens: the others would be unreadable without it. */
  fun clear(ctx: Context, name: String) {
    val p = prefs(ctx)
    p.edit().remove("$name.ct").remove("$name.iv").remove("$name.missing").commit()
    if (p.all.keys.any { it.endsWith(".ct") }) return
    val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    if (ks.containsAlias(ALIAS)) ks.deleteEntry(ALIAS)
  }
}
