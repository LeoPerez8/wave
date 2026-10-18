package expo.modules.wavenative.player

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * [CrossfadeTiming] is a copy of Core's `crossfade.ts` timing (the playback service can't call
 * Core): these are `crossfade.test.ts`'s cases, inputs and answers as Core's tests have them, so
 * the two can't drift apart unnoticed. Change both together.
 */
class CrossfadeTimingTest {
  @Test
  fun itsConstantsAreCores() {
    // CROSSFADE_PRE_ROLL_MS, CROSSFADE_PREFETCH_LEAD_MS, MIN_LATE_CROSSFADE_MS.
    assertEquals(3000L, CrossfadeTiming.PREROLL_MS)
    assertEquals(30_000L, CrossfadeTiming.PREFETCH_LEAD_MS)
    assertEquals(1000L, CrossfadeTiming.MIN_LATE_MS)
  }

  @Test
  fun theNextSongIsFetchedWellBeforeTheOverlap() {
    // 180 s − 10 s overlap − 3 s pre-roll − 30 s ahead.
    assertEquals(137_000L, CrossfadeTiming.prefetchAt(10_000, 180_000))
  }

  @Test
  fun aSongTooShortForThatFetchesTheNextOneFromItsStart() {
    assertEquals(0L, CrossfadeTiming.prefetchAt(10_000, 40_000))
    // A 6 s song overlaps for 3 s at most, so it fetches from the start too.
    assertEquals(0L, CrossfadeTiming.prefetchAt(10_000, 6000))
  }

  @Test
  fun aLongerOverlapFetchesEarlierUpToFifteenSeconds() {
    assertEquals(32_000L, CrossfadeTiming.prefetchAt(15_000, 80_000))
  }

  @Test
  fun aLateNextSongOverlapsForWhatIsLeft() {
    assertEquals(6000L, CrossfadeTiming.lateOverlap(10_000, 6000))
  }

  @Test
  fun oneReadyOnTimeOverlapsForTheWholeSetting() {
    assertEquals(10_000L, CrossfadeTiming.lateOverlap(10_000, 10_000))
    assertEquals(10_000L, CrossfadeTiming.lateOverlap(10_000, 10_040))
  }

  @Test
  fun withUnderASecondLeftOrTheSongOverTheMoveIsGapless() {
    assertEquals(1000L, CrossfadeTiming.lateOverlap(10_000, 1000))
    assertEquals(0L, CrossfadeTiming.lateOverlap(10_000, 999))
    assertEquals(0L, CrossfadeTiming.lateOverlap(10_000, 0))
    assertEquals(0L, CrossfadeTiming.lateOverlap(10_000, -500))
  }
}
