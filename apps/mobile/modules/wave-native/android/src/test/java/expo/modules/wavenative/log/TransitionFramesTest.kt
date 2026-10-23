package expo.modules.wavenative.log

import org.junit.Assert.*
import org.junit.Test

class TransitionFramesTest {
  @Test fun strictLateBoundaryUsesTheDisplayCadence() {
    for (hz in listOf(60, 90, 120)) {
      val interval = 1000.0 / hz
      assertFalse(lateFrame(interval, interval))
      assertFalse(lateFrame(interval * 1.5, interval))
      assertTrue(lateFrame(interval * 1.5 + 0.001, interval))
      assertEquals(hz != 60, lateFrame(20.0, interval))
    }
    assertFalse(lateFrame(100.0, 0.0))
  }

  @Test fun callbacksExistOnlyInsideTheTransitionAndRetainFirstAndFinalStalls() {
    var callback: ((Double) -> Unit)? = null
    val frames = TransitionFrames({ 1000.0 / 120 }) { next ->
      callback = next
      ({ callback = null })
    }
    assertNull(callback)
    frames.start(1, 0.0)
    callback!!(40.0)
    callback!!(48.0)
    assertEquals(FrameTotals(2, 40.0), frames.stop(1, 70.0))
    assertNull(callback)
    assertNull(frames.stop(1, 100.0))
  }

  @Test fun supersededAndBackgroundCallbacksCannotAffectNewCounters() {
    var callback: ((Double) -> Unit)? = null
    val frames = TransitionFrames({ 1000.0 / 90 }) { next ->
      callback = next
      ({ callback = null })
    }
    frames.start(1, 0.0)
    val old = callback!!
    frames.start(2, 100.0)
    old(200.0)
    assertNull(frames.stop(1, 300.0))
    callback!!(110.0)
    assertEquals(FrameTotals(0, 10.0), frames.stop(2, 115.0))
    frames.start(3, 200.0)
    val beforeBackground = callback!!
    frames.clear()
    beforeBackground(1000.0)
    assertNull(callback)
    assertNull(frames.stop(3, 2000.0))
  }

  @Test fun longestGapIsRetainedAcrossRefreshRateChanges() {
    var hz = 120
    var callback: ((Double) -> Unit)? = null
    val frames = TransitionFrames({ 1000.0 / hz }) { next ->
      callback = next
      ({ callback = null })
    }
    frames.start(1, 0.0)
    callback!!(16.0)
    hz = 60
    callback!!(36.0)
    assertEquals(FrameTotals(1, 20.0), frames.stop(1, 36.0))
  }

  @Test fun kotlinHitchTextKeepsCoresShapeAndFreezeBoundary() {
    assertNull(FreezeWatch.hitchLine("JS", 499, "/a"))
    assertEquals("JS thread busy 0.5 s on /a", FreezeWatch.hitchLine("JS", 500, "/a"))
    assertEquals("JS thread busy 0.8 s on /a", FreezeWatch.hitchLine("JS", 800, "/a"))
    assertEquals("main thread busy 3.0 s on /a\nat scan\nat query", FreezeWatch.hitchLine("main", 2999, "/a", "at scan\nat query"))
    assertEquals("JS thread busy 1.2 s on /a", FreezeWatch.hitchLine("JS", 1150, "/a"))
    assertNull(FreezeWatch.hitchLine("JS", 3000, "/a"))
    assertEquals("main thread busy 1.1 s", FreezeWatch.hitchLine("main", 1100, null))
  }
}
