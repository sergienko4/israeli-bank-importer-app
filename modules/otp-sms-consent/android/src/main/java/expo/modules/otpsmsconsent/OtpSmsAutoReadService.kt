package expo.modules.otpsmsconsent

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.util.Log
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/** Matches the name passed to `AppRegistry.registerHeadlessTask` in JavaScript. */
private const val TASK_NAME = "OtpSmsAutoRead"

/**
 * How long the task may run before React Native tears it down regardless.
 *
 * Must match `TASK_TIMEOUT_MS` in `otpDeadline.ts`. This is a backstop, not the
 * working bound: the task gives itself a shorter budget in JavaScript and
 * returns when it runs out, so that it ends by finishing rather than by being
 * torn down — which is what lets the wake lock be released in order. The gap
 * between the two is margin, because that budget is a JavaScript timer and a
 * JavaScript timer only fires when the thread next gets round to it.
 *
 * The ordinary run is one quick request against a machine on the same network
 * and finishes in well under a second. This exists only so a task that never
 * returns at all cannot hold the device awake.
 */
private const val TASK_TIMEOUT_MS = 60_000L

/** Identifies this service's notification; any stable non-zero value works. */
private const val NOTIFICATION_ID = 0x07B5

/** The channel the notification posts on, created on first use. */
private const val CHANNEL_ID = "otp_sms_capture"

/** Tags outcome-only log lines; never a message, a code, or an address. */
internal const val LOG_TAG = "OtpSmsAutoRead"

/**
 * Runs the JavaScript that submits a captured code, with no screen involved.
 *
 * Started by [OtpSmsAutoReadReceiver]. React Native spins up a JavaScript
 * context if one is not already running, runs the registered task, and then
 * lets the process go back to sleep.
 *
 * It runs as a short foreground service. A plain started service in a process
 * that has ever shown a screen still counts as cached, and Android freezes a
 * cached process within seconds, network and all, so the code never reached
 * the importer on a real phone. `shortService` needs no permission beyond
 * `FOREGROUND_SERVICE` and allows about three minutes, far longer than the task
 * may run. Android 12 and later hold back the notification of a service that
 * finishes within ten seconds, which an ordinary capture does.
 */
class OtpSmsAutoReadService : HeadlessJsTaskService() {
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val owesForeground = intent?.getBooleanExtra(EXTRA_FOREGROUND_START, false) == true
    intent?.removeExtra(EXTRA_FOREGROUND_START)
    if (!promote() && owesForeground) {
      // Android accepted a foreground start, so it ends this process once the
      // service stops without having promoted itself, or once its deadline
      // passes. Nothing here can avert that. Starting the task would only race
      // it, and a task cut short between spending a refresh token and saving
      // the next one would end the user's session. Stopping now costs only this
      // attempt, which the user covers by typing the code.
      stopSelf(startId)
      return START_NOT_STICKY
    }
    val result = super.onStartCommand(intent, flags, startId)
    if (result == START_NOT_STICKY) {
      // No task was started, so nothing would ever stop this service.
      stopSelf(startId)
    }
    return result
  }

  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
    val extras = intent?.extras ?: return null
    return HeadlessJsTaskConfig(
      TASK_NAME,
      Arguments.fromBundle(extras),
      TASK_TIMEOUT_MS,
      // A bank sends the code seconds after the app asked for it, so it usually
      // arrives while the user is still looking at the app. React Native throws
      // rather than run a task in the foreground unless this is set, so leaving
      // it at its default would crash the app in the commonest case there is.
      true,
    )
  }

  /** Android 14 asks a short service to stop once its time is up. */
  override fun onTimeout(startId: Int) {
    stopSelf()
  }

  /** Android 15 and later also ask through this form. */
  override fun onTimeout(startId: Int, fgsType: Int) {
    stopSelf()
  }

  /**
   * Makes this a foreground service for as long as the task runs.
   *
   * For a service the receiver could only start as an ordinary one, a refusal
   * is expected and leaves it ordinary: it still runs until Android freezes
   * it, as it did before. For one Android accepted as a foreground start, the
   * caller has to act on a refusal instead.
   *
   * @return whether the service is now in the foreground.
   */
  private fun promote(): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
    return try {
      val notification = captureNotification()
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        startForeground(
          NOTIFICATION_ID,
          notification,
          ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE,
        )
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
      true
    } catch (error: RuntimeException) {
      Log.w(LOG_TAG, "foreground-refused:${error.javaClass.simpleName}")
      false
    }
  }

  /** Builds the quiet notification a foreground service must carry. */
  private fun captureNotification(): Notification {
    val manager = getSystemService(NotificationManager::class.java)
    manager?.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, "Bank code capture", NotificationManager.IMPORTANCE_LOW),
    )
    return Notification.Builder(this, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.stat_notify_sync)
      .setContentTitle("Checking for a bank code")
      .setOngoing(true)
      .build()
  }
}
