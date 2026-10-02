package expo.modules.otpsmsconsent

import android.content.Context
import android.content.ContextWrapper
import android.content.SharedPreferences
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

private const val ENTRIES_KEY = "entries"
private const val WAIT_SECONDS = 5L
private const val MINUTE_MILLIS = 60_000L
private const val BANK = "LEUMI"
private const val OLD_CODE = "Your Leumi verification code is 482913"
private const val NEW_CODE = "Your Leumi verification code is 615027"
private const val REQUEST_ID = "req-7f3a9c"

/**
 * In-memory preferences that can freeze the next writer of the held entries.
 *
 * Each edit lands in one step on `apply()`, as Android's own implementation does.
 * Freezing a caller just before its write lands holds it in the one gap a change
 * has: after it read the list, before the list it built from that read is saved.
 */
private class FreezablePrefs : SharedPreferences {
  private val values = HashMap<String, Any>()
  private val freezeNext = AtomicBoolean(false)
  val frozen = CountDownLatch(1)
  val thaw = CountDownLatch(1)

  /** Makes the next thread that writes the entries stop just before the write lands. */
  fun freezeNextEntriesWrite() = freezeNext.set(true)

  override fun getString(key: String, defValue: String?): String? =
    synchronized(values) { values[key] as String? } ?: defValue

  override fun getBoolean(key: String, defValue: Boolean): Boolean =
    synchronized(values) { values[key] as Boolean? } ?: defValue

  override fun edit(): SharedPreferences.Editor = Edit()

  override fun contains(key: String): Boolean = synchronized(values) { values.containsKey(key) }

  override fun getAll(): Map<String, *> = synchronized(values) { HashMap(values) }

  override fun getStringSet(key: String, defValues: MutableSet<String>?): MutableSet<String>? =
    unused()

  override fun getInt(key: String, defValue: Int): Int = unused()

  override fun getLong(key: String, defValue: Long): Long = unused()

  override fun getFloat(key: String, defValue: Float): Float = unused()

  override fun registerOnSharedPreferenceChangeListener(
    listener: SharedPreferences.OnSharedPreferenceChangeListener,
  ): Unit = unused()

  override fun unregisterOnSharedPreferenceChangeListener(
    listener: SharedPreferences.OnSharedPreferenceChangeListener,
  ): Unit = unused()

  private inner class Edit : SharedPreferences.Editor {
    private val puts = HashMap<String, Any>()
    private val removals = HashSet<String>()

    override fun putString(key: String, value: String?): SharedPreferences.Editor {
      if (value == null) removals.add(key) else puts[key] = value
      return this
    }

    override fun putBoolean(key: String, value: Boolean): SharedPreferences.Editor {
      puts[key] = value
      return this
    }

    override fun remove(key: String): SharedPreferences.Editor {
      removals.add(key)
      return this
    }

    override fun apply() {
      val touchesEntries = ENTRIES_KEY in puts || ENTRIES_KEY in removals
      if (touchesEntries && freezeNext.compareAndSet(true, false)) {
        frozen.countDown()
        // A thaw that timed out would let this write land before the competing call
        // starts, and the test would pass without the race it exists to run.
        assertTrue("the frozen write was never thawed", thaw.await(WAIT_SECONDS, TimeUnit.SECONDS))
      }
      synchronized(values) {
        removals.forEach { values.remove(it) }
        values.putAll(puts)
      }
    }

    override fun commit(): Boolean {
      apply()
      return true
    }

    override fun putStringSet(key: String, set: MutableSet<String>?): SharedPreferences.Editor =
      unused()

    override fun putInt(key: String, value: Int): SharedPreferences.Editor = unused()

    override fun putLong(key: String, value: Long): SharedPreferences.Editor = unused()

    override fun putFloat(key: String, value: Float): SharedPreferences.Editor = unused()

    override fun clear(): SharedPreferences.Editor = unused()
  }
}

private fun unused(): Nothing = throw UnsupportedOperationException("not used by SmsStash")

private fun contextOver(prefs: SharedPreferences): Context =
  object : ContextWrapper(null) {
    override fun getSharedPreferences(name: String, mode: Int): SharedPreferences = prefs
  }

/** Runs a block on its own thread and keeps whatever it threw, so the test can rethrow it. */
private class Worker(name: String, block: () -> Unit) {
  private val failure = AtomicReference<Throwable?>(null)
  val thread = Thread({ runCatching(block).onFailure(failure::set) }, name)

  fun start(): Worker {
    thread.start()
    return this
  }

  fun finish() {
    thread.join(TimeUnit.SECONDS.toMillis(WAIT_SECONDS))
    assertFalse("${thread.name} did not finish", thread.isAlive)
    failure.get()?.let { throw it }
  }
}

