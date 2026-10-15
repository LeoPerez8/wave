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
 * Playlist images in [directory] (`filesDir/artwork/playlists`): each pick is
 * saved as a new pair of JPEGs named after a random hash, `<hash>.jpg` and
 * `<hash>_thumb.jpg`, the names Android Auto's artwork URIs read
 * ([ArtworkUris]). Which playlist shows which image is the database's call;
 * only files of this kind in [directory] are ever deleted.
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

  /** Deletes the saved images at [paths]; any other path is left alone. */
  fun delete(paths: List<String>) {
    val own = directory.canonicalFile
    for (path in paths) {
      val file = File(path)
      if (ArtworkUris.hashOf(file.name) != null && file.canonicalFile.parentFile == own) file.delete()
    }
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

    /** The largest centred square of a [width]×[height] picture. */
    fun centreSquare(width: Int, height: Int): Square {
      val side = minOf(width, height)
      return Square(left = (width - side) / 2, top = (height - side) / 2, side = side)
    }

    /**
     * The power-of-two scale to decode a [width]×[height] picture at: as small
     * as it goes while its short side still covers [target] px.
     */
    fun sampleSize(width: Int, height: Int, target: Int): Int {
      var size = 1
      while (minOf(width, height) / (size * 2) >= target) size *= 2
      return size
    }
  }
}
