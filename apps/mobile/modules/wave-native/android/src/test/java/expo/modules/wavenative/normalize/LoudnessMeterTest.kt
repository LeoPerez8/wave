package expo.modules.wavenative.normalize

import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The meter against EBU Tech 3341's reference signals, generated here: 1 kHz sines whose peak
 * amplitude is the level given in dBFS, at 48 kHz. Each must read its integrated loudness
 * within ±0.1 LU, as the document's minimum requirements say.
 */
class LoudnessMeterTest {
  /** One stretch of a test signal: [seconds] of a 1 kHz sine, each channel's peak at its level (dBFS). */
  private class Segment(val seconds: Double, vararg val dbfs: Double)

  private fun amplitude(dbfs: Double) = 10.0.pow(dbfs / 20)

  /** [segments] as interleaved float PCM, one sine running through them. */
  private fun floatPcm(rate: Int, channels: Int, vararg segments: Segment): ByteBuffer {
    val frames = segments.sumOf { (it.seconds * rate).roundToInt() }
    val pcm = ByteBuffer.allocate(frames * channels * 4).order(ByteOrder.LITTLE_ENDIAN)
    var frame = 0
    for (segment in segments) {
      repeat((segment.seconds * rate).roundToInt()) {
        val wave = sin(2 * PI * 1_000 * frame / rate)
        for (channel in 0 until channels) pcm.putFloat((wave * amplitude(segment.dbfs[channel])).toFloat())
        frame++
      }
    }
    pcm.flip()
    return pcm
  }

  private fun measure(rate: Int, channels: Int, vararg segments: Segment): LoudnessMeter.Result? {
    val meter = LoudnessMeter(rate, channels)
    meter.add(floatPcm(rate, channels, *segments), PcmEncoding.FLOAT)
    return meter.result()
  }

  private fun stereo(seconds: Double, dbfs: Double) = Segment(seconds, dbfs, dbfs)

  private fun assertLoudness(expected: Double, result: LoudnessMeter.Result?) {
    assertEquals(expected, result?.integratedLufs ?: Double.NaN, 0.1)
  }

  @Test
  fun case1AStereoSineAtMinus23DbfsReadsMinus23Lufs() {
    val result = measure(48_000, 2, stereo(20.0, -23.0))
    assertLoudness(-23.0, result)
    assertEquals(amplitude(-23.0), result!!.samplePeak, 1e-6)
  }

  @Test
  fun case2AStereoSineAtMinus33DbfsReadsMinus33Lufs() {
    assertLoudness(-33.0, measure(48_000, 2, stereo(20.0, -33.0)))
  }

  @Test
  fun case3TheRelativeGateLeavesOutTheQuietStretches() {
    assertLoudness(-23.0, measure(48_000, 2, stereo(10.0, -36.0), stereo(60.0, -23.0), stereo(10.0, -36.0)))
  }

  @Test
  fun case4TheAbsoluteGateLeavesOutNearSilence() {
    assertLoudness(
      -23.0,
      measure(
        48_000,
        2,
        stereo(10.0, -72.0),
        stereo(10.0, -36.0),
        stereo(60.0, -23.0),
        stereo(10.0, -36.0),
        stereo(10.0, -72.0),
      ),
    )
  }

  @Test
  fun case5LoudAndQuietStretchesAverageByEnergy() {
    assertLoudness(-23.0, measure(48_000, 2, stereo(20.0, -26.0), stereo(20.1, -20.0), stereo(20.0, -26.0)))
  }

  @Test
  fun case6FiveChannelsWeighTheSurroundsByTheirGain() {
    // Android's five-channel order: front left, front right, centre, back left, back right.
    assertLoudness(-23.0, measure(48_000, 5, Segment(20.0, -28.0, -28.0, -24.0, -30.0, -30.0)))
  }

  @Test
  fun theWeightingFollowsTheFilesSampleRate() {
    assertLoudness(-23.0, measure(44_100, 2, stereo(20.0, -23.0)))
    assertLoudness(-23.0, measure(96_000, 2, stereo(20.0, -23.0)))
  }

  @Test
  fun aMonoFileCountsItsOneChannel() {
    // One channel carries half a stereo pair's energy: 3 dB less.
    assertLoudness(-26.0, measure(48_000, 1, Segment(20.0, -23.0)))
  }

  @Test
  fun sixteenBitPcmReadsAsFloatDoes() {
    val rate = 48_000
    val pcm = ByteBuffer.allocate(20 * rate * 2 * 2).order(ByteOrder.LITTLE_ENDIAN)
    for (frame in 0 until 20 * rate) {
      val sample = (sin(2 * PI * 1_000 * frame / rate) * amplitude(-23.0) * 32_767).roundToInt().toShort()
      pcm.putShort(sample).putShort(sample)
    }
    pcm.flip()
    val meter = LoudnessMeter(rate, 2)
    meter.add(pcm, PcmEncoding.PCM_16BIT)
    val result = meter.result()
    assertLoudness(-23.0, result)
    assertEquals(amplitude(-23.0), result!!.samplePeak, 1e-4)
  }

  @Test
  fun twentyFourAndThirtyTwoBitPcmReadAsFloatDoes() {
    val rate = 48_000
    for (encoding in listOf(PcmEncoding.PCM_24BIT, PcmEncoding.PCM_32BIT)) {
      val bytes = if (encoding == PcmEncoding.PCM_24BIT) 3 else 4
      val pcm = ByteBuffer.allocate(20 * rate * 2 * bytes).order(ByteOrder.LITTLE_ENDIAN)
      for (frame in 0 until 20 * rate) {
        val wave = sin(2 * PI * 1_000 * frame / rate) * amplitude(-23.0)
        repeat(2) {
          if (bytes == 3) {
            val value = (wave * 8_388_607).roundToInt()
            pcm.put(value.toByte()).put((value shr 8).toByte()).put((value shr 16).toByte())
          } else {
            pcm.putInt((wave * Int.MAX_VALUE).roundToInt())
          }
        }
      }
      pcm.flip()
      val meter = LoudnessMeter(rate, 2)
      meter.add(pcm, encoding)
      val result = meter.result()
      assertLoudness(-23.0, result)
      assertEquals(amplitude(-23.0), result!!.samplePeak, 1e-5)
    }
  }

  @Test
  fun pcmArrivingInBuffersOfAnySizeReadsTheSame() {
    val whole = floatPcm(48_000, 2, stereo(20.0, -23.0))
    val meter = LoudnessMeter(48_000, 2)
    var at = 0
    while (at < whole.limit()) {
      // Decoders hand out buffers of their own sizes, each of whole frames.
      val size = minOf(4_104, whole.limit() - at)
      val part = whole.duplicate().order(ByteOrder.LITTLE_ENDIAN)
      part.position(at)
      part.limit(at + size)
      meter.add(part, PcmEncoding.FLOAT)
      at += size
    }
    assertLoudness(-23.0, meter.result())
  }

  @Test
  fun silenceAndNothingAtAllHaveNoLoudness() {
    assertNull(measure(48_000, 2, stereo(10.0, -90.0)))
    assertNull(LoudnessMeter(48_000, 2).result())
  }

  @Test
  fun theLoudestSampleIsThePeakWhateverItsChannel() {
    val result = measure(48_000, 2, Segment(5.0, -20.0, -6.0))
    assertEquals(amplitude(-6.0), result!!.samplePeak, 1e-6)
  }
}
