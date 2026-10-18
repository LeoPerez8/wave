package expo.modules.wavenative.player

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * [StreamBuffer.aheadMs] is a copy of Core's `bufferAheadMs` (the playback service can't call
 * Core): these are `streamBuffer.test.ts`'s cases, inputs and answers as Core's tests have them,
 * so the two can't drift apart unnoticed. Change both together.
 */
class StreamBufferTest {
  @Test
  fun itsConstantsAreCores() {
    // LIBRARY_BUFFER_MS, streamBufferMs(STREAM_BUFFER_DEFAULT).
    assertEquals(50_000L, StreamBuffer.LIBRARY_MS)
    assertEquals(120_000L, StreamBuffer.DEFAULT_MS)
  }

  @Test
  fun whileAStreamedSongLoadsThePlayerKeepsTheChosenMinutesAhead() {
    assertEquals(120_000L, StreamBuffer.aheadMs(120_000, streamed = true))
    assertEquals(1_800_000L, StreamBuffer.aheadMs(1_800_000, streamed = true))
  }

  @Test
  fun aLibraryFileKeepsThePlayersOwnFiftySecondsWhateverTheChoice() {
    assertEquals(50_000L, StreamBuffer.aheadMs(1_800_000, streamed = false))
    assertEquals(50_000L, StreamBuffer.aheadMs(60_000, streamed = false))
  }

  @Test
  fun neverLessThanThePlayersOwnFiftySecondsForAStreamedSongEither() {
    assertEquals(50_000L, StreamBuffer.aheadMs(10_000, streamed = true))
  }
}
