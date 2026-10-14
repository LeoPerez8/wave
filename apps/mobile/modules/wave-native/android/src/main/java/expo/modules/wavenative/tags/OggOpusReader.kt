package expo.modules.wavenative.tags

import java.io.ByteArrayOutputStream
import java.io.EOFException
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.RandomAccessFile
import java.util.Base64
import kotlin.math.roundToLong

/**
 * Reads Vorbis comments, embedded cover and duration from Ogg Opus files
 * (`.opus`, or `.ogg` holding Opus), which jaudiotagger doesn't support.
 *
 * Format references: RFC 7845 (Ogg Opus), RFC 3533 (Ogg pages) and the FLAC
 * picture block used by METADATA_BLOCK_PICTURE.
 */
class OggOpusReader : TagReader {
  override fun read(file: File): RawTags {
    val (head, tags) = file.inputStream().buffered().use { input ->
      val packets = OggPacketReader(input)
      val head = packets.next() ?: throw IOException("Empty Ogg stream")
      if (!head.startsWith(OPUS_HEAD)) throw IOException("Not an Opus stream")
      val tags = packets.next() ?: throw IOException("Missing OpusTags packet")
      if (!tags.startsWith(OPUS_TAGS)) throw IOException("Missing OpusTags packet")
      head to tags
    }
    val preSkip = (head[10].toInt() and 0xff) or ((head[11].toInt() and 0xff) shl 8)
    val comments = parseComments(tags, OPUS_TAGS.size)
    val lastGranule = lastGranulePosition(file)
    val durationMs =
      if (lastGranule != null && lastGranule > preSkip) {
        ((lastGranule - preSkip) * 1000.0 / OPUS_SAMPLE_RATE).roundToLong()
      } else {
        0L
      }
    return comments.toRawTags(durationMs = durationMs, sampleRate = OPUS_SAMPLE_RATE)
  }

  /** Finds the granule position of the last page, which counts 48 kHz samples. */
  private fun lastGranulePosition(file: File): Long? =
    RandomAccessFile(file, "r").use { raf ->
      val length = raf.length()
      var windowEnd = length
      // Search backwards in windows; the last page is normally within the final few KB.
      while (windowEnd > 0) {
        val windowStart = maxOf(0L, windowEnd - TAIL_WINDOW)
        val buffer = ByteArray((windowEnd - windowStart).toInt())
        raf.seek(windowStart)
        raf.readFully(buffer)
        for (i in buffer.size - PAGE_HEADER_SIZE downTo 0) {
          // Capture pattern + stream structure version 0.
          if (buffer.matchesAt(i, CAPTURE_PATTERN) && buffer[i + 4].toInt() == 0) {
            val granule = buffer.readLongLE(i + 6)
            if (granule != -1L) return granule
          }
        }
        if (windowStart == 0L) break
        // Overlap so a header split across windows is still found.
        windowEnd = windowStart + PAGE_HEADER_SIZE
      }
      null
    }

  companion object {
    const val OPUS_SAMPLE_RATE = 48_000
    private const val PAGE_HEADER_SIZE = 27
    private const val TAIL_WINDOW = 64 * 1024L
    private val CAPTURE_PATTERN = "OggS".toByteArray(Charsets.US_ASCII)
    private val OPUS_HEAD = "OpusHead".toByteArray(Charsets.US_ASCII)
    private val OPUS_TAGS = "OpusTags".toByteArray(Charsets.US_ASCII)

    /** True when the file is an Ogg stream whose first packet is an Opus header. */
    fun isOpus(file: File): Boolean =
      try {
        file.inputStream().buffered().use { input ->
          OggPacketReader(input).next()?.startsWith(OPUS_HEAD) == true
        }
      } catch (e: IOException) {
        false
      }

    /** Parses a Vorbis comment block (vendor string + `KEY=value` list) starting at [offset]. */
    internal fun parseComments(packet: ByteArray, offset: Int): Map<String, List<String>> {
      var position = offset
      fun readLength(): Int {
        if (position + 4 > packet.size) throw IOException("Truncated comment block")
        val value = packet.readIntLE(position)
        position += 4
        if (value < 0 || value > packet.size - position) throw IOException("Bad comment length")
        return value
      }
      val vendorLength = readLength()
      position += vendorLength // skip the vendor string
      val count = readLength().coerceAtMost(packet.size)
      val comments = LinkedHashMap<String, MutableList<String>>()
      repeat(count) {
        val length = readLength()
        val entry = String(packet, position, length, Charsets.UTF_8)
        position += length
        val separator = entry.indexOf('=')
        if (separator > 0) {
          comments
            .getOrPut(entry.substring(0, separator).uppercase()) { mutableListOf() }
            .add(entry.substring(separator + 1))
        }
      }
      return comments
    }

    /** Maps Vorbis comment fields (as used by Opus, Vorbis and FLAC) to tags. */
    internal fun Map<String, List<String>>.toRawTags(durationMs: Long, sampleRate: Int?): RawTags {
      fun first(vararg keys: String): String? =
        keys.firstNotNullOfOrNull { key -> this[key]?.firstNotNullOfOrNull { it.cleanTag() } }
      fun all(vararg keys: String): List<String> =
        keys.firstNotNullOfOrNull { key ->
          this[key]?.mapNotNull { it.cleanTag() }?.takeIf { it.isNotEmpty() }
        } ?: emptyList()
      return RawTags(
        title = first("TITLE"),
        artist = first("ARTIST"),
        album = first("ALBUM"),
        albumArtist = first("ALBUMARTIST", "ALBUM ARTIST", "ALBUM_ARTIST"),
        genre = first("GENRE"),
        year = first("DATE", "YEAR", "ORIGINALDATE"),
        trackNumber = numberOf(first("TRACKNUMBER"), first("TRACKTOTAL", "TOTALTRACKS")),
        discNumber = numberOf(first("DISCNUMBER"), first("DISCTOTAL", "TOTALDISCS")),
        compilation = isTruthyFlag(first("COMPILATION")),
        durationMs = durationMs,
        sampleRate = sampleRate,
        artwork = this["METADATA_BLOCK_PICTURE"]?.let(::pickPicture),
        lyrics = first("LYRICS", "UNSYNCEDLYRICS", "UNSYNCED LYRICS"),
        artists = all("ARTIST"),
        albumArtists = all("ALBUMARTIST", "ALBUM ARTIST", "ALBUM_ARTIST"),
      )
    }

    /** Decodes base64 FLAC picture blocks and returns the front cover, or the first picture. */
    private fun pickPicture(blocks: List<String>): ByteArray? {
      val pictures = blocks.mapNotNull { encoded ->
        try {
          parsePictureBlock(Base64.getDecoder().decode(encoded.trim()))
        } catch (e: IllegalArgumentException) {
          null
        } catch (e: IOException) {
          null
        }
      }
      return (pictures.firstOrNull { it.first == FRONT_COVER } ?: pictures.firstOrNull())?.second
    }

    private const val FRONT_COVER = 3

    /** Returns (picture type, image bytes) from a FLAC METADATA_BLOCK_PICTURE body. */
    private fun parsePictureBlock(block: ByteArray): Pair<Int, ByteArray> {
      var position = 0
      fun readInt(): Int {
        if (position + 4 > block.size) throw IOException("Truncated picture block")
        val value = block.readIntBE(position)
        position += 4
        return value
      }
      fun skip(length: Int) {
        if (length < 0 || position + length > block.size) throw IOException("Bad picture block")
        position += length
      }
      val type = readInt()
      skip(readInt()) // MIME type
      skip(readInt()) // description
      skip(16) // width, height, depth, colours
      val length = readInt()
      if (length <= 0 || position + length > block.size) throw IOException("Bad picture data")
      return type to block.copyOfRange(position, position + length)
    }
  }
}

