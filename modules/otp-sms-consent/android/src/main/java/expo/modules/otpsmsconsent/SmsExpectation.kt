package expo.modules.otpsmsconsent

import android.content.Context

/** Where the deadline lives. Private to this app; nothing else can read it. */
private const val PREFS_NAME = "expo.modules.otpsmsconsent.autoread"

/** The only key in that file: when the current expectation stops being valid. */
private const val KEY_EXPIRES_AT = "expiresAt"

/**
 * The window during which an arriving message may be looked at.
 *
 * The auto-read receiver is woken for *every* message the device receives. This
 * gate is what stops that from meaning the app reads every message: unless a
 * one-time code is actually being waited for right now, the receiver returns
 * before it has touched the message at all.
 *
 * A deadline is stored rather than a plain "waiting" flag on purpose. A crash,
 * a killed process, or a scrape that ends without closing its window would all
 * leave a boolean stuck on, and the gate would then be open forever. A deadline
 * that has passed is closed, whatever happened to the code that set it.
 *
 * This is deliberately native rather than a check on the JavaScript side. Were
 * it in JavaScript, every message on the device would have to be handed to the
 * app before it could be rejected, and the claim this gate exists to support
 * would no longer be true.
 */
internal object SmsExpectation {
  /**
   * Opens the window until [expiresAtMillis], replacing any window already open.
   *
   * @param context used to reach the app's private preferences.
   * @param expiresAtMillis wall-clock deadline, matching `System.currentTimeMillis`.
   */
  fun open(context: Context, expiresAtMillis: Long) {
    prefs(context).edit().putLong(KEY_EXPIRES_AT, expiresAtMillis).apply()
  }

  /**
   * Closes the window. Safe to call when none is open.
   *
   * @param context used to reach the app's private preferences.
   */
  fun close(context: Context) {
    prefs(context).edit().remove(KEY_EXPIRES_AT).apply()
  }

  /**
   * Whether a code is being waited for.
   *
   * @param context used to reach the app's private preferences.
   * @param nowMillis the current wall-clock time.
   * @return true only while an unexpired window is open.
   */
  fun isLive(context: Context, nowMillis: Long = System.currentTimeMillis()): Boolean =
    prefs(context).getLong(KEY_EXPIRES_AT, 0L) > nowMillis

  private fun prefs(context: Context) =
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
}
