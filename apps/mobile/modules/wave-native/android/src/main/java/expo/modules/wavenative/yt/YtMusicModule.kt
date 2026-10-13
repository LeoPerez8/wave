package expo.modules.wavenative.yt

import android.content.Context
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * YT Music for JS (`WaveYtMusic`): the switch in Settings and song search.
 * Requests go through the process-wide [YtClient]; failures reject with the
 * codes of [YtFailure]. Nothing returned carries cookies or stream addresses.
 */
class YtMusicModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val client: YtClient
    get() = YtClient.get(context)

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
  }
}
