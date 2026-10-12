package expo.modules.wavenative.player

import android.content.ComponentName
import android.content.Context
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionError
import androidx.media3.session.SessionResult
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.ListenableFuture
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File

/** One track handed to the player. */
class PlayerItem : Record {
  @Field val id: String = ""
  @Field val path: String = ""
  @Field val title: String = ""
  @Field val artist: String = ""
  @Field val album: String? = null
  @Field val artworkPath: String? = null
}

/** One [SyncStep] as JS sends it. */
class SyncStepRecord : Record {
  @Field val type: String = ""
  @Field val at: Int = 0
  @Field val removeCount: Int = 0
  @Field val keys: List<String> = emptyList()
  @Field val index: Int = 0
  @Field val key: String = ""
}

/**
 * The last queue JS saved, kept for the life of the process: the activity and
 * the JS runtime can go away while [PlaybackService] keeps playing, and JS
 * picks its queue (shuffle, repeat, Up Next) back up from here when it returns.
 */
object QueueSnapshot {
  @Volatile var json: String? = null
}

/** The controller's item list, edited in place so the playing item keeps playing. */
private class ControllerPlaylist(private val player: Player) : PlaylistEditor<MediaItem> {
  override val keys: List<String>
    get() = (0 until player.mediaItemCount).map { player.getMediaItemAt(it).mediaId }
  override val currentKey: String?
    get() = player.currentMediaItem?.mediaId

  override fun clear() = player.clearMediaItems()

  override fun replace(items: List<MediaItem>, index: Int) {
    player.setMediaItems(items, index, 0)
    player.prepare()
  }

  override fun seek(index: Int) = player.seekTo(index, 0)

  override fun remove(from: Int, toExclusive: Int) = player.removeMediaItems(from, toExclusive)

  override fun insert(at: Int, items: List<MediaItem>) = player.addMediaItems(at, items)
}

/**
 * Drives [PlaybackService] through a MediaController. JS owns the order (Core's
 * queue engine) and keeps the item list in step with `applySync`; the player
 * plays it gaplessly and reports `onPlaybackState` (on any change),
 * `onPosition` (every 500 ms while playing), `onItemTransition`, `onSeek` and
 * `onPlayerError`. The controller is only touched on the main thread.
 */
class WavePlayerModule : Module() {
  private val main = Handler(Looper.getMainLooper())
  private var controllerFuture: ListenableFuture<MediaController>? = null
  private var controller: MediaController? = null

  /** True while [QueueSync] edits the list; transitions it causes are reported as `sync`. */
  private var syncing = false

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val positionTicker = object : Runnable {
    override fun run() {
      val player = controller ?: return
      sendEvent("onPosition", position(player))
      if (player.isPlaying) main.postDelayed(this, POSITION_INTERVAL_MS)
    }
  }

  private val listener = object : Player.Listener {
    override fun onEvents(player: Player, events: Player.Events) {
      if (events.containsAny(*STATE_EVENTS)) sendEvent("onPlaybackState", state(player))
    }

    override fun onIsPlayingChanged(isPlaying: Boolean) {
      main.removeCallbacks(positionTicker)
      if (isPlaying) main.post(positionTicker)
    }

    override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
      sendEvent(
        "onItemTransition",
        mapOf(
          "itemId" to mediaItem?.mediaId,
          "reason" to PlayerEvents.transitionReason(reason, duringSync = syncing),
        ),
      )
    }

    override fun onPositionDiscontinuity(
      oldPosition: Player.PositionInfo,
      newPosition: Player.PositionInfo,
      reason: Int,
    ) {
      val itemId = newPosition.mediaItem?.mediaId
      if (!PlayerEvents.isSeekWithinItem(reason, oldPosition.mediaItem?.mediaId, itemId)) return
      sendEvent(
        "onSeek",
        mapOf(
          "itemId" to itemId,
          "fromMs" to oldPosition.positionMs.toDouble(),
          "toMs" to newPosition.positionMs.toDouble(),
          "at" to System.currentTimeMillis().toDouble(),
        ),
      )
    }