/**
 * Reassembles packets from the first logical stream of an Ogg file. Pages from
 * other streams (chained or multiplexed) are skipped.
 */
internal class OggPacketReader(private val input: InputStream) {
  private var serial: Int? = null
  private val pending = ArrayDeque<ByteArray>()
  private var partial = ByteArrayOutputStream()

  fun next(): ByteArray? {
    while (pending.isEmpty()) {
      if (!readPage()) return null
    }
    return pending.removeFirst()
  }

  private fun readPage(): Boolean {
    val header = ByteArray(27)
    val read = input.readNBytesCompat(header)
    if (read == 0) return false
    if (read < header.size) throw EOFException("Truncated Ogg page")
    if (!header.matchesAt(0, "OggS".toByteArray(Charsets.US_ASCII))) {
      throw IOException("Lost Ogg page sync")
    }
    val pageSerial = header.readIntLE(14)
    val segmentCount = header[26].toInt() and 0xff
    val lacing = ByteArray(segmentCount)
    if (input.readNBytesCompat(lacing) < segmentCount) throw EOFException("Truncated Ogg page")
    val ours = serial == null || serial == pageSerial
    if (serial == null) serial = pageSerial
    for (lace in lacing) {
      val size = lace.toInt() and 0xff
      val segment = ByteArray(size)
      if (input.readNBytesCompat(segment) < size) throw EOFException("Truncated Ogg page")
      if (!ours) continue
      partial.write(segment)
      if (partial.size() > MAX_PACKET_SIZE) throw IOException("Ogg packet too large")
      if (size < 255) {
        pending.addLast(partial.toByteArray())
        partial = ByteArrayOutputStream()
      }
    }
    return true
  }

  private companion object {
    // Comment packets carry embedded pictures; anything larger is not a sane tag block.
    const val MAX_PACKET_SIZE = 32 * 1024 * 1024
  }
}

private fun InputStream.readNBytesCompat(buffer: ByteArray): Int {
  var total = 0
  while (total < buffer.size) {
    val n = read(buffer, total, buffer.size - total)
    if (n < 0) break
    total += n
  }
  return total
}

private fun ByteArray.startsWith(prefix: ByteArray): Boolean = matchesAt(0, prefix)

private fun ByteArray.matchesAt(offset: Int, pattern: ByteArray): Boolean {
  if (offset < 0 || offset + pattern.size > size) return false
  for (i in pattern.indices) if (this[offset + i] != pattern[i]) return false
  return true
}

private fun ByteArray.readIntLE(offset: Int): Int =
  (this[offset].toInt() and 0xff) or
    ((this[offset + 1].toInt() and 0xff) shl 8) or
    ((this[offset + 2].toInt() and 0xff) shl 16) or
    ((this[offset + 3].toInt() and 0xff) shl 24)

private fun ByteArray.readIntBE(offset: Int): Int =
  ((this[offset].toInt() and 0xff) shl 24) or
    ((this[offset + 1].toInt() and 0xff) shl 16) or
    ((this[offset + 2].toInt() and 0xff) shl 8) or
    (this[offset + 3].toInt() and 0xff)

private fun ByteArray.readLongLE(offset: Int): Long =
  (readIntLE(offset).toLong() and 0xffffffffL) or (readIntLE(offset + 4).toLong() shl 32)
