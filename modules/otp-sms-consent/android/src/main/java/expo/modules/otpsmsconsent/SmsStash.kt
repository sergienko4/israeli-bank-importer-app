package expo.modules.otpsmsconsent

import android.content.Context
import java.security.MessageDigest
import java.util.Locale
import org.json.JSONArray
import org.json.JSONObject

/** Where held messages live. Private to this app; nothing else can read it. */
private const val PREFS_NAME = "expo.modules.otpsmsconsent.stash"

/** The only key in that file: the whole stash, as a JSON array. */
private const val KEY_ENTRIES = "entries"

/** Whether holding is permitted at all. Absent means no, so a fresh install holds nothing. */
private const val KEY_ENABLED = "enabled"

/** How long a held message stays eligible. Matches the auto-read window cap. */
private const val TTL_MILLIS = 10L * 60L * 1000L

/** The most messages held at once. The oldest is evicted to make room. */
private const val MAX_ENTRIES = 10

/** Bytes of the digest kept as the entry id. Sixteen hex characters. */
private const val ID_BYTES = 8

private const val FIELD_ID = "id"
private const val FIELD_BODY = "body"
private const val FIELD_SENDER = "sender"
private const val FIELD_RECEIVED_AT = "receivedAt"
private const val FIELD_ATTEMPTED = "attempted"

/** A message held because nothing was waiting for a code when it arrived. */
internal data class StashEntry(
  val id: String,
  val body: String,
  val sender: String,
  val receivedAt: Long,
  val attempted: List<String>,
)

/**
 * Messages kept until JavaScript can look at them.
 *
 * A bank often sends its one-time code *before* the importer raises the request
 * that would open the auto-read window. `SMS_RECEIVED` is a one-shot broadcast
 * and the app holds `RECEIVE_SMS` rather than `READ_SMS`, so a message dropped
 * at that moment is gone: there is no inbox to look back at. Holding it here is
 * what makes that ordering survivable.
 *
 * Raw bodies are stored rather than extracted codes. The rule that decides
 * whether a message carries a usable code reads the whole message, and lives in
 * TypeScript where it is tested; reducing a message to digits here would mean a
 * second copy of that decision, able to drift out of step with the first.
 *
 * Two bounds keep that from being a liability. Anyone who knows the phone
 * number can cause a write, so the stash is capped at [MAX_ENTRIES] and every
 * entry expires after [TTL_MILLIS] whether or not anything ever reads it.
 * Expired entries are pruned on the next read rather than waiting for a timer,
 * so a process that never runs again still leaves nothing behind that can be
 * acted on.
 */
internal object SmsStash {
  /**
   * Mirrors the user's auto-read switches so the receiver can refuse without
   * starting JavaScript.
   *
   * Turning it off empties the stash in the same write. "Off" and "still
   * holding messages" is not a state worth being able to reach, and making it
   * unreachable here means no caller can forget the second step.
   *
   * @param context used to reach the app's private preferences.
   * @param enabled whether messages may be held.
   */
  fun setEnabled(context: Context, enabled: Boolean) {
    val editor = prefs(context).edit().putBoolean(KEY_ENABLED, enabled)
    if (!enabled) editor.remove(KEY_ENTRIES)
    editor.apply()
  }

