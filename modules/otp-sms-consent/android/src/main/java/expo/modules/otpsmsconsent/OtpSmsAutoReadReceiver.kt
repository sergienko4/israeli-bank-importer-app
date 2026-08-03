package expo.modules.otpsmsconsent

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.telephony.SmsMessage
import com.facebook.react.HeadlessJsTaskService

/** The key the message body travels under. The JavaScript task reads the same one. */
internal const val EXTRA_MESSAGE_BODY = "body"

/**
 * The longest message worth holding, matching the parser's own limit.
 *
 * A message longer than this is rejected by the parser anyway, so holding it
 * would only spend a stash slot that a real code might need.
 */
private const val MAX_HELD_LENGTH = 640

/**
 * A deliberately loose test for "might contain a code".
 *
 * The real rule — exactly one distinct standalone run of 4-8 digits in the
 * whole message — lives in TypeScript, where it is tested. This must stay
 * *looser* than that rule in every direction: it matches digits inside a longer
 * run too, so anything the parser would accept is certainly held. Tightening it
 * here would silently drop messages the parser would have used, and no test on
 * this side would notice.
 */
private val DIGIT_RUN = Regex("\\d{4,8}")

/**
 * Hands an arriving one-time code to JavaScript with the user doing nothing.
 *
 * This receiver only exists in a build made with `OTP_SMS_AUTOREAD=1`; the
 * config plugin adds it to the manifest for that build alone, and only that
 * build carries the `RECEIVE_SMS` permission the system requires before it will
 * deliver the broadcast. In the default build neither is present, so this class
 * is compiled but unreachable.
 *
 * `SMS_RECEIVED_ACTION` is on Android's exemption list for implicit broadcasts,
 * so a manifest entry still wakes the app even when its process is not running.
 * That is what makes a genuinely hands-off capture possible.
 *
 * The message is not parsed here. Deciding whether it contains a code is pure
 * logic that is tested off-device, so this class does the one thing it must be
 * on the device to do and forwards the body untouched.
 */
class OtpSmsAutoReadReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) {
      return
    }
    // The containment gate. A code is being waited for right now, so the
    // message goes straight to JavaScript, exactly as it always has.
    if (SmsExpectation.isLive(context)) {
      val body = readBody(intent) ?: return
      deliver(context, body)
      return
    }
    hold(context, intent)
  }

  /**
   * Keeps a message that arrived before anyone asked for a code.
   *
   * Banks frequently send the code first. This broadcast is delivered once and
   * the app cannot read the inbox, so dropping the message here used to lose it
   * for good. Holding it costs one small private write and no JavaScript: the
   * process is not started, nothing is parsed, and nothing leaves the device.
   */
  private fun hold(context: Context, intent: Intent) {
    if (!SmsStash.isEnabled(context)) return
    val parts = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
    val first = parts.firstOrNull() ?: return
    val body = bodyOf(parts) ?: return
    if (body.length > MAX_HELD_LENGTH || !DIGIT_RUN.containsMatchIn(body)) return
    SmsStash.put(
      context,
      first.displayOriginatingAddress.orEmpty(),
      first.timestampMillis,
      body,
    )
  }

  /**
   * Starts the headless task, and keeps the device awake long enough to run it.
   *
   * Receiving a message puts the app on Android's temporary allowlist, which
   * permits an ordinary background service. That is why this needs no
   * foreground service and shows no notification: the capture is silent.
   */
  private fun deliver(context: Context, body: String) {
    val service = Intent(context, OtpSmsAutoReadService::class.java)
      .putExtra(EXTRA_MESSAGE_BODY, body)
    // A refusal here costs the user nothing beyond typing the code themselves,
    // which is exactly what happens in a build without this feature. Crashing
    // their phone over it would be a far worse trade.
    val started = runCatching { context.startService(service) }.isSuccess
    if (started) {
      // Without this the device can go back to sleep before JavaScript runs.
      HeadlessJsTaskService.acquireWakeLockNow(context)
    }
  }

  /** Joins the parts of a possibly multipart message into a single body. */
  private fun readBody(intent: Intent): String? {
    val parts = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return null
    return bodyOf(parts)
  }

  /** Joins message parts, treating an empty result as no message at all. */
  private fun bodyOf(parts: Array<SmsMessage>): String? =
    parts
      .joinToString(separator = "") { it.displayMessageBody.orEmpty() }
      .ifEmpty { null }
}
