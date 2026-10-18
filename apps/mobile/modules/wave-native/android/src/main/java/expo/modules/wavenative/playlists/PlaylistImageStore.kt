package expo.modules.wavenative.playlists

import expo.modules.wavenative.artwork.ArtworkStore
import expo.modules.wavenative.artwork.ArtworkUris
import java.io.File
import java.io.IOException
import java.util.UUID

/** A playlist's own image on disk: the large one (its page) and the thumbnail (lists, Android Auto). */
data class PlaylistImageFiles(val path: String, val thumbPath: String) {
  fun toMap(): Map<String, String> = mapOf("path" to path, "thumbPath" to thumbPath)
}

/** A square of a picture, in its pixels. */
data class Square(val left: Int, val top: Int, val side: Int)

/**
 * Playlist images in [directory] (`filesDir/artwork/playlists`): each framing
 * is saved as a new pair of JPEGs named after a random hash, `<hash>.jpg` and
 * `<hash>_thumb.jpg`, the names Android Auto's artwork URIs read
 * ([ArtworkUris]), and each picked photo as an original, `<hash>.jpg`, that
 * Adjust Image frames again. Which playlist shows which image is the
 * database's call; only files of this kind in [directory] are ever deleted.
 *
 * Plain files only, so it runs in JVM tests; [AndroidPlaylistImages] makes the JPEGs.
 */
class PlaylistImageStore(
  private val directory: File,
  private val newName: () -> String = ::randomName,
) {
  /** Saves both sizes under a new name; throws [IOException] and keeps nothing when a write fails. */
  fun save(large: ByteArray, thumb: ByteArray): PlaylistImageFiles {
    directory.mkdirs()
    val name = newName()
    val thumbFile = File(directory, "${name}_thumb.jpg")
    val largeFile = File(directory, "$name.jpg")
    ArtworkStore.writeAtomically(thumbFile, thumb)
    try {
      ArtworkStore.writeAtomically(largeFile, large)
    } catch (e: IOException) {
      thumbFile.delete()
      throw e
    }
    return PlaylistImageFiles(largeFile.path, thumbFile.path)
  }

  /** Saves an original photo under a new name; throws [IOException] and keeps nothing when the write fails. */
  fun saveOriginal(bytes: ByteArray): String {
    directory.mkdirs()
    val file = File(directory, "${newName()}.jpg")
    ArtworkStore.writeAtomically(file, bytes)
    return file.path
  }

  /** Whether [path] is one of the saved images (originals too); only those are cropped or deleted. */
  fun owns(path: String): Boolean {
    val file = File(path)
    return ArtworkUris.hashOf(file.name) != null && file.canonicalFile.parentFile == directory.canonicalFile
  }

  /** Deletes the saved images at [paths]; any other path is left alone. */
  fun delete(paths: List<String>) {
    for (path in paths) if (owns(path)) File(path).delete()
  }

  companion object {
    /** Under the artwork folder, where [ArtworkUris.coverFile] looks too. */
    const val DIRECTORY = ArtworkUris.PLAYLIST_IMAGES

    /** The large image's side, in px: sharp across a phone's width. */
    const val LARGE_SIZE = 1200

    /** The thumbnail's side, in px, as album artwork's ([expo.modules.wavenative.artwork.AndroidArtworkProcessor]). */
    const val THUMB_SIZE = 300

    /** A random name in [ArtworkStore.hash]'s form, so no two picks share files. */
    fun randomName(): String = ArtworkStore.hash(UUID.randomUUID().toString().toByteArray(Charsets.UTF_8))

    /**
     * The original's short side, in px, at most: twice the large image's, so
     * a framing zoomed in twice is still sharp.
     */
    const val ORIGINAL_SIZE = 2 * LARGE_SIZE

    /** The size to keep a [width]×[height] photo at: its shape, its short side at most [cap] px. */
    fun originalSize(width: Int, height: Int, cap: Int = ORIGINAL_SIZE): Pair<Int, Int> {
      val short = minOf(width, height)
      if (short <= cap) return width to height
      val scale = cap.toDouble() / short
      return Math.round(width * scale).toInt() to Math.round(height * scale).toInt()
    }

    /**
     * [square] (a framing, Core's `framingSquare`) kept inside a [width]×[height]
     * picture, at least 1 px: its size and place as close as the picture allows.
     */
    fun fitSquare(width: Int, height: Int, square: Square): Square {
      val side = square.side.coerceIn(1, maxOf(1, minOf(width, height)))
      return Square(
        left = square.left.coerceIn(0, maxOf(0, width - side)),
        top = square.top.coerceIn(0, maxOf(0, height - side)),
        side = side,
      )
    }
  }
}
