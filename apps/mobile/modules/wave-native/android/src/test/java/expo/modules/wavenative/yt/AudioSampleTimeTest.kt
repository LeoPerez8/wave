package expo.modules.wavenative.yt

import java.io.IOException
import org.junit.Assert.*
import org.junit.Test

class AudioSampleTimeTest {
  @Test fun theLastSampleGivesTheAudiosLength() {
    assertEquals(180_000_000L, AudioSampleTime.lastUs(Samples(0L, 23_219L, 179_976_780L, 180_000_000L)))
  }

  /** Android 11+ applies YouTube's DASH M4A edit list: the AAC priming samples come before 0. */
  @Test fun primingSamplesBeforeZeroDontEndTheReading() {
    assertEquals(180_000_000L, AudioSampleTime.lastUs(Samples(-43_356L, -21_333L, 0L, 21_333L, 180_000_000L)))
  }

  @Test fun audioWithNoSamplesIsRefused() {
    assertThrows(IOException::class.java) { AudioSampleTime.lastUs(Samples()) }
    assertThrows(IOException::class.java) { AudioSampleTime.lastUs(Samples(-21_333L, 0L)) }
  }

  /** What `MediaExtractor` reports for a selected track: -1 for both once past the last sample. */
  private class Samples(vararg val times: Long) : AudioSamples {
    private var index = 0
    override val trackIndex get() = if (index < times.size) 0 else -1
    override val sampleTimeUs get() = if (index < times.size) times[index] else -1L
    override fun advance(): Boolean { index++; return index < times.size }
  }
}
