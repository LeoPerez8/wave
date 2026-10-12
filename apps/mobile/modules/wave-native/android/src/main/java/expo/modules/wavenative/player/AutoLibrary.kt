package expo.modules.wavenative.player

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaLibraryService.LibraryParams
import androidx.media3.session.SessionError
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.MoreExecutors
import org.json.JSONArray
import org.json.JSONObject

/**
 * The Android side of Auto browsing: the process-wide [bridge] shared by
 * [PlaybackService] (asks) and [WavePlayerModule] (JS answers), and the
 * conversion of JS's JSON answers into Media3 results.
 */
object AutoLibrary {
  private val main = Handler(Looper.getMainLooper())

  val bridge = AutoBridge(
    object : AutoBridgeHost {
      override fun schedule(delayMs: Long, action: () -> Unit): () -> Unit {
        val runnable = Runnable(action)
        main.postDelayed(runnable, delayMs)
        return { main.removeCallbacks(runnable) }
      }
    },
  )

  /** How long Auto waits for JS while it is still starting (cold start). */
  const val COLD_TIMEOUT_MS = 8_000L

  /** How long Auto waits for a running JS. */
  const val WARM_TIMEOUT_MS = 5_000L

  /** Asks JS for the browse root (an `AutoNode`). */
  fun root(params: LibraryParams?): ListenableFuture<LibraryResult<MediaItem>> =
    ask("root", JSONObject()) { json -> LibraryResult.ofItem(node(JSONObject(json)), params) }

  /** Asks JS for one page of [parentId]'s children (an `AutoNode[]`). */
  fun children(
    parentId: String,
    page: Int,
    pageSize: Int,
    params: LibraryParams?,
  ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
    val payload = JSONObject().put("parentId", parentId).put("page", page).put("pageSize", pageSize)
    return ask("children", payload) { json ->
      val array = JSONArray(json)
      LibraryResult.ofItemList((0 until array.length()).map { node(array.getJSONObject(it)) }, params)
    }
  }

  /**
   * Sends one request and maps JS's answer with [toResult]. A timeout, a JS
   * failure or an unreadable answer becomes an error result carrying the
   * message Auto shows.
   */
  private fun <T : Any> ask(
    type: String,
    payload: JSONObject,
    toResult: (String) -> LibraryResult<T>,
  ): ListenableFuture<LibraryResult<T>> {
    val cold = !bridge.attached
    val askedAt = SystemClock.elapsedRealtime()
    val reply = bridge.request(type, payload.toString(), if (cold) COLD_TIMEOUT_MS else WARM_TIMEOUT_MS)
    return Futures.transform(
      reply,
      { answer ->
        val now = SystemClock.elapsedRealtime()
        Log.i(
          JsRuntime.LOG_TAG,
          "$type answered at $now ms, ${now - askedAt} ms after asking " +
            "(${if (cold) "JS was starting" else "JS running"}): ${answer?.javaClass?.simpleName}",
        )
        when (answer) {
          is AutoReply.Ok -> runCatching { toResult(answer.json) }.getOrElse { error ->
            Log.w(JsRuntime.LOG_TAG, "Unreadable $type answer", error)
            LibraryResult.ofError<T>(SessionError(SessionError.ERROR_UNKNOWN, "Wave couldn't load this."))
          }
          is AutoReply.Failed, null ->
            LibraryResult.ofError<T>(
              SessionError(
                SessionError.ERROR_UNKNOWN,
                (answer as? AutoReply.Failed)?.message ?: AutoBridge.STILL_LOADING,
              ),
            )
        }
      },
      MoreExecutors.directExecutor(),
    )
  }

  /** An `AutoNode` (see `apps/mobile/src/native/wavePlayer.ts`) as a Media3 item. */
  private fun node(json: JSONObject): MediaItem {
    val browsable = json.getBoolean("browsable")
    val metadata = MediaMetadata.Builder()
      .setTitle(json.getString("title"))
      .setSubtitle(json.optString("subtitle").ifEmpty { null })
      .setIsBrowsable(browsable)
      .setIsPlayable(json.getBoolean("playable"))
      .setMediaType(
        if (browsable) MediaMetadata.MEDIA_TYPE_FOLDER_MIXED else MediaMetadata.MEDIA_TYPE_MUSIC,
      )
      .build()
    return MediaItem.Builder().setMediaId(json.getString("mediaId")).setMediaMetadata(metadata).build()
  }
}