    override fun onPlayerError(error: PlaybackException) {
      sendEvent(
        "onPlayerError",
        mapOf(
          "itemId" to controller?.currentMediaItem?.mediaId,
          "message" to (error.message ?: error.errorCodeName),
        ),
      )
    }
  }

  override fun definition() = ModuleDefinition {
    Name("WavePlayer")

    Events(
      "onPlaybackState",
      "onPosition",
      "onItemTransition",
      "onSeek",
      "onPlayerError",
      "onSleepTimer",
      "onAutoRequest",
    )

    OnCreate { main.post(::connect) }

    /**
     * Applies Core's sync plan. Items already loaded are reused by key, so JS
     * only sends [items] for keys new to the player.
     */
    AsyncFunction("applySync") { steps: List<SyncStepRecord>, items: List<PlayerItem>, promise: Promise ->
      withController(promise) { player ->
        val loaded = (0 until player.mediaItemCount)
          .map { player.getMediaItemAt(it) }
          .associateBy { it.mediaId }
        val incoming = items.associate { it.id to toMediaItem(it) }
        syncing = true
        try {
          val plan = steps.map { SyncStep.of(it.type, it.at, it.removeCount, it.keys, it.index, it.key) }
          QueueSync.apply(plan, ControllerPlaylist(player)) { key -> incoming[key] ?: loaded[key] }
          if (player.playbackState == Player.STATE_IDLE && player.mediaItemCount > 0) player.prepare()
          promise.resolve(null)
        } catch (error: IllegalArgumentException) {
          promise.reject("ERR_PLAYER_SYNC", error.message, error)
        } finally {
          syncing = false
        }
      }
    }.runOnQueue(Queues.MAIN)

    /** `off`, `all` or `one`. Core owns shuffle, so the player's own stays off. */
    AsyncFunction("setRepeatMode") { mode: String, promise: Promise ->
      withController(promise) { player ->
        player.repeatMode = PlayerEvents.repeatMode(mode)
        player.shuffleModeEnabled = false
        promise.resolve(null)
      }
    }.runOnQueue(Queues.MAIN)

    /** The loaded entry keys and the one playing, for JS to check a saved queue against. */
    AsyncFunction("getItemIds") { promise: Promise ->
      withController(promise) { player ->
        promise.resolve(
          mapOf(
            "keys" to (0 until player.mediaItemCount).map { player.getMediaItemAt(it).mediaId },
            "currentKey" to player.currentMediaItem?.mediaId,
          ),
        )
      }
    }.runOnQueue(Queues.MAIN)

    /** Keeps the queue for when JS comes back (see [QueueSnapshot]). */
    Function("saveQueue") { json: String -> QueueSnapshot.json = json }

    Function("savedQueue") { QueueSnapshot.json }

    AsyncFunction("play") { promise: Promise ->
      withController(promise) { player ->
        // A finished or failed item starts over.
        if (player.playbackState == Player.STATE_ENDED) player.seekToDefaultPosition()
        if (player.playbackState == Player.STATE_IDLE) player.prepare()
        player.play()
        promise.resolve(null)
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("pause") { promise: Promise ->
      withController(promise) { player ->
        player.pause()
        promise.resolve(null)
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("seekTo") { positionMs: Double, promise: Promise ->
      withController(promise) { player ->
        player.seekTo(positionMs.toLong())
        promise.resolve(null)
      }
    }.runOnQueue(Queues.MAIN)

    /**
     * Starts the sleep timer in the playback service (Core's `SleepTimer`:
     * `deadline` with `endsAt`, or `endOfTrack`), replacing a running one.
     */
    AsyncFunction("setSleepTimer") { type: String, endsAt: Double?, promise: Promise ->
      val mode = SleepTimerWire.fromJs(type, endsAt)
        ?: return@AsyncFunction promise.reject("ERR_SLEEP_TIMER", "Unknown sleep timer: $type", null)
      sendSleepTimerCommand(promise, SleepTimerSession.START, SleepTimerSession.toBundle(mode))
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("cancelSleepTimer") { promise: Promise ->
      sendSleepTimerCommand(promise, SleepTimerSession.CANCEL, Bundle.EMPTY)
    }.runOnQueue(Queues.MAIN)

    /** The running sleep timer, or null; `onSleepTimer` reports changes. */
    AsyncFunction("getSleepTimer") { promise: Promise ->
      withController(promise) { player ->
        promise.resolve(SleepTimerWire.toJs(SleepTimerSession.fromBundle(player.sessionExtras)))
      }
    }.runOnQueue(Queues.MAIN)

    /** The current state, e.g. when JS starts while the service is already playing. */
    AsyncFunction("getState") { promise: Promise ->
      withController(promise) { player -> promise.resolve(state(player)) }
    }.runOnQueue(Queues.MAIN)

    /**
     * JS answers Android Auto from now on ([AutoLibrary.bridge]): `onAutoRequest`
     * carries each request, including those made while the runtime was starting.
     */
    Function("attachAuto") {
      AutoLibrary.bridge.attach { id, type, payload ->
        sendEvent("onAutoRequest", mapOf("id" to id, "type" to type, "payload" to payload))
      }
    }

    Function("respondAuto") { id: Int, json: String -> AutoLibrary.bridge.respond(id, json) }

    Function("failAuto") { id: Int, message: String -> AutoLibrary.bridge.fail(id, message) }

    OnDestroy {
      AutoLibrary.bridge.detach()
      main.post {
        main.removeCallbacks(positionTicker)
        controller?.removeListener(listener)
        controllerFuture?.let(MediaController::releaseFuture)
        controller = null
        controllerFuture = null
      }
    }
  }

  /** The service publishes the running sleep timer in its session extras. */
  private val controllerListener = object : MediaController.Listener {
    override fun onExtrasChanged(controller: MediaController, extras: Bundle) {
      sendSleepTimer(extras)
    }
  }

  private fun sendSleepTimer(extras: Bundle) {
    sendEvent("onSleepTimer", mapOf("timer" to SleepTimerWire.toJs(SleepTimerSession.fromBundle(extras))))
  }

  private fun sendSleepTimerCommand(promise: Promise, command: SessionCommand, args: Bundle) {
    withController(promise) { player ->
      val result = player.sendCustomCommand(command, args)
      result.addListener(
        {
          val code = runCatching { result.get().resultCode }.getOrDefault(SessionError.ERROR_UNKNOWN)
          if (code == SessionResult.RESULT_SUCCESS) {
            promise.resolve(null)
          } else {
            promise.reject("ERR_SLEEP_TIMER", "The player refused the sleep timer ($code)", null)
          }
        },
        context.mainExecutor,
      )
    }
  }

  private fun connect() {
    if (controllerFuture != null) return
    val token = SessionToken(context, ComponentName(context, PlaybackService::class.java))
    val future = MediaController.Builder(context, token).setListener(controllerListener).buildAsync()
    controllerFuture = future
    future.addListener(
      {
        val connected = runCatching { future.get() }.getOrNull() ?: return@addListener
        connected.addListener(listener)
        controller = connected
        sendEvent("onPlaybackState", state(connected))
        sendSleepTimer(connected.sessionExtras)
        if (connected.isPlaying) main.post(positionTicker)
      },
      context.mainExecutor,
    )
  }

  /** Runs [block] once the controller is connected; it is on the main thread either way. */
  private fun withController(promise: Promise, block: (MediaController) -> Unit) {
    controller?.let { return block(it) }
    connect()
    val future = controllerFuture ?: return promise.reject("ERR_PLAYER", "The player isn't available", null)
    future.addListener(
      {
        val connected = runCatching { future.get() }.getOrNull()
        if (connected == null) {
          promise.reject("ERR_PLAYER", "Couldn't connect to the player", null)
        } else {
          block(connected)
        }
      },
      context.mainExecutor,
    )
  }

  private fun toMediaItem(item: PlayerItem): MediaItem {
    val uri = Uri.fromFile(File(item.path))
    val metadata = MediaMetadata.Builder()
      .setTitle(item.title)
      .setArtist(item.artist)
      .setAlbumTitle(item.album)
      .setArtworkUri(item.artworkPath?.let { Uri.fromFile(File(it)) })
      .build()
    return MediaItem.Builder()
      .setMediaId(item.id)
      .setUri(uri)
      .setRequestMetadata(MediaItem.RequestMetadata.Builder().setMediaUri(uri).build())
      .setMediaMetadata(metadata)
      .build()
  }

  private fun position(player: Player): Map<String, Any?> =
    mapOf(
      "positionMs" to player.currentPosition.toDouble(),
      "durationMs" to PlayerEvents.duration(player.duration),
      "at" to System.currentTimeMillis().toDouble(),
    )

  private fun state(player: Player): Map<String, Any?> {
    val item = player.currentMediaItem
    return position(player) + mapOf(
      "status" to PlayerEvents.status(player.playbackState),
      "isPlaying" to player.isPlaying,
      "playWhenReady" to player.playWhenReady,
      "index" to if (item == null) null else player.currentMediaItemIndex,
      "item" to item?.let {
        mapOf(
          "id" to it.mediaId,
          "title" to it.mediaMetadata.title?.toString(),
          "artist" to it.mediaMetadata.artist?.toString(),
          "album" to it.mediaMetadata.albumTitle?.toString(),
          "artworkUri" to it.mediaMetadata.artworkUri?.toString(),
        )
      },
    )
  }

  private companion object {
    const val POSITION_INTERVAL_MS = 500L

    val STATE_EVENTS = intArrayOf(
      Player.EVENT_PLAYBACK_STATE_CHANGED,
      Player.EVENT_IS_PLAYING_CHANGED,
      Player.EVENT_PLAY_WHEN_READY_CHANGED,
      Player.EVENT_MEDIA_ITEM_TRANSITION,
      Player.EVENT_MEDIA_METADATA_CHANGED,
      Player.EVENT_POSITION_DISCONTINUITY,
      Player.EVENT_TIMELINE_CHANGED,
    )
  }
}
