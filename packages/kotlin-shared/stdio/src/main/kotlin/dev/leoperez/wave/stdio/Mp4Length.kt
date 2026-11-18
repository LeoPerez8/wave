package dev.leoperez.wave.stdio

import expo.modules.wavenative.tags.JAudioTaggerReader
import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import java.util.concurrent.CancellationException

/**
 * How long a downloaded M4A plays, as the phone's extractor finds it (`AndroidAudioDuration`):
 * the time its last audio sample starts, in milliseconds. YouTube serves fragmented MP4, whose
 * samples are listed in each `moof`'s `trun`; their durations come from the `trun`, else the
 * `tfhd`'s default, else the `trex`'s, over the track's `mdhd` timescale. Walking every fragment
 * and checking its samples sit inside the file also proves the audio is there to its end, as the
 * phone's read through does. Throws [IOException] when it isn't, or has no samples; null for an
 * MP4 that isn't fragmented, whose length its header says ([of]).
 */
object Mp4Length {
  fun of(file: File, isCancelled: () -> Boolean = { false }): Long =
    lastSampleMs(file, isCancelled) ?: JAudioTaggerReader().read(file).durationMs.takeIf { it > 0 }
      ?: throw IOException("No audio samples")

  fun lastSampleMs(file: File, isCancelled: () -> Boolean = { false }): Long? =
    RandomAccessFile(file, "r").use { input ->
      val length = input.length()
      var timescale = 0L
      var trexDuration = 0L
      var startTicks = 0L
      var lastStart = -1L
      var offset = 0L
      var fragments = 0
      while (offset + 8 <= length) {
        if (isCancelled()) throw CancellationException("Download cancelled")
        val box = header(input, offset, length)
        when (box.type) {
          "moov" -> {
            val bytes = read(input, box)
            find(bytes, box.header, bytes.size, "trak", "mdia", "mdhd")?.let { timescale = mdhdTimescale(bytes, it) }
            find(bytes, box.header, bytes.size, "mvex", "trex")?.let { trexDuration = u32(bytes, it + 12 + 8) }
          }
          "moof" -> {
            fragments++
            if (timescale <= 0) throw IOException("No timescale before the fragments")
            val bytes = read(input, box)
            val traf = find(bytes, box.header, bytes.size, "traf") ?: throw IOException("A fragment without a track")
            val trafEnd = traf + u32(bytes, traf).toInt()
            var defaultDuration = trexDuration
            var dataBase = box.offset
            var at = traf + 8
            while (at + 8 <= trafEnd) {
              val size = u32(bytes, at).toInt()
              if (size < 8) throw IOException("A broken box in a fragment")
              when (String(bytes, at + 4, 4, Charsets.ISO_8859_1)) {
                "tfhd" -> {
                  val flags = u32(bytes, at + 8) and 0xFFFFFF
                  var field = at + 16
                  if (flags and 0x1L != 0L) { dataBase = u64(bytes, field); field += 8 }
                  if (flags and 0x2L != 0L) field += 4
                  if (flags and 0x8L != 0L) defaultDuration = u32(bytes, field)
                }
                "tfdt" -> {
                  val version = bytes[at + 8].toInt()
                  startTicks = if (version == 1) u64(bytes, at + 12) else u32(bytes, at + 12)
                }
                "trun" -> {
                  val flags = u32(bytes, at + 8) and 0xFFFFFF
                  val count = u32(bytes, at + 12)
                  var field = at + 16
                  var dataOffset = 0L
                  if (flags and 0x1L != 0L) { dataOffset = u32(bytes, field).toInt().toLong(); field += 4 }
                  if (flags and 0x4L != 0L) field += 4
                  var bytesInRun = 0L
                  for (sample in 0 until count) {
                    var duration = defaultDuration
                    if (flags and 0x100L != 0L) { duration = u32(bytes, field); field += 4 }
                    if (flags and 0x200L != 0L) { bytesInRun += u32(bytes, field); field += 4 }
                    if (flags and 0x400L != 0L) field += 4
                    if (flags and 0x800L != 0L) field += 4
                    lastStart = startTicks
                    startTicks += duration
                  }
                  if (dataBase + dataOffset + bytesInRun > length) throw IOException("The audio ends before its last sample")
                }
              }
              at += size
            }
          }
        }
        offset = box.offset + box.size
      }
      if (fragments == 0) return@use null
      if (lastStart < 0 || timescale <= 0) throw IOException("No audio samples")
      lastStart * 1000 / timescale
    }

  private class Box(val type: String, val offset: Long, val header: Int, val size: Long)

  private fun header(input: RandomAccessFile, offset: Long, length: Long): Box {
    input.seek(offset)
    var size = input.readInt().toLong() and 0xFFFFFFFFL
    val type = ByteArray(4).also(input::readFully).toString(Charsets.ISO_8859_1)
    var header = 8
    if (size == 1L) { size = input.readLong(); header = 16 }
    if (size == 0L) size = length - offset
    if (size < header || offset + size > length) throw IOException("A box runs past the file's end")
    return Box(type, offset, header, size)
  }

  private fun read(input: RandomAccessFile, box: Box): ByteArray {
    if (box.size > MAX_BOX) throw IOException("A ${box.type} box too big to read")
    input.seek(box.offset)
    return ByteArray(box.size.toInt()).also(input::readFully)
  }

  /** The offset of the box at [path] inside the boxes from [from] to [to] of [bytes]. */
  private fun find(bytes: ByteArray, from: Int, to: Int, vararg path: String): Int? {
    var at = from
    while (at + 8 <= to) {
      val size = u32(bytes, at).toInt()
      if (size < 8 || at + size > to) return null
      if (String(bytes, at + 4, 4, Charsets.ISO_8859_1) == path[0]) {
        return if (path.size == 1) at else find(bytes, at + 8, at + size, *path.copyOfRange(1, path.size))
      }
      at += size
    }
    return null
  }

  private fun mdhdTimescale(bytes: ByteArray, at: Int): Long =
    if (bytes[at + 8].toInt() == 1) u32(bytes, at + 8 + 4 + 16) else u32(bytes, at + 8 + 4 + 8)

  private fun u32(bytes: ByteArray, at: Int): Long =
    ((bytes[at].toLong() and 0xFF) shl 24) or ((bytes[at + 1].toLong() and 0xFF) shl 16) or
      ((bytes[at + 2].toLong() and 0xFF) shl 8) or (bytes[at + 3].toLong() and 0xFF)

  private fun u64(bytes: ByteArray, at: Int): Long = (u32(bytes, at) shl 32) or u32(bytes, at + 4)

  /** No `moov` or `moof` of a song is near this; a bigger one isn't an M4A to trust. */
  private const val MAX_BOX = 64L shl 20
}
