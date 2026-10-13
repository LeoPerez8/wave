package expo.modules.wavenative.player

import android.net.Uri
import android.os.Bundle
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import expo.modules.wavenative.artwork.ArtworkProvider
import expo.modules.wavenative.yt.YtMedia
import java.io.File

/**
 * Builds the player's items, the same way for every path into the player: JS's
 * queue sync ([WavePlayerModule]) and Auto's play requests ([AutoLibrary]).
 */
object PlayerMediaItems {
  /**
   * One queue entry: [id] is its entry key, [path] the audio file, or a YT
   * Music song's track id (`yt:<videoId>`), which the player streams
   * ([expo.modules.wavenative.yt.YtDataSource]). [artworkPath] is a cached
   * image file or, for a YT Music song whose cover isn't cached, its address.
   */
  fun build(
    id: String,
    path: String,
    title: String,
    artist: String,
    album: String?,
    artworkPath: String?,
  ): MediaItem {
    val uri = if (YtMedia.videoIdOf(path) != null) Uri.parse(path) else Uri.fromFile(File(path))
    val artworkFile = artworkPath?.takeUnless(::isAddress)
    val metadata = MediaMetadata.Builder()
      .setTitle(title)
      .setArtist(artist)
      .setAlbumTitle(album)
      // Auto, the notification and System UI read artwork through Wave's content provider;
      // the app keeps the file (see [appArtworkUri]).
      .setArtworkUri(
        artworkFile?.let { ArtworkProvider.uriFor(listOf(it)) ?: Uri.fromFile(File(it)) }
          ?: artworkPath?.let(Uri::parse),
      )
      .setExtras(artworkFile?.let { Bundle().apply { putString(ARTWORK_PATH, it) } })
      .build()
    return MediaItem.Builder()
      .setMediaId(id)
      .setUri(uri)
      // Controllers may receive items without their local configuration; the
      // session rebuilds the URI from here ([PlaybackService] `onAddMediaItems`).
      .setRequestMetadata(MediaItem.RequestMetadata.Builder().setMediaUri(uri).build())
      .setMediaMetadata(metadata)
      .build()
  }

  /** Whether [path] is an image's web address (a YT Music cover) rather than a file. */
  fun isAddress(path: String): Boolean = path.startsWith("https://") || path.startsWith("http://")

  /**
   * What the resume snapshot keeps as an item's path ([ResumeStore]): the
   * audio file, or a YT Music song's track id, from the item's URI.
   */
  fun pathOf(uri: Uri?): String {
    val text = uri?.toString() ?: return ""
    return if (YtMedia.videoIdOf(text) != null) text else uri.path ?: ""
  }

  /**
   * The extras key holding the artwork file, for the app's own UI and the
   * resume snapshot ([ResumeStore]), which rebuilds items through [build].
   * An item whose artwork is an address keeps it as its artwork URI instead.
   */
  const val ARTWORK_PATH = "expo.modules.wavenative.ARTWORK_PATH"

  /**
   * The artwork URI the app shows for an item: its cached file, as the app's
   * other artwork, or the item's artwork URI when it carries no file.
   */
  fun appArtworkUri(metadata: MediaMetadata): String? =
    metadata.extras?.getString(ARTWORK_PATH)?.let { Uri.fromFile(File(it)).toString() }
      ?: metadata.artworkUri?.toString()
}