/**
 * Waits until [worker] has either finished or stopped to wait for the frozen one.
 *
 * Reading the thread's state rather than sleeping keeps the test exact: unlocked
 * code runs to the end, and locked code parks on the lock, with no timing guess.
 */
private fun awaitSettled(worker: Worker) {
  val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(WAIT_SECONDS)
  val settled = setOf(Thread.State.BLOCKED, Thread.State.WAITING, Thread.State.TERMINATED)
  while (worker.thread.state !in settled) {
    if (System.nanoTime() > deadline) fail("${worker.thread.name} neither finished nor waited")
    Thread.yield()
  }
}

/**
 * Freezes [frozen] after it read the stash and before its write lands, runs
 * [competing] in that gap, then lets both finish.
 */
private fun raceInsideTheWrite(prefs: FreezablePrefs, frozen: () -> Unit, competing: () -> Unit) {
  prefs.freezeNextEntriesWrite()
  val first = Worker("frozen", frozen).start()
  assertTrue(
    "the frozen call never wrote the stash",
    prefs.frozen.await(WAIT_SECONDS, TimeUnit.SECONDS),
  )
  val second = Worker("competing", competing).start()
  awaitSettled(second)
  prefs.thaw.countDown()
  first.finish()
  second.finish()
}

class SmsStashConcurrencyTest {
  private val prefs = FreezablePrefs()
  private val context = contextOver(prefs)
  private val now = System.currentTimeMillis()

  private fun holdOld() = SmsStash.put(context, BANK, now - 2 * MINUTE_MILLIS, OLD_CODE)

  private fun holdNew() = SmsStash.put(context, BANK, now - MINUTE_MILLIS, NEW_CODE)

  private fun heldBodies() = SmsStash.all(context).map { it.body }

  @Test
  fun `a message arriving during a clear does not bring back what was cleared`() {
    SmsStash.setEnabled(context, true)
    holdOld()

    raceInsideTheWrite(prefs, frozen = ::holdNew, competing = { SmsStash.clear(context) })

    assertFalse("the cleared code came back", heldBodies().contains(OLD_CODE))
  }

  @Test
  fun `a message arriving while holding is switched off leaves nothing held`() {
    SmsStash.setEnabled(context, true)
    holdOld()

    raceInsideTheWrite(
      prefs,
      frozen = ::holdNew,
      competing = { SmsStash.setEnabled(context, false) },
    )

    assertFalse(SmsStash.isEnabled(context))
    assertEquals(emptyList<String>(), heldBodies())
  }

  @Test
  fun `a message arriving while a code is consumed does not bring the code back`() {
    SmsStash.setEnabled(context, true)
    holdOld()
    val oldId = SmsStash.all(context).single().id

    raceInsideTheWrite(
      prefs,
      frozen = ::holdNew,
      competing = { SmsStash.consume(context, oldId) },
    )

    assertEquals(listOf(NEW_CODE), heldBodies())
  }

  @Test
  fun `a message arriving while an attempt is recorded keeps the record`() {
    SmsStash.setEnabled(context, true)
    holdOld()
    val oldId = SmsStash.all(context).single().id

    raceInsideTheWrite(
      prefs,
      frozen = ::holdNew,
      competing = { SmsStash.markAttempt(context, oldId, REQUEST_ID) },
    )

    val old = SmsStash.all(context).single { it.id == oldId }
    assertEquals(listOf(REQUEST_ID), old.attempted)
  }

  @Test
  fun `a message arriving while expired ones are pruned is still held`() {
    SmsStash.setEnabled(context, true)
    SmsStash.put(context, BANK, now - 11 * MINUTE_MILLIS, OLD_CODE)

    raceInsideTheWrite(prefs, frozen = { SmsStash.all(context) }, competing = ::holdNew)

    assertEquals(listOf(NEW_CODE), heldBodies())
  }

  @Test
  fun `a message arriving while another code is consumed is still held`() {
    SmsStash.setEnabled(context, true)
    holdOld()
    val oldId = SmsStash.all(context).single().id

    raceInsideTheWrite(
      prefs,
      frozen = { SmsStash.consume(context, oldId) },
      competing = ::holdNew,
    )

    assertEquals(listOf(NEW_CODE), heldBodies())
  }

  @Test
  fun `a message arriving while an attempt on another is recorded is still held`() {
    SmsStash.setEnabled(context, true)
    holdOld()
    val oldId = SmsStash.all(context).single().id

    raceInsideTheWrite(
      prefs,
      frozen = { SmsStash.markAttempt(context, oldId, REQUEST_ID) },
      competing = ::holdNew,
    )

    assertEquals(listOf(OLD_CODE, NEW_CODE), heldBodies())
  }
}
