package expo.modules.wavenative.recognize

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Base64
import java.util.zip.CRC32

/**
 * What Shazam is sent for a stretch of audio: the encoded signature as a data URI and
 * how long the audio was, in whole milliseconds.
 */
data class ShazamSignature(val uri: String, val sampleMs: Int)

/**
 * Turns 16 kHz mono PCM into a Shazam signature: Kotlin's port of shazamio-core 2.0.0's
 * `SignatureGenerator` (itself SongRec's), giving the same bytes for the same samples.
 *
 * Audio is [append]ed as it is captured, and [signature] encodes everything heard so
 * far, so a session can send a longer signature at each step without starting over.
 * Not thread-safe: one capture thread appends and asks for signatures.
 */
class SignatureGenerator {
  private val ring = ShortArray(WINDOW)
  private var ringIndex = 0
  private val windowed = FloatArray(WINDOW)
  private val fft = RealFft2048()
  private val fftRe = FloatArray(BINS)
  private val fftIm = FloatArray(BINS)
  private val fftOutputs = Array(HISTORY) { FloatArray(BINS) }
  private var fftOutputsIndex = 0
  private val spreadOutputs = Array(HISTORY) { FloatArray(BINS) }
  private var spreadOutputsIndex = 0
  private val spreadCopy = FloatArray(BINS)
  private var spreadFftsDone = 0
  private val pending = ShortArray(CHUNK)
  private var pendingCount = 0
  private var samples = 0L
  /** Peaks per band (index 0 to 3), each as (FFT pass, magnitude, corrected bin) triples. */
  private val peaks = Array(4) { IntList() }

  /** How many samples have been appended. */
  val sampleCount: Long get() = samples

  /** Takes the next [length] samples of [source], from [offset]. */
  fun append(source: ShortArray, offset: Int = 0, length: Int = source.size - offset) {
    require(offset >= 0 && length >= 0 && offset + length <= source.size)
    samples += length
    var position = offset
    val end = offset + length
    while (position < end) {
      val taken = minOf(CHUNK - pendingCount, end - position)
      source.copyInto(pending, pendingCount, position, position + taken)
      pendingCount += taken
      position += taken
      if (pendingCount == CHUNK) {
        process(pending)
        pendingCount = 0
      }
    }
  }

  /**
   * The signature of every sample appended so far. A last part shorter than 128
   * samples counts in the length but not in the peaks, as in shazamio-core.
   */
  fun signature(): ShazamSignature {
    check(samples <= MAX_SAMPLES) { "Too much audio for one signature" }
    val sampleMs = (samples.toFloat() / SAMPLE_RATE.toFloat() * 1000f).toInt()
    return ShazamSignature(DATA_URI_PREFIX + Base64.getEncoder().encodeToString(encode()), sampleMs)
  }

  private fun process(chunk: ShortArray) {
    doFft(chunk)
    doPeakSpreading()
    spreadFftsDone++
    if (spreadFftsDone >= 46) doPeakRecognition()
  }

  private fun doFft(chunk: ShortArray) {
    chunk.copyInto(ring, ringIndex)
    ringIndex = (ringIndex + CHUNK) and (WINDOW - 1)
    for (index in 0 until WINDOW)
      windowed[index] = ring[(index + ringIndex) and (WINDOW - 1)].toFloat() * HANNING_WINDOW_2048[index]
    fft.forward(windowed, fftRe, fftIm)
    val output = fftOutputs[fftOutputsIndex]
    for (index in 0 until BINS) {
      val re = fftRe[index]
      val im = fftIm[index]
      output[index] = maxOf((re * re + im * im) / (1 shl 17).toFloat(), MIN_POWER)
    }
    fftOutputsIndex = (fftOutputsIndex + 1) and (HISTORY - 1)
  }

  private fun doPeakSpreading() {
    val real = fftOutputs[(fftOutputsIndex - 1) and (HISTORY - 1)]
    val spread = spreadOutputs[spreadOutputsIndex]
    real.copyInto(spread)
    for (position in 0..1022)
      spread[position] = maxOf(maxOf(spread[position], spread[position + 1]), spread[position + 2])
    spread.copyInto(spreadCopy)
    for (position in 0 until BINS) {
      for (former in FORMER_FFTS) {
        val formerOutput = spreadOutputs[(spreadOutputsIndex - former) and (HISTORY - 1)]
        formerOutput[position] = maxOf(formerOutput[position], spreadCopy[position])
      }
    }
    spreadOutputsIndex = (spreadOutputsIndex + 1) and (HISTORY - 1)
  }

