package expo.modules.wavenative.normalize

import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.pow
import kotlin.math.tan

/** How decoded samples are laid out, little-endian and interleaved, as Android hands them over. */
enum class PcmEncoding(val bytes: Int) {
  PCM_8BIT(1),
  PCM_16BIT(2),
  PCM_24BIT(3),
  PCM_32BIT(4),
  FLOAT(4),
}

/**
 * Normalize Volume's meter: a song's integrated loudness by ITU-R BS.1770 (K-weighting, 400 ms
 * blocks overlapping by 75 %, an absolute gate at -70 LUFS and a relative one 10 LU under the
 * blocks above it) and its sample peak, from its decoded PCM as it streams by ([add]). Checked
 * against EBU Tech 3341's reference signals (`LoudnessMeterTest`). Pure Kotlin, for JVM tests;
 * [FileLoudness] feeds it a file's PCM.
 */
class LoudnessMeter(sampleRate: Int, private val channels: Int) {
  /** What the meter read: the integrated loudness in LUFS, and the sample peak on a 0–1 scale. */
  data class Result(val integratedLufs: Double, val samplePeak: Double)

  init {
    require(sampleRate > 0 && channels in 1..MAX_CHANNELS) { "Unsupported PCM: $sampleRate Hz, $channels channels" }
  }

  private val weights = channelWeights(channels)
  private val filters = Array(channels) { KWeighting(sampleRate) }

  /** A 100 ms step: four make a 400 ms block, and each step starts the next block. */
  private val stepFrames = max(1, sampleRate / 10)
  private var stepFramesSoFar = 0
  private var stepEnergy = 0.0
  private val lastSteps = DoubleArray(4)
  private var steps = 0

  /** The mean-square energy of every block above the absolute gate. */
  private var blocks = DoubleArray(1_024)
  private var blockCount = 0
  private var peak = 0.0

  /** Takes the whole frames of [pcm] from its position to its limit, without moving either. */
  fun add(pcm: ByteBuffer, encoding: PcmEncoding) {
    val buffer = pcm.duplicate().order(ByteOrder.LITTLE_ENDIAN)
    val frameBytes = encoding.bytes * channels
    val start = buffer.position()
    val end = start + (buffer.remaining() / frameBytes) * frameBytes
    var at = start
    while (at < end) {
      for (channel in 0 until channels) {
        val sample = sampleAt(buffer, at, encoding)
        at += encoding.bytes
        val magnitude = abs(sample)
        if (magnitude > peak) peak = magnitude
        val weighted = filters[channel].process(sample)
        stepEnergy += weights[channel] * weighted * weighted
      }
      if (++stepFramesSoFar == stepFrames) finishStep()
    }
  }

  /** The loudness and peak of everything added; null when nothing was above the absolute gate. */
  fun result(): Result? {
    if (blockCount == 0) return null
    val relativeGate = loudness(meanOf { true }) - RELATIVE_GATE_LU
    val gated = meanOf { loudness(it) > relativeGate }
    return Result(loudness(gated), peak.coerceAtMost(1.0))
  }

  private fun finishStep() {
    lastSteps[steps % 4] = stepEnergy
    steps++
    stepEnergy = 0.0
    stepFramesSoFar = 0
    if (steps < 4) return
    val block = lastSteps.sum() / (4.0 * stepFrames)
    if (loudness(block) > ABSOLUTE_GATE_LUFS) {
      if (blockCount == blocks.size) blocks = blocks.copyOf(blocks.size * 2)
      blocks[blockCount++] = block
    }
  }

  private inline fun meanOf(keep: (Double) -> Boolean): Double {
    var sum = 0.0
    var count = 0
    for (index in 0 until blockCount) {
      val block = blocks[index]
      if (keep(block)) {
        sum += block
        count++
      }
    }
    return sum / count
  }

