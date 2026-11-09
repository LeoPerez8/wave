package expo.modules.wavenative.normalize

import android.content.Context
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaFormat
import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.inspector.MediaExtractorCompat
import java.io.File
import java.nio.ByteBuffer

/**
 * Normalize Volume's measurement of a Library file: decodes it as the player does and runs its
 * PCM through [LoudnessMeter]. The file is read by Media3's own extractors
 * ([MediaExtractorCompat], the player's), and decoded by the platform decoder the player's
 * renderer picks for its format, so every file the player plays (MP3, FLAC, Ogg Vorbis, Opus,
 * M4A, WAV) is measured; raw PCM skips the decoder, as the player's does. Runs on the caller's
 * thread, which should be a background one ([WaveNativeModule]'s meter thread).
 */
@OptIn(UnstableApi::class)
object FileLoudness {
  /** What measuring a file gave (`AudioMeasurement` in JS). */
  sealed interface Outcome {
    data class Measured(val loudness: Double, val peak: Double) : Outcome

    /** It couldn't be decoded, or holds nothing above the absolute gate (silence). */
    data object Unmeasurable : Outcome

    /** It couldn't be opened now: gone, or on storage that isn't mounted. */
    data object Unreadable : Outcome

    data object Cancelled : Outcome
  }

  /** A decoder handing back nothing for this long has stalled: the file is taken as undecodable. */
  private const val STALL_NS = 15_000_000_000L
  private const val DEQUEUE_US = 10_000L

  /** Room for the largest compressed frame the formats played here have (a 24-bit FLAC frame). */
  private const val MIN_INPUT_BYTES = 256 * 1024

  /** Where Media3's `MediaFormatUtil` keeps a raw track's encoding (`C.ENCODING_*`). */
  private const val MEDIA3_PCM_ENCODING = "exo-pcm-encoding-int"

  private class Stop : Exception()

  fun measure(context: Context, path: String, isCancelled: () -> Boolean): Outcome {
    val file = File(path)
    if (!file.isFile || !file.canRead()) return Outcome.Unreadable
    val extractor = MediaExtractorCompat(context)
    return try {
      extractor.setDataSource(Uri.fromFile(file), 0)
      val track = (0 until extractor.trackCount).firstOrNull {
        extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
      } ?: return Outcome.Unmeasurable
      extractor.selectTrack(track)
      val format = extractor.getTrackFormat(track)
      val result = if (format.getString(MediaFormat.KEY_MIME) == MimeTypes.AUDIO_RAW) {
        readRaw(extractor, format, isCancelled)
      } else {
        decode(extractor, format, isCancelled)
      }
      result?.let { Outcome.Measured(it.integratedLufs, it.samplePeak) } ?: Outcome.Unmeasurable
    } catch (_: Stop) {
      Outcome.Cancelled
    } catch (_: Exception) {
      Outcome.Unmeasurable
    } finally {
      extractor.release()
    }
  }

  /** PCM a WAV holds, straight from the file. */
  private fun readRaw(extractor: MediaExtractorCompat, format: MediaFormat, isCancelled: () -> Boolean): LoudnessMeter.Result? {
    val encoding = encodingOf(format, raw = true) ?: return null
    val meter = LoudnessMeter(format.getInteger(MediaFormat.KEY_SAMPLE_RATE), format.getInteger(MediaFormat.KEY_CHANNEL_COUNT))
    val buffer = ByteBuffer.allocateDirect(maxOf(MIN_INPUT_BYTES, inputSize(format)))
    while (true) {
      if (isCancelled()) throw Stop()
      buffer.clear()
      val size = extractor.readSampleData(buffer, 0)
      if (size < 0) break
      buffer.position(0)
      buffer.limit(size)
      meter.add(buffer, encoding)
      extractor.advance()
    }
    return meter.result()
  }

  /** A compressed file through the platform decoder for its format. */
  private fun decode(extractor: MediaExtractorCompat, format: MediaFormat, isCancelled: () -> Boolean): LoudnessMeter.Result? {
    val mime = format.getString(MediaFormat.KEY_MIME) ?: return null
    format.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, maxOf(MIN_INPUT_BYTES, inputSize(format)))
    val codec = MediaCodec.createDecoderByType(mime)
    try {
      codec.configure(format, null, null, 0)
      codec.start()
      val info = MediaCodec.BufferInfo()
      var meter: LoudnessMeter? = null
      var encoding = PcmEncoding.PCM_16BIT
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
            lastProgress = System.nanoTime()
          }
        }
        val output = codec.dequeueOutputBuffer(info, DEQUEUE_US)
        if (output == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
          check(meter == null) { "The decoder changed its output mid-file" }
          encoding = encodingOf(codec.outputFormat, raw = false) ?: return null
        } else if (output >= 0) {
          lastProgress = System.nanoTime()
          if (info.size > 0) {
            val pcm = checkNotNull(codec.getOutputBuffer(output))
            pcm.position(info.offset)
            pcm.limit(info.offset + info.size)
            val active = meter ?: codec.outputFormat.let {
              LoudnessMeter(it.getInteger(MediaFormat.KEY_SAMPLE_RATE), it.getInteger(MediaFormat.KEY_CHANNEL_COUNT))
            }
            meter = active
            active.add(pcm, encoding)
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

  private fun inputSize(format: MediaFormat): Int =
    if (format.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) format.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE) else 0

  /**
   * The layout of a format's PCM; null for one the meter doesn't read (big-endian). Media3 gives
   * a [raw] track's own encoding under [MEDIA3_PCM_ENCODING] (Android's key can't name every
   * one); a decoder that names none gives 16-bit.
   */
  private fun encodingOf(format: MediaFormat, raw: Boolean): PcmEncoding? {
    val encoding = when {
      raw && format.containsKey(MEDIA3_PCM_ENCODING) -> format.getInteger(MEDIA3_PCM_ENCODING)
      format.containsKey(MediaFormat.KEY_PCM_ENCODING) -> format.getInteger(MediaFormat.KEY_PCM_ENCODING)
      else -> AudioFormat.ENCODING_PCM_16BIT
    }
    // Media3's encodings are Android's for the little-endian layouts.
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
