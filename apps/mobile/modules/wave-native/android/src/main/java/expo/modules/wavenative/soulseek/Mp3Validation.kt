package expo.modules.wavenative.soulseek

import java.io.File
import java.io.RandomAccessFile
import kotlin.math.abs
import kotlin.math.roundToLong

data class VerifiedMp3(val bytes: Long, val durationMs: Long, val sampleRate: Int, val frames: Long) {
  val bitrate: Int get() = 320_000
  val mimeType: String get() = "audio/mpeg"
  fun toMap(): Map<String, Any> = mapOf(
    "bytes" to bytes.toDouble(), "durationMs" to durationMs.toDouble(), "bitrate" to bitrate,
    "mimeType" to mimeType, "sampleRate" to sampleRate,
    // MPEG headers prove the received encoding, never the source's recording provenance.
    "provenance" to "unknown",
  )
}

/** Reads every MPEG frame. Extension, ID3 labels and peer quality claims aren't used as proof. */
object Mp3Validation {
  fun validate(file: File, expectedBytes: Long, expectedDurationMs: Long): VerifiedMp3 {
    if (expectedBytes <= 0 || file.length() != expectedBytes) invalid("Incomplete transfer")
    RandomAccessFile(file, "r").use { audio ->
      var start = 0L
      var end = audio.length()
      if (end >= 10) {
        val header = ByteArray(10)
        audio.readFully(header)
        if (String(header, 0, 3, Charsets.US_ASCII) == "ID3") {
          if (header[3].toInt() !in 2..4 || header.sliceArray(6..9).any { it.toInt() and 0x80 != 0 }) {
            invalid("Invalid ID3 header")
          }
          val tagBytes = header.sliceArray(6..9).fold(0L) { value, byte -> (value shl 7) or byte.toLong() }
          if (tagBytes > 16 * 1024 * 1024) invalid("ID3 tag is too large")
          start = 10 + tagBytes + if (header[3].toInt() == 4 && header[5].toInt() and 0x10 != 0) 10 else 0
          if (start > end) invalid("Incomplete ID3 tag")
        }
      }
      if (end - start >= 128) {
        audio.seek(end - 128)
        if (audio.read() == 'T'.code && audio.read() == 'A'.code && audio.read() == 'G'.code) end -= 128
      }
      // APEv2 tags are valid on MP3, but their lengths must fit the received file.
      if (end - start >= 32) {
        audio.seek(end - 32)
        val footer = ByteArray(32)
        audio.readFully(footer)
        if (String(footer, 0, 8, Charsets.US_ASCII) == "APETAGEX") {
          val size = (12..15).foldIndexed(0L) { index, value, offset -> value or ((footer[offset].toLong() and 255) shl (index * 8)) }
          if (size < 32 || size > end - start) invalid("Invalid APE tag")
          end -= size
          if (end - start >= 32) {
            audio.seek(end - 32)
            val magic = ByteArray(8)
            audio.readFully(magic)
            if (String(magic, Charsets.US_ASCII) == "APETAGEX") end -= 32
          }
        }
      }
      var position = start
      var frames = 0L
      var sampleRate = 0
      while (position < end) {
        if (end - position < 4) invalid("Truncated MPEG frame")
        audio.seek(position)
        val header = audio.readInt()
        // MPEG-1 Layer III, non-free-format 320 kbps, valid sample rate.
        if (header ushr 21 != 0x7ff || (header ushr 19 and 3) != 3 || (header ushr 17 and 3) != 1) {
          invalid("The file is not a complete MPEG-1 Layer III recording")
        }
        if ((header ushr 12 and 15) != 14) invalid("The received MP3 is not 320 kbps")
        val rate = when (header ushr 10 and 3) {
          0 -> 44100
          1 -> 48000
          2 -> 32000
          else -> invalid("Invalid MPEG sample rate")
        }
        if (sampleRate != 0 && sampleRate != rate) invalid("MPEG sample rate changes inside the recording")
        sampleRate = rate
        val frameBytes = 144 * 320_000 / rate + (header ushr 9 and 1)
        if (position + frameBytes > end) invalid("Truncated MPEG frame")
        position += frameBytes
        frames++
      }
      if (frames < 2) invalid("No complete MP3 recording")
      val duration = (frames * 1152.0 * 1000 / sampleRate).roundToLong()
      if (expectedDurationMs <= 0 || abs(duration - expectedDurationMs) > maxOf(2000L, expectedDurationMs / 50)) {
        invalid("The received recording has a different duration")
      }
      return VerifiedMp3(file.length(), duration, sampleRate, frames)
    }
  }

  private fun invalid(message: String): Nothing = throw SoulseekException(SoulseekFailure.INVALID_AUDIO, message)
}
