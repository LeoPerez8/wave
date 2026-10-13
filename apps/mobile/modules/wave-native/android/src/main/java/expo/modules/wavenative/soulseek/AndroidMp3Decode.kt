package expo.modules.wavenative.soulseek

import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import java.io.File
import kotlin.math.abs

/** Decode the actual received payload before publication; valid headers alone don't prove playable audio. */
object AndroidMp3Decode {
  fun validate(file: File, verified: VerifiedMp3, isCancelled: () -> Boolean = { false }) {
    val extractor = MediaExtractor()
    var decoder: MediaCodec? = null
    try {
      extractor.setDataSource(file.path)
      val track = (0 until extractor.trackCount).firstOrNull {
        extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME) == "audio/mpeg"
      } ?: invalid()
      val format = extractor.getTrackFormat(track)
      extractor.selectTrack(track)
      val codec = MediaCodec.createDecoderByType("audio/mpeg")
      decoder = codec
      codec.configure(format, null, null, 0)
      codec.start()
      val info = MediaCodec.BufferInfo()
      var inputEnded = false
      var outputEnded = false
      var decodedMs = 0.0
      var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
      var sampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
      var bytesPerSample = 2
      val deadline = System.nanoTime() + 120_000_000_000L
      while (!outputEnded) {
        if (isCancelled()) throw SoulseekException(SoulseekFailure.CANCELLED)
        if (Thread.currentThread().isInterrupted || System.nanoTime() > deadline) invalid()
        if (!inputEnded) {
          val input = codec.dequeueInputBuffer(10_000)
          if (input >= 0) {
            val buffer = codec.getInputBuffer(input) ?: invalid()
            val count = extractor.readSampleData(buffer, 0)
            if (count < 0) {
              codec.queueInputBuffer(input, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
              inputEnded = true
            } else {
              codec.queueInputBuffer(input, 0, count, extractor.sampleTime, 0)
              extractor.advance()
            }
          }
        }
        when (val output = codec.dequeueOutputBuffer(info, 10_000)) {
          MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
            val pcm = codec.outputFormat
            channels = pcm.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            sampleRate = pcm.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            bytesPerSample = if (pcm.containsKey(MediaFormat.KEY_PCM_ENCODING) && pcm.getInteger(MediaFormat.KEY_PCM_ENCODING) == AudioFormat.ENCODING_PCM_FLOAT) 4 else 2
          }
          MediaCodec.INFO_TRY_AGAIN_LATER -> Unit
          else -> if (output >= 0) {
            if (channels <= 0 || sampleRate != verified.sampleRate) invalid()
            decodedMs += info.size * 1000.0 / (channels * bytesPerSample * sampleRate)
            outputEnded = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
            codec.releaseOutputBuffer(output, false)
          }
        }
      }
      if (decodedMs <= 0 || abs(decodedMs - verified.durationMs) > maxOf(2000.0, verified.durationMs * 0.02)) invalid()
    } catch (e: SoulseekException) { throw e }
    catch (e: Exception) { throw SoulseekException(SoulseekFailure.INVALID_AUDIO, cause = e) }
    finally {
      decoder?.let { runCatching { it.stop() }; it.release() }
      extractor.release()
    }
  }

  private fun invalid(): Nothing = throw SoulseekException(SoulseekFailure.INVALID_AUDIO)
}
