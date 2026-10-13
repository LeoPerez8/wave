package expo.modules.wavenative.yt

import android.content.Context
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CancellationException

/**
 * Optional YT Music metadata for downloads (album, watch page, lyrics). The
 * native Soulseek journal (`AndroidDownloads`) acquires, tags and publishes.
 */
class YtDownloadModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val client: YtClient
    get() = YtClient.get(context)

  override fun definition() = ModuleDefinition {
    Name("WaveYtDownloads")

    /** The album page with browse id [browseId]: title, artists, year, cover and tracklist. */
    AsyncFunction("album") Coroutine { browseId: String ->
      coded { YtPages(client).album(browseId).toMap() }
    }

    /** What [videoId]'s watch page says: `{ albumId, lyricsBrowseId }`, either null. */
    AsyncFunction("watchSong") Coroutine { videoId: String ->
      coded {
        val song = YtPages(client).song(videoId)
        mapOf("albumId" to song.albumId, "lyricsBrowseId" to song.lyricsBrowseId)
      }
    }

    /** YT Music's lyrics at [browseId] (plain text), or null. */
    AsyncFunction("lyrics") Coroutine { browseId: String ->
      coded { YtPages(client).lyrics(browseId) }
    }
  }

  /** Runs [block], turning a [YtException] into its code and a cancellation into `ERR_YT_CANCELLED`. */
  private suspend fun <T> coded(block: suspend () -> T): T =
    try {
      block()
    } catch (e: YtException) {
      throw CodedException(e.failure.code, e.message, e.cause)
    } catch (e: CancellationException) {
      throw CodedException(CANCELLED, "Download cancelled", e)
    }

  private companion object {
    const val CANCELLED = "ERR_YT_CANCELLED"
  }
}
