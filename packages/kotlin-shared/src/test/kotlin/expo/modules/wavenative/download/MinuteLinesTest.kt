package expo.modules.wavenative.download

import org.junit.Assert.assertEquals
import org.junit.Test

/** The lines the download service writes about once a minute while it runs (#450, shared with #452). */
class MinuteLinesTest {
  private var now = 0L
  private var tick: (() -> Unit)? = null
  private var cancelled = 0
  private val minutes = MinuteLines(clock = { now }, every = { _, run -> tick = run; { cancelled++; tick = null } })
  private val written = mutableListOf<String>()

  private fun at(ms: Long) { now = ms; tick?.invoke() }

  @Test fun writesEachLineAboutOnceAMinuteWhileItRuns() {
    minutes.add { written += "memory" }
    minutes.add { written += "journal" }
    now = 1_000L; minutes.start()
    at(6_000L); at(31_000L); at(56_000L)
    assertEquals(emptyList<String>(), written)
    at(61_000L)
    assertEquals(listOf("memory", "journal"), written)
    at(66_000L); at(116_000L)
    assertEquals(2, written.size)
    at(121_000L)
    assertEquals(listOf("memory", "journal", "memory", "journal"), written)
  }

  @Test fun neverWritesMoreOftenThanOnceAMinuteWhenTicksComeInABurst() {
    minutes.add { written += "memory" }
    minutes.start()
    // A process Android paused: the late ticks all come at once.
    repeat(5) { at(300_000L) }
    at(300_500L); at(359_000L)
    assertEquals(listOf("memory"), written)
    at(360_000L)
    assertEquals(listOf("memory", "memory"), written)
  }

  @Test fun stopsTickingWhenTheServiceStopsAndWaitsAMinuteAfterItStartsAgain() {
    minutes.add { written += "memory" }
    minutes.start()
    minutes.stop()
    assertEquals(1, cancelled)
    at(90_000L)
    assertEquals(emptyList<String>(), written)
    minutes.start()
    at(120_000L)
    assertEquals(emptyList<String>(), written)
    at(150_000L)
    assertEquals(listOf("memory"), written)
  }

  @Test fun startingTwiceKeepsOneTick() {
    minutes.add { written += "memory" }
    minutes.start(); minutes.start()
    assertEquals(0, cancelled)
    minutes.stop(); minutes.stop()
    assertEquals(1, cancelled)
  }

  @Test fun aLineThatFailsLeavesTheOthersWritten() {
    minutes.add { error("no memory to read") }
    val remove = minutes.add { written += "journal" }
    minutes.start()
    at(60_000L)
    assertEquals(listOf("journal"), written)
    remove()
    at(120_000L)
    assertEquals(listOf("journal"), written)
  }
}
