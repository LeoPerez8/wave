package expo.modules.wavenative.artwork

import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** An artist photo on disk: the large image (artist page) and the thumbnail (lists). */
data class ArtistPhotoFiles(val path: String, val thumbPath: String) {
  fun toMap(): Map<String, String> = mapOf("path" to path, "thumbPath" to thumbPath)
}

/**
 * Downloads artist photos into [directory] (beside the album artwork), one
 * pair of files per artist, named after a hash of the artist's key. A photo is
 * saved whole or not at all: a failed download or bytes that aren't an image
 * throw and leave nothing behind. Which photo to take is decided in JS (Core).
 */
class ArtistPhotoStore(
  private val directory: File,
  private val download: (url: String) -> ByteArray = ::httpGet,
) {
  /** Downloads both sizes of [artistKey]'s photo; throws [IOException] when either fails. */
  fun save(artistKey: String, thumbUrl: String, largeUrl: String): ArtistPhotoFiles {
    val thumb = image(thumbUrl)
    val large = image(largeUrl)
    directory.mkdirs()
    val name = ArtworkStore.hash(artistKey.toByteArray(Charsets.UTF_8))
    val thumbFile = File(directory, "${name}_thumb.jpg")
    val largeFile = File(directory, "$name.${ArtworkStore.extensionOf(large)}")
    ArtworkStore.writeAtomically(thumbFile, thumb)
    ArtworkStore.writeAtomically(largeFile, large)
    return ArtistPhotoFiles(largeFile.path, thumbFile.path)
  }

  /** Deletes every saved photo. */
  fun clear() {
    directory.deleteRecursively()
  }

  private fun image(url: String): ByteArray {
    val bytes = download(url)
    if (bytes.isEmpty() || bytes.size > ArtworkStore.MAX_IMAGE_BYTES || ArtworkStore.extensionOf(bytes) == "img") {
      throw IOException("Not an image: $url")
    }
    return bytes
  }

  companion object {
    private const val TIMEOUT_MS = 15_000

    /** Fetches [url] over HTTPS; anything but a 200 is an [IOException]. */
    fun httpGet(url: String): ByteArray {
      val connection = URL(url).openConnection() as HttpURLConnection
      try {
        connection.connectTimeout = TIMEOUT_MS
        connection.readTimeout = TIMEOUT_MS
        connection.instanceFollowRedirects = true
        if (connection.responseCode != HttpURLConnection.HTTP_OK) {
          throw IOException("HTTP ${connection.responseCode} for $url")
        }
        return connection.inputStream.use { it.readBytes() }
      } finally {
        connection.disconnect()
      }
    }
  }
}
