package expo.modules.wavenative.player

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * [NormalizeVolume.gain] is a copy of Core's `songGain` (the playback service can't call Core):
 * these are `normalizeVolume.test.ts`'s cases, inputs and answers as Core's tests have them, so
 * the two can't drift apart unnoticed. Change both together.
 */
class NormalizeVolumeTest {
  private fun gain(on: Boolean, youtubeLoudnessDb: Double? = null) =
    NormalizeVolume.gain(on, SongLoudness(youtubeLoudnessDb))

  @Test
  fun itsConstantsAreCores() {
    // TYPICAL_GAIN_START_DB.
    assertEquals(-5.0, NormalizeVolume.TYPICAL_START_DB, 0.0)
  }

  @Test
  fun aStreamedSongLouderThanYouTubesReferenceIsTurnedDownByYouTubesValue() {
    assertEquals(SongGain(-6.23, GainSource.YOUTUBE), gain(true, 6.23))
  }

  @Test
  fun aStreamedSongQuieterThanYouTubesReferenceIsNeverTurnedUp() {
    assertEquals(SongGain(0.0, GainSource.YOUTUBE), gain(true, -3.5))
  }

  @Test
  fun aStreamedSongRightAtYouTubesReferencePlaysAsItIs() {
    assertEquals(SongGain(0.0, GainSource.YOUTUBE), gain(true, 0.0))
  }

  @Test
  fun aSongWaveKnowsNothingAboutPlaysAtTheTypicalGainsStartingValue() {
    assertEquals(SongGain(-5.0, GainSource.TYPICAL), gain(true))
  }

  @Test
  fun aValueYouTubeDidntReallyGiveCountsAsNothingKnown() {
    assertEquals(SongGain(-5.0, GainSource.TYPICAL), gain(true, Double.NaN))
  }

  @Test
  fun withTheSwitchOffEverySongPlaysAsItIs() {
    assertEquals(SongGain(0.0, GainSource.OFF), gain(false, 6.23))
    assertEquals(SongGain(0.0, GainSource.OFF), gain(false))
  }

  @Test
  fun theAppLogLineGivesTheGainAndItsSourceWithoutTheSong() {
    assertEquals("Song gain -6.2 dB (YouTube)", NormalizeVolume.logLine(SongGain(-6.23, GainSource.YOUTUBE)))
    assertEquals("Song gain -5.0 dB (typical)", NormalizeVolume.logLine(SongGain(-5.0, GainSource.TYPICAL)))
    assertEquals("Song gain 0.0 dB (off)", NormalizeVolume.logLine(SongGain(0.0, GainSource.OFF)))
  }
}
