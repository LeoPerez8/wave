package expo.modules.wavenative.normalize

import org.junit.Assert.assertEquals
import org.junit.Test

class FileLoudnessTest {
  @Test
  fun eachOutcomeIsOneLineThatNamesNoSong() {
    assertEquals("Measured a song: -26.0 LUFS, peak -13.8 dBFS", FileLoudness.describe(FileLoudness.Outcome.Measured(-26.04, 0.2042)))
    assertEquals("Couldn't measure a song (IllegalStateException)", FileLoudness.describe(FileLoudness.Outcome.Unmeasurable("IllegalStateException")))
    assertEquals("Couldn't open a song to measure it", FileLoudness.describe(FileLoudness.Outcome.Unreadable))
    assertEquals("Stopped measuring: Normalize Volume is off", FileLoudness.describe(FileLoudness.Outcome.Cancelled))
  }
}
