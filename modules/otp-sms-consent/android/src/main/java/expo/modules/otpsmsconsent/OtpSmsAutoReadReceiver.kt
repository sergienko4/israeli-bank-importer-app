package expo.modules.otpsmsconsent

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import com.facebook.react.HeadlessJsTaskService

/** The key the message body travels under. The JavaScript task reads the same one. */
internal const val EXTRA_MESSAGE_BODY = "body"

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
    // The containment gate. Nothing below this line runs unless a code is
    // genuinely being waited for.
    if (!SmsExpectation.isLive(context)) {
      return
    }
    val body = readBody(intent) ?: return
    deliver(context, body)
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
    return parts
      .joinToString(separator = "") { it.displayMessageBody.orEmpty() }
      .ifEmpty { null }
  }
}
