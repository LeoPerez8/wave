package expo.modules.wavenative.yt

import java.io.IOException
import java.util.concurrent.CancellationException

/** One audio track's samples as the phone's extractor reads them through (`MediaExtractor`). */
interface AudioSamples {
  /** The current sample's track, or -1 once there are no more samples. */
  val trackIndex: Int
  /** The current sample's presentation time in microseconds. */
  val sampleTimeUs: Long
  /** Moves to the next sample; false at the end. */
  fun advance(): Boolean
}

object AudioSampleTime {
  /**
   * The time of the last of [samples], in microseconds, reading every one through, which also
   * proves the audio is there to its end. Throws [IOException] when there's none.
   */
  fun lastUs(samples: AudioSamples, isCancelled: () -> Boolean = { false }): Long {
    var lastUs = -1L
    // Not until a time below 0: with an edit list, Android 11+ gives AAC's priming samples one.
    while (samples.trackIndex >= 0) {
      if (isCancelled()) throw CancellationException("Download cancelled")
      lastUs = maxOf(lastUs, samples.sampleTimeUs)
      if (!samples.advance()) break
    }
    if (lastUs <= 0) throw IOException("No audio samples")
    return lastUs
  }
}
