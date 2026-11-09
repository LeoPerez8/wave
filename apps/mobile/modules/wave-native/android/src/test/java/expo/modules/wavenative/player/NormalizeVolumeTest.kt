package expo.modules.wavenative.player

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * [NormalizeVolume.gain] is a copy of Core's `songGain` (the playback service can't call Core):
 * these are `normalizeVolume.test.ts`'s cases, inputs and answers as Core's tests have them, so
 * the two can't drift apart unnoticed. Change both together. A Library song's gain comes from
 * Core's `knownGain` with the queue ([SongGains]), so its tag rules are tested there.
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
  fun aLibrarySongPlaysAtTheGainCoreGaveItWithTheQueue() {
    val tagged = SongLoudness(known = SongGain(-2.54, GainSource.TAG))
    assertEquals(SongGain(-2.54, GainSource.TAG), NormalizeVolume.gain(true, tagged))
  }

  @Test
  fun aMeasuredSongUsesItsPeakCappedGainAndNamesItsSource() {
    assertEquals(GainSource.MEASURED, GainSource.of("measured"))
    assertEquals("measured", GainSource.MEASURED.logName)
    val measured = SongLoudness(known = SongGain(6.02, GainSource.MEASURED))
    assertEquals(SongGain(6.02, GainSource.MEASURED), NormalizeVolume.gain(true, measured))
  }

  @Test
  fun aSongWithNoValuePlaysAtTheTypicalGainItsGiven() {
    assertEquals(SongGain(-7.25, GainSource.TYPICAL), NormalizeVolume.gain(true, SongLoudness(), typicalDb = -7.25))
  }

  @Test
  fun withTheSwitchOffATaggedSongPlaysAsItIs() {
    val tagged = SongLoudness(known = SongGain(-6.0, GainSource.TAG))
    assertEquals(SongGain(0.0, GainSource.OFF), NormalizeVolume.gain(false, tagged, typicalDb = -7.0))
  }

  @Test
  fun aSourceIsReadByCoresName() {
    assertEquals(GainSource.TAG, GainSource.of("tag"))
    assertEquals(GainSource.YOUTUBE, GainSource.of("youtube"))
    assertEquals(null, GainSource.of("loud"))
    assertEquals(null, GainSource.of(null))
  }

  @Test
  fun theAppLogLineGivesTheGainAndItsSourceWithoutTheSong() {
    assertEquals("Song gain -2.5 dB (tag)", NormalizeVolume.logLine(SongGain(-2.54, GainSource.TAG)))
    assertEquals("Song gain -6.0 dB (measured)", NormalizeVolume.logLine(SongGain(-6.0, GainSource.MEASURED)))
    assertEquals("Song gain -6.2 dB (YouTube)", NormalizeVolume.logLine(SongGain(-6.23, GainSource.YOUTUBE)))
    assertEquals("Song gain -5.0 dB (typical)", NormalizeVolume.logLine(SongGain(-5.0, GainSource.TYPICAL)))
    assertEquals("Song gain 0.0 dB (off)", NormalizeVolume.logLine(SongGain(0.0, GainSource.OFF)))
  }
}
