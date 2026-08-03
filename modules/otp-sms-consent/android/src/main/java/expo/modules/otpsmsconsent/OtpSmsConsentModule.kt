package expo.modules.otpsmsconsent

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import com.google.android.gms.auth.api.phone.SmsRetriever
import com.google.android.gms.common.api.CommonStatusCodes
import com.google.android.gms.common.api.Status
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/** Identifies our consent dialog among every activity result the app receives. */
private const val CONSENT_REQUEST_CODE = 41762

/** The single event this module emits: one captured message body. */
private const val ON_MESSAGE_EVENT = "onOtpMessage"

private const val ERROR_CODE = "ERR_OTP_SMS_CONSENT"

/**
 * Reads a single bank one-time-code message, with the user's per-message consent.
 *
 * This uses the SMS User Consent API rather than SMS Retriever or the READ_SMS
 * permission, and that choice is the whole point of the module:
 *
 *  - It needs **no** permission, so the app never gains the standing ability to
 *    read the user's messages.
 *  - Play services, not this app, decides which message is a candidate, and the
 *    user approves each one in a system dialog.
 *  - The listening window is opened explicitly and closed again by the caller,
 *    so it is open only while a code is actually being asked for.
 *
 * The message body is handed to JavaScript untouched. Deciding what it means is
 * deliberately not done here: that logic is pure, and it is tested off-device.
 */
class OtpSmsConsentModule : Module() {
  private var receiver: BroadcastReceiver? = null

  override fun definition() = ModuleDefinition {
    Name("OtpSmsConsent")

    Events(ON_MESSAGE_EVENT)

    AsyncFunction("startListening") { promise: Promise ->
      startListening(promise)
    }

    AsyncFunction("stopListening") {
      stopListening()
    }

    // The auto-read window. Separate from the consent window above: this one
    // gates a manifest receiver that runs whether or not the app is open, so it
    // has to outlive this module and is kept on disk rather than in memory.
    Function("openAutoReadWindow") { expiresAtMillis: Double ->
      SmsExpectation.open(requireContext(), expiresAtMillis.toLong())
    }

    Function("closeAutoReadWindow") {
      SmsExpectation.close(requireContext())
    }

    // Messages held because they arrived before anything was waiting for a
    // code. They are read here and decided in JavaScript, where the rule that
    // says what a code looks like lives and is tested.
    AsyncFunction("listStashedMessages") {
      SmsStash.all(requireContext()).map { entry ->
        StashedMessageRecord(
          id = entry.id,
          body = entry.body,
          sender = entry.sender,
          receivedAt = entry.receivedAt.toDouble(),
          attempted = entry.attempted,
        )
      }
    }

    AsyncFunction("consumeStashedMessage") { id: String ->
      SmsStash.consume(requireContext(), id)
    }

    AsyncFunction("markStashAttempt") { id: String, requestId: String ->
      SmsStash.markAttempt(requireContext(), id, requestId)
    }

    AsyncFunction("clearStash") {
      SmsStash.clear(requireContext())
    }

    // Mirrors the user's switches natively, so the receiver can decline to hold
    // a message without starting JavaScript to ask.
    Function("setStashEnabled") { enabled: Boolean ->
      SmsStash.setEnabled(requireContext(), enabled)
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode == CONSENT_REQUEST_CODE) {
        emitConsentResult(payload.resultCode, payload.data)
      }
    }

    // A listening window must not outlive the screen that opened it.
    OnActivityDestroys { stopListening() }
    OnDestroy { stopListening() }
  }

  private fun startListening(promise: Promise) {
    val context = requireContext()
    registerReceiver(context)
    // A null sender means "any number": the importer does not know which of the
    // bank's gateways will send, and the user still approves the actual message.
    SmsRetriever.getClient(context)
      .startSmsUserConsent(null)
      .addOnSuccessListener { promise.resolve(null) }
      .addOnFailureListener { error ->
        // No play services, or the API refused. Close the window we opened and
        // let the caller fall back to typing the code by hand.
        stopListening()
        promise.reject(ERROR_CODE, error.message ?: "Could not start SMS consent", error)
      }
  }

  /** The React context, or a typed failure when it has already gone away. */
  private fun requireContext(): Context =
    appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private fun registerReceiver(context: Context) {
    if (receiver != null) {
      return
    }
    val created = ConsentReceiver(::requestConsent)
    val filter = IntentFilter(SmsRetriever.SMS_RETRIEVED_ACTION)
    // SEND_PERMISSION restricts the broadcast to play services, so another app
    // cannot forge a candidate message into this receiver.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      context.registerReceiver(
        created,
        filter,
        SmsRetriever.SEND_PERMISSION,
        null,
        Context.RECEIVER_EXPORTED,
      )
    } else {
      context.registerReceiver(created, filter, SmsRetriever.SEND_PERMISSION, null)
    }
    receiver = created
  }

  private fun stopListening() {
    val registered = receiver ?: return
    receiver = null
    // Unregistering can race a context teardown; losing that race is harmless.
    runCatching { appContext.reactContext?.unregisterReceiver(registered) }
  }

  /** Shows the system consent dialog for a candidate message. */
  private fun requestConsent(consentIntent: Intent) {
    val activity = appContext.currentActivity ?: return
    runCatching { activity.startActivityForResult(consentIntent, CONSENT_REQUEST_CODE) }
  }

  private fun emitConsentResult(resultCode: Int, data: Intent?) {
    // Anything other than an approval - denied, dismissed, empty - simply means
    // the user types the code themselves. There is nothing to report.
    if (resultCode != Activity.RESULT_OK) {
      return
    }
    val body = data?.getStringExtra(SmsRetriever.EXTRA_SMS_MESSAGE) ?: return
    sendEvent(ON_MESSAGE_EVENT, mapOf("body" to body))
  }
}

/**
 * One held message, as JavaScript receives it.
 *
 * A record rather than a loose map so the field names are declared in one place
 * and the TypeScript declaration beside it can be trusted to match.
 */
class StashedMessageRecord(
  @Field val id: String = "",
  @Field val body: String = "",
  @Field val sender: String = "",
  @Field val receivedAt: Double = 0.0,
  @Field val attempted: List<String> = emptyList(),
) : Record

/** Turns a play-services candidate broadcast into a consent request. */
private class ConsentReceiver(private val onConsentIntent: (Intent) -> Unit) : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != SmsRetriever.SMS_RETRIEVED_ACTION) {
      return
    }
    val extras = intent.extras ?: return
    val status = extras.get(SmsRetriever.EXTRA_STATUS) as? Status ?: return
    if (status.statusCode != CommonStatusCodes.SUCCESS) {
      // TIMEOUT is the common case: the five-minute window closed unused.
      return
    }
    val consentIntent = extras.getParcelable<Intent>(SmsRetriever.EXTRA_CONSENT_INTENT) ?: return
    onConsentIntent(consentIntent)
  }
}