  private fun doPeakRecognition() {
    val fftMinus46 = fftOutputs[(fftOutputsIndex - 46) and (HISTORY - 1)]
    val fftMinus49 = spreadOutputs[(spreadOutputsIndex - 49) and (HISTORY - 1)]
    for (bin in 10..1014) {
      val value = fftMinus46[bin]
      if (value < 1f / 64f || value < fftMinus49[bin - 1]) continue
      var maxNeighbor = 0f
      for (offset in FREQUENCY_NEIGHBORS) maxNeighbor = maxOf(maxNeighbor, fftMinus49[bin + offset])
      if (value <= maxNeighbor) continue
      var maxOther = maxNeighbor
      for (offset in TIME_NEIGHBORS) {
        val other = spreadOutputs[(spreadOutputsIndex + offset) and (HISTORY - 1)]
        maxOther = maxOf(maxOther, other[bin - 1])
      }
      if (value <= maxOther) continue

      val pass = spreadFftsDone - 46
      val magnitude = magnitude(value)
      val before = magnitude(fftMinus46[bin - 1])
      val after = magnitude(fftMinus46[bin + 1])
      val variation1 = magnitude * 2f - before - after
      val variation2 = (after - before) * 32f / variation1
      val correctedBin = (bin * 64 + variation2.toInt()) and 0xFFFF
      val frequencyHz = (correctedBin.toFloat() * (16000f / 2f / 1024f / 64f)).toInt()
      val band = when (frequencyHz) {
        in 250..519 -> 0
        in 520..1449 -> 1
        in 1450..3499 -> 2
        in 3500..5500 -> 3
        else -> continue
      }
      peaks[band].add(pass, magnitude.toInt() and 0xFFFF, correctedBin)
    }
  }

  private fun encode(): ByteArray {
    val body = ByteArrayOutputStream()
    for ((band, list) in peaks.withIndex()) {
      if (list.size == 0) continue
      val bandPeaks = ByteArrayOutputStream()
      var pass = 0
      for (index in 0 until list.size / 3) {
        val peakPass = list[index * 3]
        if (peakPass - pass >= 255) {
          bandPeaks.write(0xFF)
          bandPeaks.writeInt32(peakPass)
          pass = peakPass
        }
        bandPeaks.write(peakPass - pass)
        bandPeaks.writeInt16(list[index * 3 + 1])
        bandPeaks.writeInt16(list[index * 3 + 2])
        pass = peakPass
      }
      body.writeInt32(0x60030040 + band)
      body.writeInt32(bandPeaks.size())
      bandPeaks.writeTo(body)
      repeat((4 - bandPeaks.size() % 4) % 4) { body.write(0) }
    }

    val size = HEADER + body.size()
    val buffer = ByteBuffer.allocate(size).order(ByteOrder.LITTLE_ENDIAN)
    buffer.putInt(0xCAFE2580.toInt())
    buffer.putInt(0) // the CRC-32, written last
    buffer.putInt(size - 48)
    buffer.putInt(0x94119C00.toInt())
    buffer.putInt(0).putInt(0).putInt(0)
    buffer.putInt(3 shl 27) // 16 kHz
    buffer.putInt(0).putInt(0)
    buffer.putInt((samples + (SAMPLE_RATE.toFloat() * 0.24f).toInt()).toInt())
    buffer.putInt((15 shl 19) + 0x40000)
    buffer.putInt(0x40000000)
    buffer.putInt(size - 48)
    buffer.put(body.toByteArray())
    val bytes = buffer.array()
    val crc = CRC32().apply { update(bytes, 8, bytes.size - 8) }.value
    ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).putInt(4, crc.toInt())
    return bytes
  }

  private class IntList {
    private var values = IntArray(96)
    var size = 0
      private set

    operator fun get(index: Int) = values[index]

    fun add(a: Int, b: Int, c: Int) {
      if (size + 3 > values.size) values = values.copyOf(values.size * 2)
      values[size++] = a
      values[size++] = b
      values[size++] = c
    }
  }

  private companion object {
    const val SAMPLE_RATE = 16_000
    const val WINDOW = 2048
    const val BINS = 1025
    const val CHUNK = 128
    const val HISTORY = 256
    const val MIN_POWER = 0.0000000001f
    // The 48-byte header, then the body's own marker and length.
    const val HEADER = 56
    // The header holds the sample count plus 240 ms as a u32.
    const val MAX_SAMPLES = 0xFFFF_FFFFL - 3840
    const val DATA_URI_PREFIX = "data:audio/vnd.shazam.sig;base64,"
    val FORMER_FFTS = intArrayOf(1, 3, 6)
    val FREQUENCY_NEIGHBORS = intArrayOf(-10, -7, -4, -3, 1, 2, 5, 8)
    val TIME_NEIGHBORS = intArrayOf(-53, -45, 165, 172, 179, 186, 193, 200, 214, 221, 228, 235, 242, 249)

    /** A bin's power as the signature stores it: its log, scaled into a u16's range. */
    fun magnitude(value: Float): Float =
      maxOf(StrictMath.log(value.toDouble()).toFloat(), 1f / 64f) * 1477.3f + 6144f

    fun ByteArrayOutputStream.writeInt16(value: Int) {
      write(value and 0xFF)
      write((value ushr 8) and 0xFF)
    }

    fun ByteArrayOutputStream.writeInt32(value: Int) {
      writeInt16(value and 0xFFFF)
      writeInt16(value ushr 16)
    }
  }
}
