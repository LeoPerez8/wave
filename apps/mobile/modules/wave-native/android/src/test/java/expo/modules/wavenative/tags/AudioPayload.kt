package expo.modules.wavenative.tags

import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.jaudiotagger.audio.AudioFileIO
import org.jaudiotagger.tag.Tag
import org.jaudiotagger.tag.id3.AbstractID3v2Frame
import org.jaudiotagger.tag.wav.WavTag

/**
 * The audio of a file without its tags, parsed independently of jaudiotagger's
 * writer, so a test can tell the audio wasn't touched when the tags were.
 */
object AudioPayload {
  fun of(file: File): ByteArray {
    val bytes = file.readBytes()
    return when (file.extension.lowercase()) {
      "mp3" -> mp3(bytes)
      "flac" -> flac(bytes)
      "m4a" -> m4a(bytes)
      "ogg" -> ogg(file)
      "wav" -> wav(bytes)
      else -> bytes
    }
  }

  /** Everything after the ID3v2 tag (the MPEG frames), minus a trailing ID3v1 tag. */
  private fun mp3(bytes: ByteArray): ByteArray {
    var start = 0
    if (bytes.size >= 10 && String(bytes, 0, 3, Charsets.ISO_8859_1) == "ID3") {
      val size = (0 until 4).fold(0) { acc, i -> (acc shl 7) or (bytes[6 + i].toInt() and 0x7f) }
      val footer = if (bytes[5].toInt() and 0x10 != 0) 10 else 0
      start = 10 + size + footer
    }
    // Padding after the tag is part of it, not of the audio: skip to the first frame sync.
    while (start + 1 < bytes.size && !(bytes[start] == 0xFF.toByte() && bytes[start + 1].toInt() and 0xE0 == 0xE0)) {
      start += 1
    }
    var end = bytes.size
    if (end - 128 >= start && String(bytes, end - 128, 3, Charsets.ISO_8859_1) == "TAG") end -= 128
    return bytes.copyOfRange(start, end)
  }

  /** The frames after the last metadata block. */
  private fun flac(bytes: ByteArray): ByteArray {
    require(String(bytes, 0, 4, Charsets.ISO_8859_1) == "fLaC") { "Not a FLAC file" }
    var position = 4
    while (true) {
      val header = bytes[position].toInt() and 0xff
      val length =
        ((bytes[position + 1].toInt() and 0xff) shl 16) or
          ((bytes[position + 2].toInt() and 0xff) shl 8) or
          (bytes[position + 3].toInt() and 0xff)
      position += 4 + length
      if (header and 0x80 != 0) break
    }
    return bytes.copyOfRange(position, bytes.size)
  }

  /** The contents of the top-level `mdat` boxes (the encoded samples). */
  private fun m4a(bytes: ByteArray): ByteArray {
    val out = ByteArrayOutputStream()
    var position = 0
    while (position + 8 <= bytes.size) {
      val buffer = ByteBuffer.wrap(bytes, position, bytes.size - position).order(ByteOrder.BIG_ENDIAN)
      var size = buffer.int.toLong() and 0xffffffffL
      val type = String(bytes, position + 4, 4, Charsets.ISO_8859_1)
      var header = 8
      if (size == 1L) {
        size = buffer.long
        header = 16
      } else if (size == 0L) {
        size = (bytes.size - position).toLong()
      }
      if (type == "mdat") out.write(bytes, position + header, size.toInt() - header)
      position += size.toInt()
    }
    return out.toByteArray()
  }

  /** The audio packets: every packet of the first stream after the three Vorbis headers. */
  private fun ogg(file: File): ByteArray {
    val out = ByteArrayOutputStream()
    file.inputStream().buffered().use { input ->
      val packets = OggPacketReader(input)
      var index = 0
      while (true) {
        val packet = packets.next() ?: break
        if (index >= 3) out.write(packet)
        index += 1
      }
    }
    return out.toByteArray()
  }

  /** The `fmt ` and `data` chunks. */
  private fun wav(bytes: ByteArray): ByteArray {
    val out = ByteArrayOutputStream()
    var position = 12
    while (position + 8 <= bytes.size) {
      val id = String(bytes, position, 4, Charsets.ISO_8859_1)
      val size = ByteBuffer.wrap(bytes, position + 4, 4).order(ByteOrder.LITTLE_ENDIAN).int
      if (id == "fmt " || id == "data") out.write(bytes, position, 8 + size)
      position += 8 + size + (size and 1)
    }
    return out.toByteArray()
  }
}

/**
 * Every tag field of a file except lyrics and genre, as id → raw bytes (hex),
 * so a test can tell the other tags weren't touched.
 */
object OtherTagFields {
  private val LYRICS_OR_GENRE = setOf(
    // ID3
    "USLT", "TCON",
    // Vorbis comments (FLAC, Ogg)
    "LYRICS", "GENRE",
    // MP4
    "©lyr", "©gen", "gnre",
    // RIFF INFO (WAV)
    "IGNR",
  )

  fun of(file: File): Map<String, List<String>> {
    val audio = AudioFileIO.read(file)
    val tags: List<Tag> =
      when (val tag = audio.tag) {
        null -> emptyList()
        is WavTag -> listOfNotNull(tag.iD3Tag, tag.infoTag)
        else -> listOf(tag)
      }
    val fields = sortedMapOf<String, MutableList<String>>()
    for (tag in tags) {
      for (field in tag.fields.asSequence()) {
        val id = field.id
        if (id in LYRICS_OR_GENRE) continue
        val content = runCatching { field.rawContent.toHex() }.getOrElse { field.toString() }
        val frameKey = (field as? AbstractID3v2Frame)?.let { "ID3:$id" } ?: id
        fields.getOrPut(frameKey) { mutableListOf() }.add(content)
      }
    }
    return fields.mapValues { (_, values) -> values.sorted() }
  }

  private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }
}
