package expo.modules.wavenative.normalize

import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import kotlin.math.abs
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.pow
import java.nio.ByteOrder

/** A streaming BS.1770 meter. The decoder is the same Android MediaCodec path used by playback. */
object AudioLoudnessMeter {
  data class Result(val integratedLufs: Double, val samplePeak: Double)

  fun measure(path: String, isCancelled: () -> Boolean = { false }): Result {
    val extractor = MediaExtractor()
    var decoder: MediaCodec? = null
    try {
      extractor.setDataSource(path)
      val track = (0 until extractor.trackCount).firstOrNull {
        extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
      } ?: error("No audio track")
      val format = extractor.getTrackFormat(track)
      val mime = format.getString(MediaFormat.KEY_MIME) ?: error("Missing audio MIME")
      extractor.selectTrack(track)
      decoder = MediaCodec.createDecoderByType(mime)
      decoder.configure(format, null, null, 0)
      decoder.start()
      val info = MediaCodec.BufferInfo()
      var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
      var rate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
      var encoding = AudioFormat.ENCODING_PCM_16BIT
      var inputEnded = false
      var outputEnded = false
      var decoded = 0L
      var meter: Bs1770? = null
      val deadline = System.nanoTime() + 120_000_000_000L
      while (!outputEnded) {
        check(!isCancelled()) { "Measurement cancelled" }
        check(!Thread.currentThread().isInterrupted && System.nanoTime() < deadline) { "Decode deadline exceeded" }
        if (!inputEnded) {
          val input = decoder.dequeueInputBuffer(10_000)
          if (input >= 0) {
            val buffer = decoder.getInputBuffer(input) ?: error("No decoder input buffer")
            val size = extractor.readSampleData(buffer, 0)
            if (size < 0) {
              decoder.queueInputBuffer(input, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
              inputEnded = true
            } else {
              decoder.queueInputBuffer(input, 0, size, extractor.sampleTime, 0)
              extractor.advance()
            }
          }
        }
        when (val output = decoder.dequeueOutputBuffer(info, 10_000)) {
          MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
            val pcm = decoder.outputFormat
            channels = pcm.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            rate = pcm.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            encoding = if (pcm.containsKey(MediaFormat.KEY_PCM_ENCODING)) pcm.getInteger(MediaFormat.KEY_PCM_ENCODING) else AudioFormat.ENCODING_PCM_16BIT
            check(channels in 1..8 && rate > 0) { "Unsupported PCM format" }
            meter = Bs1770(rate, channels)
          }
          MediaCodec.INFO_TRY_AGAIN_LATER -> Unit
          else -> if (output >= 0) {
            if (info.size > 0) {
              val pcm = decoder.getOutputBuffer(output) ?: error("No decoder output buffer")
              val active = meter ?: Bs1770(rate, channels).also { meter = it }
              active.consume(pcm, info.offset, info.size, encoding)
              decoded += info.size
            }
            outputEnded = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
            decoder.releaseOutputBuffer(output, false)
          }
        }
      }
      check(decoded > 0) { "No decoded audio" }
      return (meter ?: error("No decoded audio")).result()
    } finally {
      decoder?.let { runCatching { it.stop() }; it.release() }
      extractor.release()
    }
  }

  internal class Bs1770(private val sampleRate: Int, private val channels: Int) {
    private val filters = Array(channels) { KFilter(sampleRate) }
    private val segmentFrames = max(1, sampleRate / 10)
    private val segmentEnergy = DoubleArray(channels)
    private var inSegment = 0
    private val segments = Array(channels) { ArrayDeque<Double>() }
    private val blockLoudness = ArrayList<Double>()
    private var peak = 0.0
    private var frames = 0L

