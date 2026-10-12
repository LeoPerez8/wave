package expo.modules.wavenative.player

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaLibraryService.LibraryParams
import androidx.media3.session.MediaSession.MediaItemsWithStartPosition
import androidx.media3.session.SessionError
import androidx.media3.session.SessionResult
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.MoreExecutors
import expo.modules.wavenative.artwork.ArtworkProvider
import org.json.JSONArray
import org.json.JSONObject

/** Auto's play request couldn't start anything; [message] is for Auto to show. */
class AutoPlayException(message: String) : Exception(message)

/**
 * The Android side of Auto: the process-wide [bridge] shared by
 * [PlaybackService] (asks) and [WavePlayerModule] (JS answers), and the
 * conversion of JS's JSON answers into Media3 results. Request types and
 * their JSON are described by `AutoRequest` in `apps/mobile/src/native/wavePlayer.ts`.
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

  /** Shown when JS's answer can't be read (a bug, not a state the user can fix). */
  private const val UNREADABLE = "Wave couldn't load this."

  /** Asks JS for the browse root (an `AutoItem`). */
  fun root(params: LibraryParams?): ListenableFuture<LibraryResult<MediaItem>> =
    ask("root", JSONObject()) { json -> LibraryResult.ofItem(item(JSONObject(json)), params) }

  /** Asks JS for one page of [parentId]'s children (an `AutoItem[]`). */
  fun children(
    parentId: String,
    page: Int,
    pageSize: Int,
    params: LibraryParams?,
  ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
    val payload = JSONObject().put("parentId", parentId).put("page", page).put("pageSize", pageSize)
    return ask("children", payload) { json ->
      val array = JSONArray(json)
      LibraryResult.ofItemList((0 until array.length()).map { item(array.getJSONObject(it)) }, params)
    }
  }

  /** Asks JS for the node [mediaId] names (an `AutoItem`). */
  fun item(mediaId: String): ListenableFuture<LibraryResult<MediaItem>> =
    ask("item", JSONObject().put("mediaId", mediaId)) { json ->
      LibraryResult.ofItem(item(JSONObject(json)), null)
    }

  /**
   * Asks JS to start playing [mediaId] through its queue engine. JS answers
   * with the whole new queue (an `AutoPlayback`), which the session sets on
   * the player. Fails with an [AutoPlayException] carrying Auto's message.
   */
  @OptIn(UnstableApi::class)
  fun play(mediaId: String): ListenableFuture<MediaItemsWithStartPosition> =
    Futures.transform(
      request("play", JSONObject().put("mediaId", mediaId)),
      { answer ->
        when (answer) {
          is AutoReply.Ok -> runCatching { playback(JSONObject(answer.json)) }.getOrElse { error ->
            Log.w(JsRuntime.LOG_TAG, "Unreadable play answer", error)
            throw AutoPlayException(UNREADABLE)
          }
          is AutoReply.Failed -> throw AutoPlayException(answer.message)
          null -> throw AutoPlayException(AutoBridge.STILL_LOADING)
        }
      },
      MoreExecutors.directExecutor(),
    )

  /**
   * Forwards a tap on a shuffle or repeat button ([AutoModes.request]) to JS's
   * queue engine. JS then reports the new modes, which update the buttons.
   */
  fun command(command: AutoCommandRequest): ListenableFuture<SessionResult> =
    Futures.transform(
      request(command.type, JSONObject(command.payload)),
      { answer ->
        when (answer) {
          is AutoReply.Ok -> SessionResult(SessionResult.RESULT_SUCCESS)
          is AutoReply.Failed -> SessionResult(SessionError(SessionError.ERROR_UNKNOWN, answer.message))
          null -> SessionResult(SessionError(SessionError.ERROR_UNKNOWN, AutoBridge.STILL_LOADING))
        }
      },
      MoreExecutors.directExecutor(),
    )

  /** Sends one request, with the timeout for JS's state, and logs how long the answer took. */
  private fun request(type: String, payload: JSONObject): ListenableFuture<AutoReply> {
    val cold = !bridge.attached
    val askedAt = SystemClock.elapsedRealtime()
    val reply = bridge.request(type, payload.toString(), if (cold) COLD_TIMEOUT_MS else WARM_TIMEOUT_MS)
    reply.addListener(
      {
        val now = SystemClock.elapsedRealtime()
        Log.i(
          JsRuntime.LOG_TAG,
          "$type answered at $now ms, ${now - askedAt} ms after asking " +
            "(${if (cold) "JS was starting" else "JS running"}): " +
            runCatching { reply.get()?.javaClass?.simpleName }.getOrNull(),
        )
      },
      MoreExecutors.directExecutor(),
    )
    return reply
  }

  /**
   * Sends one browse request and maps JS's answer with [toResult]. A timeout,
   * a JS failure or an unreadable answer becomes an error result carrying the
   * message Auto shows.
   */
  private fun <T : Any> ask(
    type: String,
    payload: JSONObject,
    toResult: (String) -> LibraryResult<T>,
  ): ListenableFuture<LibraryResult<T>> =
    Futures.transform(
      request(type, payload),
      { answer ->
        when (answer) {
          is AutoReply.Ok -> runCatching { toResult(answer.json) }.getOrElse { error ->
            Log.w(JsRuntime.LOG_TAG, "Unreadable $type answer", error)
            LibraryResult.ofError<T>(SessionError(SessionError.ERROR_UNKNOWN, UNREADABLE))
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

  private fun JSONObject.stringOrNull(name: String): String? = if (isNull(name)) null else getString(name)

  /** The strings of array [name], or none when it's absent. */
  private fun JSONObject.stringList(name: String): List<String> {
    val array = optJSONArray(name) ?: return emptyList()
    return (0 until array.length()).mapNotNull { array.optString(it, null) }
  }

  /** An `AutoItem` (Core's `packages/core/src/auto.ts`) as a Media3 item. */
  private fun item(json: JSONObject): MediaItem {
    val browsable = json.getBoolean("browsable")
    val metadata = MediaMetadata.Builder()
      .setTitle(json.getString("title"))
      .setSubtitle(json.stringOrNull("subtitle"))
      .setIsBrowsable(browsable)
      .setIsPlayable(json.getBoolean("playable"))
      .setMediaType(
        if (browsable) MediaMetadata.MEDIA_TYPE_FOLDER_MIXED else MediaMetadata.MEDIA_TYPE_MUSIC,
      )
      // Without artwork Auto shows its own placeholder.
      .setArtworkUri(ArtworkProvider.uriFor(json.stringList("artwork")))
      .build()
    return MediaItem.Builder().setMediaId(json.getString("mediaId")).setMediaMetadata(metadata).build()
  }

  /** An `AutoPlayback`: the player items (`PlayerItem`s) and the one to start at. */
  @OptIn(UnstableApi::class)
  private fun playback(json: JSONObject): MediaItemsWithStartPosition {
    val array = json.getJSONArray("items")
    val items = (0 until array.length()).map { index ->
      val entry = array.getJSONObject(index)
      PlayerMediaItems.build(
        id = entry.getString("id"),
        path = entry.getString("path"),
        title = entry.getString("title"),
        artist = entry.getString("artist"),
        album = entry.stringOrNull("album"),
        artworkPath = entry.stringOrNull("artworkPath"),
      )
    }
    return MediaItemsWithStartPosition(items, json.getInt("startIndex"), C.TIME_UNSET)
  }
}
