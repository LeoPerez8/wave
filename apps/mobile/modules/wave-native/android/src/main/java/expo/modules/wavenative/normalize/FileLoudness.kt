package expo.modules.wavenative.normalize

import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.util.Log
import expo.modules.wavenative.log.WaveLog
import expo.modules.wavenative.player.NormalizeVolume
import java.io.File
import java.nio.ByteBuffer
import java.util.Locale
import kotlin.math.log10

/**
 * Normalize Volume's measurement of a Library file: decodes it and runs its PCM through
 * [LoudnessMeter]. Android's [MediaExtractor] reads every container the player plays from the
 * Library on Wave's minimum Android (MP3, FLAC, Ogg Vorbis, Ogg Opus, M4A, WAV), and the file is
 * decoded by the same platform decoder the player's renderer uses for its format; raw PCM skips
 * the decoder, as the player's does. Runs on the caller's thread, which should be a background
 * one ([expo.modules.wavenative.WaveNativeModule]'s meter thread).
 */
object FileLoudness {
  /** What measuring a file gave (`AudioMeasurement` in JS). */
  sealed interface Outcome {
    data class Measured(val loudness: Double, val peak: Double) : Outcome

    /** It couldn't be decoded, or holds nothing above the absolute gate (silence); [reason] names why, never the file. */
    data class Unmeasurable(val reason: String) : Outcome

    /** It couldn't be opened now: gone, or on storage that isn't mounted. */
    data object Unreadable : Outcome

    data object Cancelled : Outcome
  }

  /** A decoder handing back nothing for this long has stalled: the file is taken as undecodable. */
  private const val STALL_NS = 15_000_000_000L
  private const val DEQUEUE_US = 10_000L

  /** Room for the largest compressed frame the formats played here have (a 24-bit FLAC frame). */
  private const val MIN_INPUT_BYTES = 256 * 1024

  /**
   * More decoded audio than twice the file's length, and a minute, means the decode is going
   * round in circles (a broken file, or an extractor that repeats itself): undecodable.
   */
  private const val SLACK_US = 60_000_000L

  private class Stop : Exception()

  fun measure(path: String, isCancelled: () -> Boolean): Outcome {
    val file = File(path)
    if (!file.isFile || !file.canRead()) return Outcome.Unreadable
    val extractor = MediaExtractor()
    return try {
      extractor.setDataSource(file.path)
      val track = (0 until extractor.trackCount).firstOrNull {
        extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
      } ?: return Outcome.Unmeasurable("no audio track")
      extractor.selectTrack(track)
      val format = extractor.getTrackFormat(track)
      val result = if (format.getString(MediaFormat.KEY_MIME) == RAW) {
        readRaw(extractor, format, isCancelled)
      } else {
        decode(extractor, format, isCancelled)
      }
      result?.let { Outcome.Measured(it.integratedLufs, it.samplePeak) } ?: Outcome.Unmeasurable("silent or unsupported PCM")
    } catch (_: Stop) {
      Outcome.Cancelled
    } catch (failure: Exception) {
      Outcome.Unmeasurable(failure.javaClass.simpleName)
    } finally {
      extractor.release()
    }
  }

  private const val RAW = "audio/raw"

  /**
   * How a measurement went, in one line that never names the song: in logcat, and in the app log
   * as well when the file couldn't be measured.
   */
  fun report(outcome: Outcome) {
    val line = describe(outcome)
    runCatching {
      if (outcome is Outcome.Unmeasurable) WaveLog.w(NormalizeVolume.LOG_TAG, line) else Log.i(NormalizeVolume.LOG_TAG, line)
    }
  }

  internal fun describe(outcome: Outcome): String = when (outcome) {
    is Outcome.Measured ->
      String.format(Locale.ROOT, "Measured a song: %.1f LUFS, peak %.1f dBFS", outcome.loudness, 20 * log10(outcome.peak))
    is Outcome.Unmeasurable -> "Couldn't measure a song (${outcome.reason})"
    Outcome.Unreadable -> "Couldn't open a song to measure it"
    Outcome.Cancelled -> "Stopped measuring: Normalize Volume is off"
  }

  /** PCM a WAV holds, straight from the file. */
  private fun readRaw(extractor: MediaExtractor, format: MediaFormat, isCancelled: () -> Boolean): LoudnessMeter.Result? {
    val encoding = encodingOf(format) ?: return null
    val rate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
    val channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
    val meter = LoudnessMeter(rate, channels)
    val budget = FrameBudget(format, rate)
    val buffer = ByteBuffer.allocateDirect(maxOf(MIN_INPUT_BYTES, inputSize(format)))
    while (true) {
      if (isCancelled()) throw Stop()
      val size = extractor.readSampleData(buffer, 0)
      if (size < 0) break
      buffer.position(0)
      buffer.limit(size)
      meter.add(buffer, encoding)
      budget.spend(size / (encoding.bytes * channels))
      extractor.advance()
    }
    return meter.result()
  }