    fun consume(buffer: java.nio.ByteBuffer, offset: Int, size: Int, encoding: Int) {
      val bytesPerSample = when (encoding) {
        AudioFormat.ENCODING_PCM_8BIT -> 1
        AudioFormat.ENCODING_PCM_16BIT -> 2
        AudioFormat.ENCODING_PCM_24BIT_PACKED -> 3
        AudioFormat.ENCODING_PCM_32BIT, AudioFormat.ENCODING_PCM_FLOAT -> 4
        else -> error("Unsupported decoded PCM encoding")
      }
      buffer.order(ByteOrder.LITTLE_ENDIAN)
      val frameBytes = bytesPerSample * channels
      val end = offset + size - size % frameBytes
      for (position in offset until end step frameBytes) {
        for (channel in 0 until channels) {
          val at = position + channel * bytesPerSample
          val sample = when (encoding) {
            AudioFormat.ENCODING_PCM_8BIT -> ((buffer.get(at).toInt() and 0xff) - 128) / 128.0
            AudioFormat.ENCODING_PCM_16BIT -> buffer.getShort(at).toDouble() / 32768.0
            AudioFormat.ENCODING_PCM_24BIT_PACKED -> {
              var value = (buffer.get(at).toInt() and 0xff) or ((buffer.get(at + 1).toInt() and 0xff) shl 8) or ((buffer.get(at + 2).toInt() and 0xff) shl 16)
              if (value and 0x800000 != 0) value = value or -0x1000000
              value / 8388608.0
            }
            AudioFormat.ENCODING_PCM_32BIT -> buffer.getInt(at).toDouble() / 2147483648.0
            AudioFormat.ENCODING_PCM_FLOAT -> buffer.getFloat(at).toDouble()
            else -> error("Unsupported decoded PCM encoding")
          }
          peak = max(peak, abs(sample))
          val weighted = filters[channel].process(sample)
          segmentEnergy[channel] += weighted * weighted
        }
        inSegment++
        frames++
        if (inSegment == segmentFrames) finishSegment()
      }
    }

    private fun finishSegment() {
      for (ch in 0 until channels) {
        segments[ch].addLast(segmentEnergy[ch] / inSegment)
        if (segments[ch].size > 4) segments[ch].removeFirst()
        segmentEnergy[ch] = 0.0
      }
      if (segments[0].size == 4) {
        val energy = segments.indices.sumOf { ch -> segments[ch].sum() / 4.0 * channelWeight(ch) }
        val lufs = -0.691 + 10 * log10(energy)
        if (lufs >= -70.0) blockLoudness.add(lufs)
      }
      inSegment = 0
    }

    fun result(): Result {
      check(frames > 0) { "No decoded audio" }
      val absolute = blockLoudness.filter { it >= -70.0 }
      check(absolute.isNotEmpty()) { "Audio below absolute gate" }
      val ungated = energyLufs(absolute)
      val relativeGate = ungated - 10.0
      val gated = absolute.filter { it >= relativeGate }
      val lufs = energyLufs(gated)
      check(lufs.isFinite() && peak > 0.0) { "Audio is silent or invalid" }
      return Result(lufs, peak.coerceAtMost(1.0))
    }

    private fun energyLufs(values: List<Double>): Double = -0.691 + 10 * log10(values.sumOf { 10.0.pow(it / 10.0) } / values.size)
    private fun channelWeight(channel: Int): Double = if (channels >= 5 && channel == 3) 0.0 else if (channels >= 5 && channel >= 4) 1.41 else 1.0
    private fun log10(value: Double): Double = ln(value) / ln(10.0)
  }

  /** BS.1770 K weighting: a 1682 Hz +4 dB shelf followed by the 38 Hz RLB high-pass. */
  private class KFilter(sampleRate: Int) {
    private val shelf = Biquad.highShelf(sampleRate, 1681.974450955533, 3.99984385397, 0.7071752369554196)
    private val highPass = Biquad.highPass(sampleRate, 38.13547087602444, 0.5003270373238773)
    fun process(input: Double) = highPass.process(shelf.process(input))
  }

  private class Biquad(b0: Double, b1: Double, b2: Double, a1: Double, a2: Double) {
    private val b0 = b0; private val b1 = b1; private val b2 = b2; private val a1 = a1; private val a2 = a2
    private var x1 = 0.0; private var x2 = 0.0; private var y1 = 0.0; private var y2 = 0.0
    fun process(x: Double): Double {
      val y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
      x2 = x1; x1 = x; y2 = y1; y1 = y
      return y
    }
    companion object {
      fun highPass(fs: Int, f: Double, q: Double): Biquad {
        val w = 2 * Math.PI * f / fs; val c = kotlin.math.cos(w); val a = kotlin.math.sin(w) / (2 * q)
        val a0 = 1 + a
        return Biquad((1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0, -2 * c / a0, (1 - a) / a0)
      }
      fun highShelf(fs: Int, f: Double, gain: Double, q: Double): Biquad {
        val a = 10.0.pow(gain / 40); val w = 2 * Math.PI * f / fs; val c = kotlin.math.cos(w); val s = kotlin.math.sin(w)
        val alpha = s / (2 * q); val root = 2 * kotlin.math.sqrt(a) * alpha
        val a0 = (a + 1) - (a - 1) * c + root
        return Biquad(a * ((a + 1) + (a - 1) * c + root) / a0,
          -2 * a * ((a - 1) + (a + 1) * c) / a0,
          a * ((a + 1) + (a - 1) * c - root) / a0,
          2 * ((a - 1) - (a + 1) * c) / a0,
          ((a + 1) - (a - 1) * c - root) / a0)
      }
    }
  }
}
