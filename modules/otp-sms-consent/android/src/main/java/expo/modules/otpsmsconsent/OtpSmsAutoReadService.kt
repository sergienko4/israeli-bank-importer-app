package expo.modules.otpsmsconsent

import android.content.Intent
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

/**
 * Runs the JavaScript that submits a captured code, with no screen involved.
 *
 * Started by [OtpSmsAutoReadReceiver]. React Native spins up a JavaScript
 * context if one is not already running, runs the registered task, and then
 * lets the process go back to sleep.
 */
class OtpSmsAutoReadService : HeadlessJsTaskService() {
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
}
