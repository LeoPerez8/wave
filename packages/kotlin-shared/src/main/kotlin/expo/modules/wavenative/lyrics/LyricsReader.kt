package expo.modules.wavenative.lyrics

import expo.modules.wavenative.tags.TagReader
import java.io.File
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction

/** A track's lyrics as found, unparsed: Core decides which to show and how. */
data class LyricsSources(val embedded: String?, val sidecar: String?)

/**
 * Reads a track's lyrics when the Lyrics view asks for them: the embedded
 * lyrics from its tags and the sidecar `.lrc` file beside it. Reading on demand
 * (rather than at scan time) picks up `.lrc` files added after the track was
 * indexed, which an incremental scan never re-reads.
 */
class LyricsReader(private val tagReader: TagReader) {
  fun read(audio: File): LyricsSources =
    LyricsSources(embedded = tagReader.read(audio).lyrics, sidecar = Sidecars.find(audio)?.let(::readSidecar))

  /** The sidecar's text: UTF-8 or UTF-16 (by byte order mark), else Windows Latin-1. */
  private fun readSidecar(file: File): String? {
    if (file.length() > MAX_SIDECAR_BYTES) return null
    val bytes = try {
      file.readBytes()
    } catch (e: IOException) {
      return null
    }
    return when {
      bytes.startsWith(0xEF, 0xBB, 0xBF) -> String(bytes, 3, bytes.size - 3, Charsets.UTF_8)
      bytes.startsWith(0xFE, 0xFF) -> String(bytes, 2, bytes.size - 2, Charsets.UTF_16BE)
      bytes.startsWith(0xFF, 0xFE) -> String(bytes, 2, bytes.size - 2, Charsets.UTF_16LE)
      else -> decodeUtf8(bytes) ?: String(bytes, charset("windows-1252"))
    }
  }

  private fun decodeUtf8(bytes: ByteArray): String? =
    try {
      Charsets.UTF_8.newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT)
        .decode(ByteBuffer.wrap(bytes))
        .toString()
    } catch (e: CharacterCodingException) {
      null
    }

  private fun ByteArray.startsWith(vararg prefix: Int): Boolean =
    size >= prefix.size && prefix.indices.all { this[it] == prefix[it].toByte() }

  private companion object {
    /** Real `.lrc` files are a few KB; anything this big isn't one. */
    const val MAX_SIDECAR_BYTES = 1024 * 1024L
  }
}