  /**
   * BS.1770 K-weighting as two biquads, for any sample rate: a +4 dB shelf above about 1.7 kHz,
   * then the RLB high-pass at about 38 Hz. The design is libebur128's, which gives BS.1770's
   * own coefficients at 48 kHz.
   */
  private class KWeighting(sampleRate: Int) {
    private val shelf: Biquad
    private val highPass: Biquad

    init {
      var k = tan(PI * SHELF_HZ / sampleRate)
      val vh = 10.0.pow(SHELF_GAIN_DB / 20)
      val vb = vh.pow(SHELF_VB_EXPONENT)
      val a0 = 1 + k / SHELF_Q + k * k
      shelf = Biquad(
        b0 = (vh + vb * k / SHELF_Q + k * k) / a0,
        b1 = 2 * (k * k - vh) / a0,
        b2 = (vh - vb * k / SHELF_Q + k * k) / a0,
        a1 = 2 * (k * k - 1) / a0,
        a2 = (1 - k / SHELF_Q + k * k) / a0,
      )
      k = tan(PI * HIGH_PASS_HZ / sampleRate)
      val d = 1 + k / HIGH_PASS_Q + k * k
      highPass = Biquad(b0 = 1.0, b1 = -2.0, b2 = 1.0, a1 = 2 * (k * k - 1) / d, a2 = (1 - k / HIGH_PASS_Q + k * k) / d)
    }

    fun process(sample: Double): Double = highPass.process(shelf.process(sample))
  }

  private class Biquad(
    private val b0: Double,
    private val b1: Double,
    private val b2: Double,
    private val a1: Double,
    private val a2: Double,
  ) {
    private var x1 = 0.0
    private var x2 = 0.0
    private var y1 = 0.0
    private var y2 = 0.0

    fun process(x: Double): Double {
      val y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
      x2 = x1
      x1 = x
      y2 = y1
      y1 = y
      return y
    }
  }

  private companion object {
    const val MAX_CHANNELS = 8
    const val ABSOLUTE_GATE_LUFS = -70.0
    const val RELATIVE_GATE_LU = 10.0
    const val SHELF_HZ = 1681.974450955533
    const val SHELF_GAIN_DB = 3.999843853973347
    const val SHELF_Q = 0.7071752369554196
    const val SHELF_VB_EXPONENT = 0.4996667741545416
    const val HIGH_PASS_HZ = 38.13547087602444
    const val HIGH_PASS_Q = 0.5003270373238773
    const val SURROUND = 1.41

    /** A mean-square energy as BS.1770 loudness. */
    fun loudness(energy: Double): Double = -0.691 + 10 * log10(energy)

    /**
     * Each channel's BS.1770 weight in Android's channel order: front and centre 1, the
     * surrounds 1.41, the LFE (the fourth of 5.1 and up) left out.
     */
    fun channelWeights(channels: Int) = DoubleArray(channels) { channel ->
      when {
        channels <= 3 -> 1.0
        channels == 4 -> if (channel >= 2) SURROUND else 1.0
        channels == 5 -> if (channel >= 3) SURROUND else 1.0
        channel == 3 -> 0.0
        channel > 3 -> SURROUND
        else -> 1.0
      }
    }

    fun sampleAt(buffer: ByteBuffer, at: Int, encoding: PcmEncoding): Double = when (encoding) {
      PcmEncoding.PCM_8BIT -> ((buffer.get(at).toInt() and 0xff) - 128) / 128.0
      PcmEncoding.PCM_16BIT -> buffer.getShort(at) / 32_768.0
      PcmEncoding.PCM_24BIT -> {
        val value = (buffer.get(at).toInt() and 0xff) or
          ((buffer.get(at + 1).toInt() and 0xff) shl 8) or
          (buffer.get(at + 2).toInt() shl 16)
        value / 8_388_608.0
      }
      PcmEncoding.PCM_32BIT -> buffer.getInt(at) / 2_147_483_648.0
      PcmEncoding.FLOAT -> buffer.getFloat(at).toDouble()
    }
  }
}
