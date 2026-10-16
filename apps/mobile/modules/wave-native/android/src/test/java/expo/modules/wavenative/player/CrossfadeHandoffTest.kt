package expo.modules.wavenative.player

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CrossfadeHandoffTest {
  @Test
  fun theMoveAnOverlapStartedIsReportedAsACrossfadeOnce() {
    val handoff = CrossfadeHandoff()
    handoff.mark("b", nowMs = 10_000)
    assertTrue(handoff.take("b", nowMs = 10_020))
    assertFalse(handoff.take("b", nowMs = 10_040))
  }

  @Test
  fun anotherMoveHeardFirstLeavesItWaiting() {
    // A sync or playlist move from just before the overlap, still on its way to the module.
    val handoff = CrossfadeHandoff()
    handoff.mark("b", nowMs = 10_000)
    assertFalse(handoff.take("a", nowMs = 10_010))
    assertTrue(handoff.take("b", nowMs = 10_020))
  }

  @Test
  fun aMoveThatNeverArrivedIsForgottenSoon() {
    // A later move to the same entry (previous, picking it) isn't a crossfade.
    val handoff = CrossfadeHandoff()
    handoff.mark("b", nowMs = 10_000)
    assertFalse(handoff.take("c", nowMs = 10_050))
    assertFalse(handoff.take("b", nowMs = 40_000))
  }

  @Test
  fun clearingForgetsIt() {
    val handoff = CrossfadeHandoff()
    handoff.mark("b", nowMs = 10_000)
    handoff.clear()
    assertFalse(handoff.take("b", nowMs = 10_010))
  }
}
