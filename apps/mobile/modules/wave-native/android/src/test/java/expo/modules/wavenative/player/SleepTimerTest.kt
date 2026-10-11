package expo.modules.wavenative.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SleepTimerTest {
  /** The playback service as the timer sees it: a clock, the player and one pending check. */
  private class FakeHost(var now: Long) : SleepTimerHost {
    var paused = false
    var pausesAtEndOfItems = false
    var checkAt: Long? = null
    val changes = mutableListOf<SleepTimerMode?>()

    override fun nowMs() = now

    override fun pause() {
      paused = true
    }

    override fun setPauseAtEndOfItems(enabled: Boolean) {
      pausesAtEndOfItems = enabled
    }

    override fun scheduleCheck(delayMs: Long) {
      checkAt = now + delayMs
    }

    override fun cancelCheck() {
      checkAt = null
    }

    override fun onChanged(mode: SleepTimerMode?) {
      changes += mode
    }
  }

  private val minute = 60_000L
  private val host = FakeHost(now = 1_000_000L)
  private val timer = SleepTimer(host)

  /** Moves the clock on to [to], running the pending check if it has fallen due. */
  private fun advanceTo(to: Long) {
    host.now = to
    val due = host.checkAt ?: return
    if (due <= to) {
      host.checkAt = null
      timer.onCheck()
    }
  }

  @Test
  fun `a 30-minute timer pauses playback at its deadline and ends`() {
    timer.start(SleepTimerMode.Deadline(endsAtMs = host.now + 30 * minute))

    advanceTo(host.now + 30 * minute)

    assertTrue(host.paused)
    assertNull(timer.mode)
  }

  @Test
  fun `a check that runs before the deadline keeps playing and waits for the rest`() {
    val endsAt = host.now + 30 * minute
    timer.start(SleepTimerMode.Deadline(endsAt))

    // The wall clock was set back a minute while the check was pending, so the
    // check runs when the clock reads a minute short of the deadline.
    host.checkAt = endsAt - minute
    advanceTo(endsAt - minute)

    assertFalse(host.paused)
    assertEquals(endsAt, host.checkAt)
    advanceTo(endsAt)
    assertTrue(host.paused)
  }

  @Test
  fun `a cancelled timer lets playback run past its deadline`() {
    val endsAt = host.now + 15 * minute
    timer.start(SleepTimerMode.Deadline(endsAt))

    timer.cancel()
    advanceTo(endsAt + minute)

    assertFalse(host.paused)
    assertNull(host.checkAt)
    assertNull(timer.mode)
  }

  @Test
  fun `end of track has the player pause when the track finishes, then ends`() {
    timer.start(SleepTimerMode.EndOfTrack)
    assertTrue(host.pausesAtEndOfItems)

    timer.onPausedAtEndOfItem()

    assertFalse(host.pausesAtEndOfItems)
    assertNull(timer.mode)
  }

  @Test
  fun `end of track also ends when the last track plays out`() {
    timer.start(SleepTimerMode.EndOfTrack)

    timer.onEnded()

    assertFalse(host.pausesAtEndOfItems)
    assertNull(timer.mode)
  }

  @Test
  fun `a deadline outlasts the end of a track`() {
    val deadline = SleepTimerMode.Deadline(host.now + 30 * minute)
    timer.start(deadline)

    timer.onPausedAtEndOfItem()
    timer.onEnded()

    assertEquals(deadline, timer.mode)
  }

  @Test
  fun `a new timer replaces the running one`() {
    timer.start(SleepTimerMode.EndOfTrack)
    val endsAt = host.now + 45 * minute

    timer.start(SleepTimerMode.Deadline(endsAt))
    assertFalse("tracks play through again", host.pausesAtEndOfItems)
    assertEquals(endsAt, host.checkAt)

    timer.start(SleepTimerMode.EndOfTrack)
    assertNull("the old deadline no longer pauses", host.checkAt)
    assertTrue(host.pausesAtEndOfItems)
  }

  @Test
  fun `cancelling end of track lets the next track play`() {
    timer.start(SleepTimerMode.EndOfTrack)

    timer.cancel()

    assertFalse(host.pausesAtEndOfItems)
  }

  @Test
  fun `a deadline that passed while paused and asleep doesn't stop playback resumed after it`() {
    val endsAt = host.now + 15 * minute
    timer.start(SleepTimerMode.Deadline(endsAt))

    // Paused and asleep: the check is held back past the deadline, then playback resumes.
    host.now = endsAt + 10 * minute
    timer.onResumed()

    assertNull(timer.mode)
    assertNull(host.checkAt)
    assertFalse(host.paused)
  }

  @Test
  fun `resuming before the deadline keeps the timer running`() {
    val deadline = SleepTimerMode.Deadline(host.now + 15 * minute)
    timer.start(deadline)

    host.now += 5 * minute
    timer.onResumed()

    assertEquals(deadline, timer.mode)
  }

  @Test
  fun `each start, finish and cancel is reported once, so Wave can show it`() {
    val deadline = SleepTimerMode.Deadline(host.now + 30 * minute)
    timer.start(deadline)
    advanceTo(deadline.endsAtMs)
    timer.start(SleepTimerMode.EndOfTrack)
    timer.cancel()
    timer.cancel()
    timer.onPausedAtEndOfItem()

    assertEquals(listOf(deadline, null, SleepTimerMode.EndOfTrack, null), host.changes)
  }

  @Test
  fun `timers read from JS the way Core writes them`() {
    assertEquals(SleepTimerMode.Deadline(1_800_000L), SleepTimerWire.fromJs("deadline", 1_800_000.0))
    assertEquals(SleepTimerMode.EndOfTrack, SleepTimerWire.fromJs("endOfTrack", null))
    assertNull(SleepTimerWire.fromJs("deadline", null))
    assertNull(SleepTimerWire.fromJs("tomorrow", 1.0))
  }

  @Test
  fun `timers are reported to JS in Core's shape`() {
    assertEquals(
      mapOf("type" to "deadline", "endsAt" to 1_800_000.0),
      SleepTimerWire.toJs(SleepTimerMode.Deadline(1_800_000L)),
    )
    assertEquals(mapOf("type" to "endOfTrack"), SleepTimerWire.toJs(SleepTimerMode.EndOfTrack))
    assertNull(SleepTimerWire.toJs(null))
  }
}
