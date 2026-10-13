package expo.modules.wavenative.yt

import android.content.Context
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.wavenative.artwork.AndroidArtworkProcessor
import expo.modules.wavenative.artwork.ArtistPhotoStore
import expo.modules.wavenative.artwork.ArtworkStore
import java.io.File
import java.io.IOException

/**
 * YT Music for JS (`WaveYtMusic`): the switch in Settings, song search and
 * caching a played song's cover. (Playing is the playback service's: it
 * streams `yt:` queue items, see [YtDataSource].)
 * Requests go through the process-wide [YtClient]; failures reject with the
 * codes of [YtFailure]. Nothing returned carries cookies or stream addresses.
 */
class YtMusicModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val client: YtClient
    get() = YtClient.get(context)

  /** The Library's artwork store: YT Music covers are cached beside the Library's. */
  private val artworkStore by lazy { ArtworkStore(File(context.filesDir, "artwork"), AndroidArtworkProcessor()) }

  override fun definition() = ModuleDefinition {
    Name("WaveYtMusic")

    /** Turns YT Music on or off; off, every request is refused before reaching the network. */
    Function("setEnabled") { on: Boolean -> client.enabled = on }

    Function("isEnabled") { client.enabled }

    /** `{ songs, continuation }` for [query], or a rejection with an `ERR_YT_*` code. */
    AsyncFunction("searchSongs") Coroutine { query: String ->
      try {
        client.searchSongs(query).toMap()
      } catch (e: YtException) {
        throw CodedException(e.failure.code, e.message, e.cause)
      }
    }

    /**
     * Caches a YT Music song's cover from [url] beside the Library's artwork:
     * `{ hash, path, thumbPath, palette }` (ARGB swatches), so the player,
     * the notification and Auto show it like a Library track's and Now
     * Playing takes its tint. Rejects with an `ERR_YT_*` code.
     */
    AsyncFunction("cacheArtwork") Coroutine { url: String ->
      try {
        val artwork = client.request {
          val bytes = ArtistPhotoStore.httpGet(url)
          if (ArtworkStore.extensionOf(bytes) == "img") throw IOException("Not an image")
          artworkStore.store(bytes) ?: throw IOException("Unreadable image")
        }
        mapOf(
          "hash" to artwork.hash,
          "path" to artwork.path,
          "thumbPath" to artwork.thumbPath,
          "palette" to artwork.palette.toMap(),
        )
      } catch (e: YtException) {
        throw CodedException(e.failure.code, e.message, e.cause)
      }
    }
  }
}
