package expo.modules.wavenative.log

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The freeze watch runs only while Wave is on screen, so background playback never wakes up for it. */
class FreezeWatchdogTest {
  /** What the watchdog runs about once a second while it ticks; null while it doesn't. */
  private var ticking: Runnable? = null
  private var started = 0

  private val watchdog = FreezeWatchdog { tick ->
    ticking = tick
    started++
    ({ ticking = null })
  }

  /** Pings posted to the watched thread, which answers each at once. */
  private var pings = 0
  private var now = 0L

  init {
    watchdog.watch(FreezeWatch("main", 3_000, { now }, { ping -> pings++; ping.run(); true }))
  }

  private fun seconds(count: Int) = repeat(count) {
    now += 1_000
    ticking?.run()
  }

  @Test
  fun nothingTicksBeforeWaveShows() {
    seconds(10)

    assertNull(ticking)
    assertEquals(0, pings)
  }

  @Test
  fun whileWaveShowsTheThreadsArePingedEverySecond() {
    watchdog.activityStarted()

    seconds(5)

    assertEquals(5, pings)
  }

  @Test
  fun inTheBackgroundItStopsTicking() {
    watchdog.activityStarted()
    seconds(2)

    watchdog.activityStopped()
    seconds(60)

    assertNull(ticking)
    assertEquals(2, pings)
  }

  @Test
  fun goingFromOneOfWavesScreensToAnotherKeepsItTicking() {
    watchdog.activityStarted()
    // The next activity starts before the one it covers stops.
    watchdog.activityStarted()
    watchdog.activityStopped()
    seconds(3)

    assertEquals(1, started)
    assertEquals(3, pings)
  }

  @Test
  fun comingBackStartsItAgain() {
    watchdog.activityStarted()
    watchdog.activityStopped()

    watchdog.activityStarted()
    seconds(2)

    assertEquals(2, started)
    assertEquals(2, pings)
  }

  @Test
  fun aWatchThatEndsIsNoLongerPinged() {
    val js = FreezeWatch("JS", 3_000, { now }, { ping -> pings += 100; ping.run(); true })
    val unwatch = watchdog.watch(js)
    watchdog.activityStarted()
    seconds(1)

    unwatch()
    seconds(1)

    assertEquals(1 + 100 + 1, pings)
  }
  @Test
  fun backgroundingDiscardsQueuedAnswersEvenBeforeTheNextTick() {
    val queue = ArrayDeque<Runnable>()
    var hitches = 0
    val unwatch = watchdog.watch(FreezeWatch("JS", 3_000, { now }, { queue.addLast(it); true }, hitch = { hitches++ }))
    watchdog.activityStarted()
    seconds(1)
    watchdog.activityStopped()
    now += 800
    queue.removeFirst().run()
    assertEquals(0, hitches)
    watchdog.activityStarted()
    seconds(1)
    assertEquals(1, queue.size)
    unwatch()
    now += 800
    queue.removeFirst().run()
    assertEquals(0, hitches)
    watchdog.activityStopped()
    assertNull(ticking)
  }

}
