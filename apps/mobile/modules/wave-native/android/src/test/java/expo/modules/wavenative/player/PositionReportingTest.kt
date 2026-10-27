package expo.modules.wavenative.player

import org.junit.Assert.*
import org.junit.Test

class PositionReportingTest {
  private class Clock {
    var pending: Runnable? = null
    var reports = 0
    val reporting = PositionReporting(
      schedule = { tick, delay -> assertEquals(500L, delay); pending = tick },
      cancel = { tick -> if (pending === tick) pending = null },
      report = { reports++ },
    )
    fun tick() {
      val next = pending
      pending = null
      next?.run()
    }
  }

  @Test fun `playing without demand schedules and reports nothing`() {
    val clock = Clock()
    clock.reporting.setPlaying(true)
    clock.tick()
    assertEquals(0, clock.reports)
    assertNull(clock.pending)
  }

  @Test fun `acquiring demand refreshes immediately and release cancels further reports`() {
    val clock = Clock()
    clock.reporting.setPlaying(true)
    clock.reporting.setRequested(true)
    assertEquals(1, clock.reports)
    assertNotNull(clock.pending)
    clock.tick()
    assertEquals(2, clock.reports)
    val queued = clock.pending!!
    clock.reporting.setRequested(false)
    assertNull(clock.pending)
    queued.run()
    assertEquals(2, clock.reports)
    assertNull(clock.pending)
  }

  @Test fun `pauses stop periodic reports and resuming honors existing demand`() {
    val clock = Clock()
    clock.reporting.setRequested(true)
    assertEquals(1, clock.reports)
    assertNull(clock.pending)
    clock.reporting.setPlaying(true)
    assertNotNull(clock.pending)
    clock.reporting.setPlaying(false)
    assertNull(clock.pending)
    clock.reporting.setPlaying(true)
    clock.tick()
    assertEquals(2, clock.reports)
    clock.reporting.stop()
    assertNull(clock.pending)
    clock.reporting.setPlaying(true)
    assertNull(clock.pending)
  }

  @Test fun `repeated requests keep one scheduled tick`() {
    val clock = Clock()
    clock.reporting.setPlaying(true)
    clock.reporting.setRequested(true)
    val pending = clock.pending
    clock.reporting.setRequested(true)
    clock.reporting.setPlaying(true)
    assertSame(pending, clock.pending)
    assertEquals(1, clock.reports)
  }
}