  /** A compressed file through the platform decoder for its format. */
  private fun decode(extractor: MediaExtractor, format: MediaFormat, isCancelled: () -> Boolean): LoudnessMeter.Result? {
    val mime = format.getString(MediaFormat.KEY_MIME) ?: return null
    format.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, maxOf(MIN_INPUT_BYTES, inputSize(format)))
    val codec = MediaCodec.createDecoderByType(mime)
    try {
      codec.configure(format, null, null, 0)
      codec.start()
      val info = MediaCodec.BufferInfo()
      var meter: LoudnessMeter? = null
      var budget: FrameBudget? = null
      var encoding = PcmEncoding.PCM_16BIT
      var channels = 0
      var inputEnded = false
      var lastProgress = System.nanoTime()
      while (true) {
        if (isCancelled()) throw Stop()
        check(!Thread.currentThread().isInterrupted && System.nanoTime() - lastProgress < STALL_NS) { "Decoder stalled" }
        if (!inputEnded) {
          val input = codec.dequeueInputBuffer(DEQUEUE_US)
          if (input >= 0) {
            val buffer = checkNotNull(codec.getInputBuffer(input))
            val size = extractor.readSampleData(buffer, 0)
            if (size < 0) {
              codec.queueInputBuffer(input, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
              inputEnded = true
            } else {
              codec.queueInputBuffer(input, 0, size, extractor.sampleTime, 0)
              extractor.advance()
            }
          }
        }
        val output = codec.dequeueOutputBuffer(info, DEQUEUE_US)
        if (output == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
          check(meter == null) { "The decoder changed its output mid-file" }
          encoding = encodingOf(codec.outputFormat) ?: return null
        } else if (output >= 0) {
          lastProgress = System.nanoTime()
          if (info.size > 0) {
            val pcm = checkNotNull(codec.getOutputBuffer(output))
            pcm.position(info.offset)
            pcm.limit(info.offset + info.size)
            val active = meter ?: codec.outputFormat.let {
              val rate = it.getInteger(MediaFormat.KEY_SAMPLE_RATE)
              channels = it.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
              budget = FrameBudget(format, rate)
              LoudnessMeter(rate, channels)
            }
            meter = active
            active.add(pcm, encoding)
            budget?.spend(info.size / (encoding.bytes * channels))
          }
          codec.releaseOutputBuffer(output, false)
          if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) break
        }
      }
      return meter?.result()
    } finally {
      runCatching { codec.stop() }
      codec.release()
    }
  }

  /** The frames a file's PCM may run to ([SLACK_US]); no limit when it doesn't say how long it is. */
  private class FrameBudget(format: MediaFormat, rate: Int) {
    private var left = if (format.containsKey(MediaFormat.KEY_DURATION)) {
      (2 * format.getLong(MediaFormat.KEY_DURATION) + SLACK_US) * rate / 1_000_000
    } else {
      Long.MAX_VALUE
    }

    fun spend(frames: Int) {
      left -= frames
      check(left >= 0) { "Decoded more audio than the file holds" }
    }
  }

  private fun inputSize(format: MediaFormat): Int =
    if (format.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) format.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE) else 0

  /** The layout of a format's PCM; null for one the meter doesn't read. Without a word, 16-bit. */
  private fun encodingOf(format: MediaFormat): PcmEncoding? {
    val encoding = if (format.containsKey(MediaFormat.KEY_PCM_ENCODING)) {
      format.getInteger(MediaFormat.KEY_PCM_ENCODING)
    } else {
      AudioFormat.ENCODING_PCM_16BIT
    }
    return when (encoding) {
      AudioFormat.ENCODING_PCM_8BIT -> PcmEncoding.PCM_8BIT
      AudioFormat.ENCODING_PCM_16BIT -> PcmEncoding.PCM_16BIT
      AudioFormat.ENCODING_PCM_24BIT_PACKED -> PcmEncoding.PCM_24BIT
      AudioFormat.ENCODING_PCM_32BIT -> PcmEncoding.PCM_32BIT
      AudioFormat.ENCODING_PCM_FLOAT -> PcmEncoding.FLOAT
      else -> null
    }
  }
}
