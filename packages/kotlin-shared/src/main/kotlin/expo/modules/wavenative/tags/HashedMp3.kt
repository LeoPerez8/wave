package expo.modules.wavenative.tags

import expo.modules.wavenative.files.FileDigest
import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.DigestOutputStream
import org.jaudiotagger.audio.mp3.MP3File
import org.jaudiotagger.tag.id3.AbstractID3v2Tag
import org.jaudiotagger.tag.id3.ID3v1Tag

/**
 * Tags a downloaded MP3 by writing it whole into a copy hashed as it's written (#455), so its
 * digest comes with the write and the file is never read again for it: the new ID3v2 tag, the
 * audio from its first MPEG frame on, and the ID3v1 tag the file has, as jaudiotagger's own
 * writer lays them out (`MP3File.save`). jaudiotagger can only write in place or copy without
 * hashing, and a SHA-256 can't be patched for a tag rewritten at the start of a file.
 */
internal object HashedMp3 {
  /** Writes [mp3]'s tags ([v2], its ID3v1 if any) into [file]; returns the new file's SHA-256. */
  fun write(mp3: MP3File, file: File, v2: AbstractID3v2Tag): String {
    val audioStart = mp3.mP3AudioHeader.mp3StartByte
    val audioEnd = file.length() - if (endsWithId3v1(file)) ID3V1_BYTES else 0
    if (audioStart < 0 || audioStart > audioEnd) throw IOException("No audio between the tags of ${file.path}")
    val v1 = mp3.iD3v1Tag?.let(::bytesOf)
    val temp = File(file.parentFile, "${file.name}.tagging")
    val sha = FileDigest.sha256()
    try {
      temp.outputStream().use { raw ->
        DigestOutputStream(raw.buffered(), sha).use { output ->
          v2.write(output)
          RandomAccessFile(file, "r").use { input ->
            input.seek(audioStart)
            val buffer = ByteArray(64 * 1024)
            var left = audioEnd - audioStart
            while (left > 0) {
              val count = input.read(buffer, 0, minOf(buffer.size.toLong(), left).toInt())
              if (count < 0) throw IOException("${file.path} ended early")
              output.write(buffer, 0, count)
              left -= count
            }
          }
          if (v1 != null) output.write(v1)
          output.flush()
          raw.fd.sync()
        }
      }
      Files.move(temp.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING)
      return FileDigest.hex(sha)
    } finally {
      temp.delete()
    }
  }

  private const val ID3V1_BYTES = 128L

  private fun endsWithId3v1(file: File): Boolean {
    if (file.length() < ID3V1_BYTES) return false
    return RandomAccessFile(file, "r").use { input ->
      input.seek(file.length() - ID3V1_BYTES)
      val marker = ByteArray(3)
      input.readFully(marker)
      String(marker, Charsets.ISO_8859_1) == "TAG"
    }
  }

  /** [tag] as the 128 bytes it writes at a file's end (its writer only writes into a file). */
  private fun bytesOf(tag: ID3v1Tag): ByteArray {
    val scratch = File.createTempFile("wave-id3v1", ".bin")
    try {
      // The writer looks for a tag to replace in the last 128 bytes first, so it needs that many.
      scratch.writeBytes(ByteArray(ID3V1_BYTES.toInt()))
      RandomAccessFile(scratch, "rw").use { tag.write(it) }
      val bytes = scratch.readBytes()
      return bytes.copyOfRange(bytes.size - ID3V1_BYTES.toInt(), bytes.size)
    } finally {
      scratch.delete()
    }
  }
}
