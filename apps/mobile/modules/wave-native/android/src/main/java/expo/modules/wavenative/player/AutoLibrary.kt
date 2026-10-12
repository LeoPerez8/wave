package expo.modules.wavenative.player

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
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Auto's play request couldn't start anything; [message] is for Auto to show. */
class AutoPlayException(message: String) : Exception(message)

/**
 * The Android side of Auto: the process-wide [bridge] shared by
 * [PlaybackService] (asks) and [WavePlayerModule] (JS answers), and the
 * conversion of JS's JSON answers into Media3 results. Request types and
 * their JSON are described by `AutoRequest` in `apps/mobile/src/native/wavePlayer.ts`.
 */
object AutoLibrary {
  /** The bridge's timeouts, off the main thread so they fire even while Media3 blocks it ([root]). */
  private val timeouts = Executors.newSingleThreadScheduledExecutor { runnable ->
    Thread(runnable, "WaveAutoTimeouts").apply { isDaemon = true }
  }

  /** Told the parent ID of a browse page JS answered after Auto gave up on it (a cold start). */
  @Volatile
  var onChildrenRecovered: ((parentId: String) -> Unit)? = null

  val bridge = AutoBridge(
    object : AutoBridgeHost {
      override fun schedule(delayMs: Long, action: () -> Unit): () -> Unit {
        val task = timeouts.schedule(action, delayMs, TimeUnit.MILLISECONDS)
        return { task.cancel(false) }
      }
    },
  )

  /** How long Auto waits for JS while it is still starting (cold start). */
  const val COLD_TIMEOUT_MS = 8_000L

  /** How long Auto waits for a running JS. */
  const val WARM_TIMEOUT_MS = 5_000L

  /** Shown when JS's answer can't be read (a bug, not a state the user can fix). */
  private const val UNREADABLE = "Wave couldn't load this."

  /**
   * The browse root, answered here rather than by JS: Media3 blocks the main
   * thread until a legacy browser (Auto on a phone) gets it, while a cold JS
   * start needs that thread. Core's `AUTO_ROOT` (`packages/core/src/auto.ts`).
   */
  fun root(params: LibraryParams?): ListenableFuture<LibraryResult<MediaItem>> =
    Futures.immediateFuture(
      LibraryResult.ofItem(
        browseItem(mediaId = "root", title = "Wave", subtitle = null, browsable = true, playable = false),
        params,
      ),
    )

  /** Asks JS for one page of [parentId]'s children (an `AutoItem[]`). */
  fun children(
    parentId: String,
    page: Int,
    pageSize: Int,
    params: LibraryParams?,
  ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
    val payload = JSONObject().put("parentId", parentId).put("page", page).put("pageSize", pageSize)
    val reload = {
      Log.i(JsRuntime.LOG_TAG, "children of $parentId answered late; asking Auto to reload them")
      onChildrenRecovered?.invoke(parentId)
      Unit
    }
    return ask("children", payload, onLateAnswer = reload) { json ->
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
   * Asks JS to add [mediaIds] to the queue through its queue engine, which
   * syncs them onto the player itself: the session gets no items to add.
   * Fails with an [AutoPlayException] carrying Auto's message.
   */
  fun add(mediaIds: List<String>): ListenableFuture<MutableList<MediaItem>> =
    Futures.transform(
      request("add", JSONObject().put("mediaIds", JSONArray(mediaIds))),
      { answer ->
        when (answer) {
          is AutoReply.Ok -> mutableListOf()
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
  private fun request(
    type: String,
    payload: JSONObject,
    onLateAnswer: (() -> Unit)? = null,
  ): ListenableFuture<AutoReply> {
    val cold = !bridge.attached
    val askedAt = SystemClock.elapsedRealtime()
    val reply = bridge.request(
      type,
      payload.toString(),
      if (cold) COLD_TIMEOUT_MS else WARM_TIMEOUT_MS,
      onLateAnswer,
    )
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
    onLateAnswer: (() -> Unit)? = null,
    toResult: (String) -> LibraryResult<T>,
  ): ListenableFuture<LibraryResult<T>> =
    Futures.transform(
      request(type, payload, onLateAnswer),
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
  private fun item(json: JSONObject): MediaItem =
    browseItem(
      mediaId = json.getString("mediaId"),
      title = json.getString("title"),
      subtitle = json.stringOrNull("subtitle"),
      browsable = json.getBoolean("browsable"),
      playable = json.getBoolean("playable"),
      artwork = json.stringList("artwork"),
    )

  /** A browse node as a Media3 item. */
  private fun browseItem(
    mediaId: String,
    title: String,
    subtitle: String?,
    browsable: Boolean,
    playable: Boolean,
    artwork: List<String> = emptyList(),
  ): MediaItem {
    val metadata = MediaMetadata.Builder()
      .setTitle(title)
      .setSubtitle(subtitle)
      .setIsBrowsable(browsable)
      .setIsPlayable(playable)
      .setMediaType(
        if (browsable) MediaMetadata.MEDIA_TYPE_FOLDER_MIXED else MediaMetadata.MEDIA_TYPE_MUSIC,
      )
      // Without artwork Auto shows its own placeholder.
      .setArtworkUri(ArtworkProvider.uriFor(artwork))
      .build()
    return MediaItem.Builder().setMediaId(mediaId).setMediaMetadata(metadata).build()
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
