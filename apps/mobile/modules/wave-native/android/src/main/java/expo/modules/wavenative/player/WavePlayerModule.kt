package expo.modules.wavenative.player

import android.content.ComponentName
import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.session.MediaController
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

/**
 * Drives [PlaybackService] through a MediaController. JS owns the order and
 * pushes the item list; the player reports `onPlaybackState` (on any change),
 * `onPosition` (every 500 ms while playing), `onItemTransition` and
 * `onPlayerError`. The controller is only touched on the main thread.
 */
class WavePlayerModule : Module() {
  private val main = Handler(Looper.getMainLooper())
  private var controllerFuture: ListenableFuture<MediaController>? = null
  private var controller: MediaController? = null

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
        mapOf("itemId" to mediaItem?.mediaId, "reason" to PlayerEvents.transitionReason(reason)),
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

    Events("onPlaybackState", "onPosition", "onItemTransition", "onPlayerError")

    OnCreate { main.post(::connect) }

    /** Replaces the item list and starts at [startIndex] / [startPositionMs]. */
    AsyncFunction("setItems") {
        items: List<PlayerItem>, startIndex: Int, startPositionMs: Double, play: Boolean, promise: Promise ->
      withController(promise) { player ->
        player.setMediaItems(items.map(::toMediaItem), startIndex, startPositionMs.toLong())
        player.prepare()
        player.playWhenReady = play
        promise.resolve(null)
      }
    }.runOnQueue(Queues.MAIN)

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

    /** The current state, e.g. when JS starts while the service is already playing. */
    AsyncFunction("getState") { promise: Promise ->
      withController(promise) { player -> promise.resolve(state(player)) }
    }.runOnQueue(Queues.MAIN)

    OnDestroy {
      main.post {
        main.removeCallbacks(positionTicker)
        controller?.removeListener(listener)
        controllerFuture?.let(MediaController::releaseFuture)
        controller = null
        controllerFuture = null
      }
    }
  }

  private fun connect() {
    if (controllerFuture != null) return
    val token = SessionToken(context, ComponentName(context, PlaybackService::class.java))
    val future = MediaController.Builder(context, token).buildAsync()
    controllerFuture = future
    future.addListener(
      {
        val connected = runCatching { future.get() }.getOrNull() ?: return@addListener
        connected.addListener(listener)
        controller = connected
        sendEvent("onPlaybackState", state(connected))
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