  /**
   * Whether messages may be held.
   *
   * @param context used to reach the app's private preferences.
   * @return false unless the app has explicitly said otherwise.
   */
  fun isEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_ENABLED, false)

  /**
   * Holds one message, ignoring a message already held.
   *
   * The id is derived from the message itself, so a broadcast delivered twice
   * stores one entry rather than two racing candidates.
   *
   * @param context used to reach the app's private preferences.
   * @param sender originating address, as the network gave it.
   * @param timestampMillis when the network handed the message over.
   * @param body the raw text.
   */
  fun put(context: Context, sender: String, timestampMillis: Long, body: String) {
    if (!isEnabled(context)) return
    val id = identify(sender, timestampMillis, body)
    val live = all(context)
    if (live.any { it.id == id }) return
    val entry = StashEntry(id, body, sender, timestampMillis, emptyList())
    val kept = (live + entry).sortedBy { it.receivedAt }.takeLast(MAX_ENTRIES)
    write(context, kept)
  }

  /**
   * Every message still inside its lifetime, oldest first.
   *
   * Expired entries are dropped from storage as a side effect, so a stash that
   * is read at all never keeps a message past its deadline.
   *
   * @param context used to reach the app's private preferences.
   * @param nowMillis the current wall-clock time.
   * @return the live entries.
   */
  fun all(context: Context, nowMillis: Long = System.currentTimeMillis()): List<StashEntry> {
    val stored = read(context)
    val live = stored.filter { nowMillis - it.receivedAt < TTL_MILLIS }
    if (live.size != stored.size) write(context, live)
    return live
  }

  /**
   * Drops one message for good, once its code has been accepted.
   *
   * @param context used to reach the app's private preferences.
   * @param id the entry to drop.
   */
  fun consume(context: Context, id: String) {
    write(context, all(context).filterNot { it.id == id })
  }

  /**
   * Records that a message was already submitted against one request.
   *
   * This is what stops a code the importer rejected from being sent again on
   * the next drain, which would spend the bank's few attempts on an answer
   * already known to be wrong.
   *
   * @param context used to reach the app's private preferences.
   * @param id the entry that was submitted.
   * @param requestId the request it was submitted against.
   */
  fun markAttempt(context: Context, id: String, requestId: String) {
    val updated = all(context).map { entry ->
      if (entry.id == id && !entry.attempted.contains(requestId)) {
        entry.copy(attempted = entry.attempted + requestId)
      } else {
        entry
      }
    }
    write(context, updated)
  }

  /**
   * Forgets everything held. Safe to call when nothing is.
   *
   * @param context used to reach the app's private preferences.
   */
  fun clear(context: Context) {
    prefs(context).edit().remove(KEY_ENTRIES).apply()
  }

  private fun identify(sender: String, timestampMillis: Long, body: String): String {
    val material = "$sender|$timestampMillis|$body".toByteArray(Charsets.UTF_8)
    return MessageDigest.getInstance("SHA-256")
      .digest(material)
      .take(ID_BYTES)
      .joinToString("") { String.format(Locale.US, "%02x", it) }
  }

  private fun read(context: Context): List<StashEntry> {
    val raw = prefs(context).getString(KEY_ENTRIES, null) ?: return emptyList()
    return runCatching {
      val array = JSONArray(raw)
      (0 until array.length()).mapNotNull { index -> entryOf(array.optJSONObject(index)) }
    }.getOrDefault(emptyList())
  }

  private fun entryOf(json: JSONObject?): StashEntry? {
    if (json == null) return null
    val id = json.optString(FIELD_ID)
    if (id.isEmpty()) return null
    val attempted = json.optJSONArray(FIELD_ATTEMPTED)
    return StashEntry(
      id = id,
      body = json.optString(FIELD_BODY),
      sender = json.optString(FIELD_SENDER),
      receivedAt = json.optLong(FIELD_RECEIVED_AT),
      attempted =
        (0 until (attempted?.length() ?: 0))
          .map { index -> attempted?.optString(index).orEmpty() }
          .filter { it.isNotEmpty() },
    )
  }

  private fun write(context: Context, entries: List<StashEntry>) {
    val array = JSONArray()
    entries.forEach { entry ->
      array.put(
        JSONObject()
          .put(FIELD_ID, entry.id)
          .put(FIELD_BODY, entry.body)
          .put(FIELD_SENDER, entry.sender)
          .put(FIELD_RECEIVED_AT, entry.receivedAt)
          .put(FIELD_ATTEMPTED, JSONArray(entry.attempted)),
      )
    }
    prefs(context).edit().putString(KEY_ENTRIES, array.toString()).apply()
  }

  private fun prefs(context: Context) =
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
}
