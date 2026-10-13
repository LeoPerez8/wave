package expo.modules.wavenative.playlists

import expo.modules.wavenative.folders.TreeUris
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.Charset
import java.nio.charset.CodingErrorAction

/**
 * Reading playlist files picked with the system file picker
 * (`ACTION_OPEN_DOCUMENT`): their text, and the absolute path their relative
 * entries start from. Core parses the text and resolves the entries.
 */
object PlaylistFiles {
  const val DOWNLOADS_AUTHORITY = "com.android.providers.downloads.documents"

  /** Bigger files aren't playlists Wave can use; they're reported as unreadable. */
  const val MAX_BYTES = 4 * 1024 * 1024

  /**
   * The picker's MIME types for M3U files. Providers name them differently, and
   * some don't know `.m3u8` at all (octet-stream); Core sorts out what isn't one.
   */
  val MIME_TYPES = arrayOf(
    "audio/x-mpegurl",
    "audio/mpegurl",
    "application/x-mpegurl",
    "application/vnd.apple.mpegurl",
    "application/octet-stream",
  )

  private val UTF8_BOM = byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte())

  /** A playlist file's text (see [decodeText]), or null when it's over [maxBytes]. */
  fun readText(input: InputStream, maxBytes: Int = MAX_BYTES): String? {
    val out = ByteArrayOutputStream()
    val buffer = ByteArray(8 * 1024)
    while (true) {
      val read = input.read(buffer)
      if (read < 0) break
      out.write(buffer, 0, read)
      if (out.size() > maxBytes) return null
    }
    return decodeText(out.toByteArray())
  }

  /**
   * A playlist file's text. `.m3u8` is UTF-8; an old `.m3u` may be in the
   * Windows code page instead, so bytes that aren't valid UTF-8 are read as that.
   */
  fun decodeText(bytes: ByteArray): String {
    val start = if (bytes.size >= 3 && bytes.copyOfRange(0, 3).contentEquals(UTF8_BOM)) 3 else 0
    val body = ByteBuffer.wrap(bytes, start, bytes.size - start)
    return try {
      Charsets.UTF_8.newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT)
        .decode(body)
        .toString()
    } catch (e: CharacterCodingException) {
      String(bytes, start, bytes.size - start, Charset.forName("windows-1252"))
    }
  }

  /**
   * The absolute path of a picked document, when its provider has one: the
   * external-storage provider (`primary:Playlists/Drive.m3u`) and the Downloads
   * provider's `raw:` ids. Null otherwise (the Downloads provider's MediaStore
   * ids are looked up by the module; cloud providers have no path).
   */
  fun documentPath(
    authority: String?,
    documentId: String?,
    volumeDirectory: (String) -> File?,
  ): String? {
    if (documentId == null) return null
    if (authority == DOWNLOADS_AUTHORITY) {
      return documentId.removePrefix(RAW_PREFIX).takeIf { documentId.startsWith(RAW_PREFIX) }
    }
    return TreeUris.toPath(authority, documentId, volumeDirectory)
  }

  /** The MediaStore id in a Downloads provider document id like `msf:1234`, if it is one. */
  fun mediaStoreId(authority: String?, documentId: String?): Long? {
    if (authority != DOWNLOADS_AUTHORITY || documentId == null) return null
    return documentId.removePrefix(MEDIA_STORE_PREFIX).takeIf { documentId.startsWith(MEDIA_STORE_PREFIX) }
      ?.toLongOrNull()
  }

  private const val RAW_PREFIX = "raw:"
  private const val MEDIA_STORE_PREFIX = "msf:"
}
