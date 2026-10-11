package expo.modules.wavenative.artwork

import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap

/** Colours picked from an artwork, as ARGB ints. Any swatch may be missing. */
data class ArtworkPalette(
  val dominant: Int? = null,
  val vibrant: Int? = null,
  val darkVibrant: Int? = null,
  val lightVibrant: Int? = null,
  val muted: Int? = null,
  val darkMuted: Int? = null,
  val lightMuted: Int? = null,
) {
  fun toMap(): Map<String, Int?> =
    mapOf(
      "dominant" to dominant,
      "vibrant" to vibrant,
      "darkVibrant" to darkVibrant,
      "lightVibrant" to lightVibrant,
      "muted" to muted,
      "darkMuted" to darkMuted,
      "lightMuted" to lightMuted,
    )

  /** One `name=#aarrggbb` line per known swatch. */
  fun serialize(): String =
    toMap().mapNotNull { (name, color) -> color?.let { "$name=#%08x".format(it) } }.joinToString("\n")

  companion object {
    fun parse(text: String): ArtworkPalette {
      val colors = text.lines().mapNotNull { line ->
        val separator = line.indexOf("=#")
        if (separator <= 0) return@mapNotNull null
        val value = line.substring(separator + 2).toLongOrNull(16)?.toInt() ?: return@mapNotNull null
        line.substring(0, separator) to value
      }.toMap()
      return ArtworkPalette(
        dominant = colors["dominant"],
        vibrant = colors["vibrant"],
        darkVibrant = colors["darkVibrant"],
        lightVibrant = colors["lightVibrant"],
        muted = colors["muted"],
        darkMuted = colors["darkMuted"],
        lightMuted = colors["lightMuted"],
      )
    }
  }
}

/** An artwork stored on disk: the original image, a small thumbnail and its palette. */
data class ArtworkInfo(
  val hash: String,
  val path: String,
  val thumbPath: String,
  val palette: ArtworkPalette,
)

/** Makes the thumbnail and picks the palette. Returns null when the bytes aren't a decodable image. */
fun interface ArtworkProcessor {
  fun process(image: ByteArray, thumbFile: File): ArtworkPalette?
}

/**
 * Stores embedded artwork once per unique image. Images are identified by a
 * SHA-1 of their bytes, so the hundreds of tracks of an album sharing one
 * cover produce one file, one thumbnail and one palette — across scans too,
 * since a hash already on disk is not processed again. Thread-safe.
 */
class ArtworkStore(private val directory: File, private val processor: ArtworkProcessor) {
  private class Entry(val info: ArtworkInfo?)

  private val entries = ConcurrentHashMap<String, Entry>()

  /** Returns the stored artwork for [image], creating it on first sight; null if undecodable. */
  fun store(image: ByteArray): ArtworkInfo? {
    if (image.isEmpty() || image.size > MAX_IMAGE_BYTES) return null
    val hash = hash(image)
    return entries.computeIfAbsent(hash) { Entry(loadOrCreate(hash, image)) }.info
  }

  private fun loadOrCreate(hash: String, image: ByteArray): ArtworkInfo? {
    directory.mkdirs()
    val original = File(directory, "$hash.${extensionOf(image)}")
    val thumb = File(directory, "${hash}_thumb.jpg")
    val paletteFile = File(directory, "$hash.palette")
    if (original.isFile && thumb.isFile && paletteFile.isFile) {
      val palette = runCatching { ArtworkPalette.parse(paletteFile.readText()) }.getOrNull()
      if (palette != null) return ArtworkInfo(hash, original.path, thumb.path, palette)
    }
    return try {
      val palette = processor.process(image, thumb) ?: return null
      writeAtomically(original, image)
      writeAtomically(paletteFile, palette.serialize().toByteArray())
      ArtworkInfo(hash, original.path, thumb.path, palette)
    } catch (e: IOException) {
      null
    }
  }

  companion object {
    /** Embedded pictures above this are almost certainly broken tags. */
    const val MAX_IMAGE_BYTES = 20 * 1024 * 1024

    fun hash(bytes: ByteArray): String =
      MessageDigest.getInstance("SHA-1").digest(bytes).joinToString("") { "%02x".format(it) }

    fun extensionOf(image: ByteArray): String =
      when {
        image.size >= 3 && image[0] == 0xFF.toByte() && image[1] == 0xD8.toByte() -> "jpg"
        image.size >= 8 && image[0] == 0x89.toByte() && image[1] == 'P'.code.toByte() -> "png"
        image.size >= 12 && String(image, 0, 4, Charsets.US_ASCII) == "RIFF" &&
          String(image, 8, 4, Charsets.US_ASCII) == "WEBP" -> "webp"
        image.size >= 3 && String(image, 0, 3, Charsets.US_ASCII) == "GIF" -> "gif"
        image.size >= 2 && image[0] == 'B'.code.toByte() && image[1] == 'M'.code.toByte() -> "bmp"
        else -> "img"
      }

    /** Writes through a temp file and a rename, so a crash never leaves a half-written image behind. */
    fun writeAtomically(target: File, bytes: ByteArray) {
      val temp = File(target.parentFile, ".${target.name}.tmp")
      temp.writeBytes(bytes)
      if (!temp.renameTo(target)) {
        temp.delete()
        throw IOException("Could not write ${target.path}")
      }
    }
  }
}
