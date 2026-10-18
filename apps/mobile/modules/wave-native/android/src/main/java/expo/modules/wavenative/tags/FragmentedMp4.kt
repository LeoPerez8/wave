package expo.modules.wavenative.tags

import expo.modules.wavenative.files.FileDigest
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.DigestOutputStream
import org.jaudiotagger.audio.AudioFile
import org.jaudiotagger.audio.AudioFileIO
import org.jaudiotagger.tag.mp4.Mp4Tag
import org.jaudiotagger.tag.mp4.Mp4TagCreator

/**
 * Tags a fragmented MP4, what YouTube serves: the moov has an empty sample
 * table and a `mvex`, and the audio is in moof/mdat fragments after it.
 * jaudiotagger can't grow such a moov (its check expects chunk offsets to
 * move and fails with "incorrect offsets written"), so this replaces the
 * moov's `udta/meta` with one holding [ilst] and shifts the absolute offsets
 * the fragments carry: a `tfhd` base data offset and the `tfra` index in `mfra`.
 * Offsets relative to a moof or a `sidx` need nothing.
 */
internal object FragmentedMp4 {
  /**
   * Writes [audio]'s tag into [file], read from it: through [writeIlst] for a
   * fragmented M4A (a YouTube download, a quality replacement's copy),
   * jaudiotagger's writer otherwise. Every tag writer goes through here.
   * Returns the file's SHA-256 when the write went through every byte of it, else null.
   */
  fun writeTag(audio: AudioFile, file: File): String? {
    val tag = audio.tag
    if (tag is Mp4Tag && isFragmented(file)) {
      val ilst = Mp4TagCreator().convertMetadata(tag)
      return writeIlst(file, ByteArray(ilst.remaining()).also(ilst::get))
    }
    AudioFileIO.write(audio)
    return null
  }

  private class Box(val type: String, val offset: Long, val header: Int, val size: Long) {
    val end: Long get() = offset + size
  }

  /** True when [file] is an MP4 whose audio is all in fragments (an empty sample table). */
  fun isFragmented(file: File): Boolean {
    val moov = runCatching { topLevel(file).singleOrNull { it.type == "moov" } }.getOrNull() ?: return false
    val bytes = read(file, moov)
    val children = children(bytes, moov.header, bytes.size)
    if (children.none { it.type == "mvex" }) return false
    return chunkOffsetCounts(bytes, children).all { it == 0L }
  }

  /**
   * Rewrites [file] with [ilst] (a whole `ilst` box) as its tags; the audio and fragments stay as
   * they are. Returns the new file's SHA-256, taken as it was written ([FileDigest]).
   */
  fun writeIlst(file: File, ilst: ByteArray): String {
    val boxes = topLevel(file)
    val moov = boxes.singleOrNull { it.type == "moov" } ?: throw IOException("No single moov box")
    if (boxes.any { it.type == "sidx" && it.offset < moov.offset }) throw IOException("A sidx comes before the moov")
    val old = read(file, moov)
    val tagged = tagged(old, moov.header, ilst)
    val delta = tagged.size.toLong() - moov.size
    val temp = File(file.parentFile, "${file.name}.tagging")
    val sha = FileDigest.sha256()
    try {
      RandomAccessFile(file, "r").use { input ->
        DigestOutputStream(temp.outputStream().buffered(), sha).use { output ->
          for (box in boxes) {
            when {
              box === moov -> output.write(tagged)
              box.offset > moov.offset && box.type == "moof" -> output.write(shiftedMoof(read(input, box), delta, moov.offset))
              box.offset > moov.offset && box.type == "mfra" -> output.write(shiftedIndex(read(input, box), delta, moov.offset))
              else -> copy(input, box, output)
            }
          }
        }
      }
      Files.move(temp.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING)
      return FileDigest.hex(sha)
    } finally {
      temp.delete()
    }
  }

  /** The moov with every `udta/meta` replaced by one holding [ilst]. */
  private fun tagged(moov: ByteArray, header: Int, ilst: ByteArray): ByteArray {
    val meta = fullBox("meta", hdlr() + ilst)
    val body = ByteArrayOutputStream()
    var hasUdta = false
    for (child in children(moov, header, moov.size)) {
      if (child.type != "udta") {
        body.write(moov, child.offset.toInt(), child.size.toInt())
        continue
      }
      hasUdta = true
      val udta = ByteArrayOutputStream()
      for (inner in children(moov, child.offset.toInt() + child.header, child.end.toInt())) {
        if (inner.type != "meta") udta.write(moov, inner.offset.toInt(), inner.size.toInt())
      }
      udta.write(meta)
      body.write(box("udta", udta.toByteArray()))
    }
    if (!hasUdta) body.write(box("udta", meta))
    return box("moov", body.toByteArray())
  }

  /** iTunes' metadata handler, as every tagger writes it. */
  private fun hdlr(): ByteArray =
    fullBox("hdlr", ByteBuffer.allocate(21).putInt(0).put("mdir".toByteArray(Charsets.ISO_8859_1)).put("appl".toByteArray(Charsets.ISO_8859_1)).array())

