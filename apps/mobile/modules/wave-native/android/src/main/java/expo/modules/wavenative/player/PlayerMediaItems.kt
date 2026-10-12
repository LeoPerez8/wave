package expo.modules.wavenative.player

import android.net.Uri
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import java.io.File

/**
 * Builds the player's items, the same way for every path into the player: JS's
 * queue sync ([WavePlayerModule]) and Auto's play requests ([AutoLibrary]).
 */
object PlayerMediaItems {
  /** One queue entry: [id] is its entry key, [path] the audio file. */
  fun build(
    id: String,
    path: String,
    title: String,
    artist: String,
    album: String?,
    artworkPath: String?,
  ): MediaItem {
    val uri = Uri.fromFile(File(path))
    val metadata = MediaMetadata.Builder()
      .setTitle(title)
      .setArtist(artist)
      .setAlbumTitle(album)
      .setArtworkUri(artworkPath?.let { Uri.fromFile(File(it)) })
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
}
