package expo.modules.wavenative.player

import androidx.media3.common.Player
import org.junit.Assert.assertEquals
import org.junit.Test

class CrossfadeLogTest {
  private val next = CrossfadeCause("Next")

  @Test
  fun aSkippedLineSaysWhatChangedTheSong() {
    assertEquals(
      "Crossfade skipped: the song changed before its overlap was due; song changed by Next",
      CrossfadeLog.line(CrossfadeOutcome.Skipped(CrossfadeSkip.Early, cause = next), main = null, outgoing = null),
    )
    assertEquals(
      "Crossfade skipped: the next song wasn't ready (4.5 s late); song changed by the song ending",
      CrossfadeLog.line(
        CrossfadeOutcome.Skipped(CrossfadeSkip.NotReady, lateMs = 4500, cause = CrossfadeCause.SongEnded),
        main = null,
        outgoing = null,
      ),
    )
  }

  @Test
  fun aSkipForASeekSaysWhereTheSeekCameFrom() {
    assertEquals(
      "Crossfade skipped: a seek (Previous restarting the song); song changed by Previous",
      CrossfadeLog.line(
        CrossfadeOutcome.Skipped(
          CrossfadeEnd.Seek,
          cause = CrossfadeCause("Previous"),
          seekFrom = CrossfadeCause("Previous restarting the song"),
        ),
        main = null,
        outgoing = null,
      ),
    )
  }

  @Test
  fun aDoneLineSaysHowLongTheOverlapWas() {
    assertEquals("Crossfade done: 13.3 s overlap", CrossfadeLog.line(CrossfadeOutcome.Done(13_300, 0), null, null))
    assertEquals(
      "Crossfade done: 6.7 s overlap (2.8 s short, the next song was late)",
      CrossfadeLog.line(CrossfadeOutcome.Done(6700, 2800), null, null),
    )
  }

  @Test
  fun aCutLineNamesItsCauseAndEachPlayersState() {
    val main = CrossfadeLog.DeckState(0, Player.STATE_BUFFERING, playWhenReady = true, isPlaying = false, suppression = 0)
    val outgoing = CrossfadeLog.DeckState(292_839, Player.STATE_READY, playWhenReady = false, isPlaying = false, suppression = 0)
    assertEquals(
      "Crossfade cut 6.6 s in of 11.7 s: a seek (the scrubber); " +
        "main at 0 ms, buffering, playWhenReady=true, isPlaying=false, suppression=0; " +
        "outgoing at 292839 ms, ready, playWhenReady=false, isPlaying=false, suppression=0",
      CrossfadeLog.line(
        CrossfadeOutcome.Cut(CrossfadeEnd.Seek, elapsedMs = 6600, overlapMs = 11_700, cause = CrossfadeCause("the scrubber")),
        main,
        outgoing,
      ),
    )
    assertEquals(
      "Crossfade cut 0.0 s in before the next song sounded: the player moved to another song (Next); " +
        "main at 0 ms, buffering, playWhenReady=true, isPlaying=false, suppression=0; outgoing none",
      CrossfadeLog.line(CrossfadeOutcome.Cut(CrossfadeEnd.Moved, 0, null, cause = next), main, null),
    )
  }

  @Test
  fun aLineWithNoKnownCauseSaysOnlyWhy() {
    assertEquals(
      "Crossfade cut 1.0 s in of 5.0 s: a player error; main none; outgoing none",
      CrossfadeLog.line(CrossfadeOutcome.Cut(CrossfadeEnd.Error, 1000, 5000), null, null),
    )
  }
}