  /** A moof whose `tfhd` base data offsets (absolute, when present) follow the grown moov. */
  private fun shiftedMoof(moof: ByteArray, delta: Long, moovOffset: Long): ByteArray {
    val buffer = ByteBuffer.wrap(moof)
    for (traf in children(moof, 8, moof.size).filter { it.type == "traf" }) {
      for (tfhd in children(moof, traf.offset.toInt() + traf.header, traf.end.toInt()).filter { it.type == "tfhd" }) {
        val flags = buffer.getInt(tfhd.offset.toInt() + 8) and 0xffffff
        if (flags and BASE_DATA_OFFSET_PRESENT == 0) continue
        // version/flags (4) and track_ID (4) come before the base data offset.
        val at = tfhd.offset.toInt() + 16
        val base = buffer.getLong(at)
        if (base > moovOffset) buffer.putLong(at, base + delta)
      }
    }
    return moof
  }

  /** An `mfra` whose `tfra` entries point at the moofs where they now are. */
  private fun shiftedIndex(mfra: ByteArray, delta: Long, moovOffset: Long): ByteArray {
    val buffer = ByteBuffer.wrap(mfra)
    for (tfra in children(mfra, 8, mfra.size).filter { it.type == "tfra" }) {
      var at = tfra.offset.toInt() + 8
      val wide = mfra[at].toInt() == 1
      at += 4 + 4 // version/flags, track_ID
      val lengths = buffer.getInt(at)
      val entries = buffer.getInt(at + 4)
      at += 8
      val rest = ((lengths shr 4) and 3) + 1 + ((lengths shr 2) and 3) + 1 + (lengths and 3) + 1
      repeat(entries) {
        at += if (wide) 8 else 4 // time
        if (wide) {
          val offset = buffer.getLong(at)
          if (offset > moovOffset) buffer.putLong(at, offset + delta)
          at += 8
        } else {
          val offset = buffer.getInt(at).toLong() and 0xffffffffL
          val shifted = if (offset > moovOffset) offset + delta else offset
          if (shifted > 0xffffffffL) throw IOException("A fragment moved past a 32-bit index offset")
          buffer.putInt(at, shifted.toInt())
          at += 4
        }
        at += rest
      }
    }
    return mfra
  }

  /** How many chunk offsets each `stco`/`co64` in the moov lists. */
  private fun chunkOffsetCounts(moov: ByteArray, children: List<Box>): List<Long> =
    children.flatMap { child ->
      when (child.type) {
        "stco", "co64" -> listOf(ByteBuffer.wrap(moov).getInt(child.offset.toInt() + child.header + 4).toLong() and 0xffffffffL)
        "trak", "mdia", "minf", "stbl" -> chunkOffsetCounts(moov, children(moov, child.offset.toInt() + child.header, child.end.toInt()))
        else -> emptyList()
      }
    }

  private fun topLevel(file: File): List<Box> = RandomAccessFile(file, "r").use { input ->
    val length = input.length()
    val boxes = mutableListOf<Box>()
    var position = 0L
    while (position + 8 <= length) {
      input.seek(position)
      var size = input.readInt().toLong() and 0xffffffffL
      val type = ByteArray(4).also(input::readFully).toString(Charsets.ISO_8859_1)
      var header = 8
      if (size == 1L) {
        size = input.readLong()
        header = 16
      } else if (size == 0L) {
        size = length - position
      }
      if (size < header || position + size > length) throw IOException("Box $type at $position runs past the file")
      boxes += Box(type, position, header, size)
      position += size
    }
    if (position != length) throw IOException("Trailing bytes after the last box")
    boxes
  }

  private fun children(bytes: ByteArray, start: Int, end: Int): List<Box> {
    val buffer = ByteBuffer.wrap(bytes)
    val boxes = mutableListOf<Box>()
    var position = start
    while (position + 8 <= end) {
      var size = buffer.getInt(position).toLong() and 0xffffffffL
      val type = String(bytes, position + 4, 4, Charsets.ISO_8859_1)
      var header = 8
      if (size == 1L) {
        size = buffer.getLong(position + 8)
        header = 16
      } else if (size == 0L) {
        size = (end - position).toLong()
      }
      if (size < header || position + size > end) throw IOException("Box $type at $position runs past its parent")
      boxes += Box(type, position.toLong(), header, size)
      position += size.toInt()
    }
    return boxes
  }

  private fun read(file: File, box: Box): ByteArray = RandomAccessFile(file, "r").use { read(it, box) }

  private fun read(input: RandomAccessFile, box: Box): ByteArray {
    if (box.size > MAX_IN_MEMORY) throw IOException("${box.type} box is too large to rewrite")
    input.seek(box.offset)
    return ByteArray(box.size.toInt()).also(input::readFully)
  }

  private fun copy(input: RandomAccessFile, box: Box, output: java.io.OutputStream) {
    input.seek(box.offset)
    val buffer = ByteArray(64 * 1024)
    var left = box.size
    while (left > 0) {
      val count = input.read(buffer, 0, minOf(buffer.size.toLong(), left).toInt())
      if (count < 0) throw IOException("The file ended inside ${box.type}")
      output.write(buffer, 0, count)
      left -= count
    }
  }

  private fun box(type: String, body: ByteArray): ByteArray =
    ByteBuffer.allocate(8 + body.size).putInt(8 + body.size).put(type.toByteArray(Charsets.ISO_8859_1)).put(body).array()

  private fun fullBox(type: String, body: ByteArray): ByteArray = box(type, ByteArray(4) + body)

  private const val BASE_DATA_OFFSET_PRESENT = 0x000001
  /** Moov, moof and mfra boxes are kilobytes; anything far larger isn't one to hold in memory. */
  private const val MAX_IN_MEMORY = 64L * 1024 * 1024
}
