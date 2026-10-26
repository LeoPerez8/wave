package expo.modules.wavenative.player

import android.content.ComponentName
import android.content.Context
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.media3.common.MediaItem
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
import expo.modules.wavenative.yt.YtStreamFailure

/** One track handed to the player. */
class PlayerItem : Record {
  @Field val id: String = ""
  @Field val path: String = ""
  @Field val title: String = ""
  @Field val artist: String = ""
  @Field val album: String? = null
  @Field val artworkPath: String? = null
}

/** A loaded item's new artwork, as JS sends it (Core's `PlayerCoverUpdate`). */
class ItemArtworkRecord : Record {
  @Field val key: String = ""
  @Field val artworkPath: String = ""
}

/** The title and artist Core's `autoLyricLines` picked, as JS sends them ([LyricsText]). */
class AutoLyricsTextRecord : Record {
  @Field val title: String = ""
  @Field val artist: String? = null
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
 * After a cold start, playback resumption seeds it from the resume snapshot.
 */
object QueueSnapshot {
  @Volatile var json: String? = null

  /** Where the queue was started from (`phone` or `auto`), for the plays JS records. */
  @Volatile var source: String? = null

  /**
   * Whether the player's list came from playback resumption (Wave's process
   * had died) and JS hasn't taken it over yet: its plays are new ones, not the
   * ones on record going on.
   */
  @Volatile var resumed = false
}

/**
 * The controller's item list, edited in place so the playing item keeps
 * playing. Reads go to the controller's current timeline each time: nothing is
 * cached between syncs, so changes made elsewhere (Android Auto, playback
 * resumption) are never missed. Main thread only, like the controller.
 */
private class ControllerPlaylist(private val player: Player) : PlaylistEditor<MediaItem> {
  override val size: Int
    get() = player.mediaItemCount
  override val currentKey: String?
    get() = player.currentMediaItem?.mediaId

  override fun keyAt(index: Int): String = player.getMediaItemAt(index).mediaId

  override fun itemAt(index: Int): MediaItem = player.getMediaItemAt(index)

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
 * plays it gaplessly (or with a crossfade, [Crossfade]) and reports
 * `onPlaybackState` (on any change), `onPosition` (every 500 ms while
 * playing), `onItemTransition`, `onSeek`, `onCrossfade` (the song fading out
 * went silent) and `onPlayerError`. The controller is only touched on the
 * main thread.
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
      val crossfade = CrossfadeLink.handoff.take(mediaItem?.mediaId, SystemClock.elapsedRealtime())
      sendEvent(
        "onItemTransition",
        mapOf(
          "itemId" to mediaItem?.mediaId,
          "reason" to PlayerEvents.transitionReason(
            reason,
            duringSync = syncing,
            crossfade = crossfade,
          ),
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
          // Why a YT Music song couldn't stream (Core's `PlayerErrorCode`); null otherwise.
          "code" to YtStreamFailure.codeOf(error.cause?.message),
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
      "onCrossfade",
      "onSleepTimer",
      "onAutoRequest",
      "onAutoLyrics",
    )

    OnCreate {
      ResumeStore.init(context)
      main.post(::connect)
      main.post(::followAutoLyrics)
      main.post(::followCrossfade)
    }

    /**
     * The overlap for songs ending on their own, in ms (Core's
     * `crossfadeDuration`; 0 is off). Kept natively, so the service fades
     * without JS too.
     */
    AsyncFunction("setCrossfadeDuration") { durationMs: Double, promise: Promise ->
      CrossfadeLink.init(context)
      CrossfadeLink.setOverlap(durationMs.toLong())
      promise.resolve(null)
    }.runOnQueue(Queues.MAIN)

    /**
     * How much streamed audio the session's player keeps loaded ahead, in ms
     * (Core's `streamBufferMs`). Kept natively, so the service follows it
     * without JS too; it applies from the player's next buffering decision.
     */
    AsyncFunction("setStreamBuffer") { aheadMs: Double, promise: Promise ->
      StreamBuffer.init(context)
      StreamBuffer.setChosen(aheadMs.toLong())
      promise.resolve(null)
    }.runOnQueue(Queues.MAIN)

    /**
     * The entry whose next song is an unsearched one still being searched (Core's
     * `searchingAfter`), or null: a crossfade from it waits for the search.
     */
    AsyncFunction("setSearchingAfter") { key: String?, promise: Promise ->
      CrossfadeLink.searchingAfter = key
      promise.resolve(null)
    }.runOnQueue(Queues.MAIN)

    /**
     * Applies Core's sync plan. Items already loaded are reused by key, so JS
     * only sends [items] for keys new to the player; [QueueSync] reads loaded
     * ones only when a step re-inserts them, so a skip doesn't walk the list.
     * [cause] is what the sync is (Core's `SongChangeCause`), which names a
     * song change it makes in the app log's crossfade lines; a sync that
     * changes no song names nothing.
     */
    AsyncFunction("applySync") { steps: List<SyncStepRecord>, items: List<PlayerItem>, cause: String?, promise: Promise ->
      withController(promise) { player ->
        val incoming = items.associate { it.id to toMediaItem(it) }
        val playlist = ControllerPlaylist(player)
        syncing = true
        QueueSnapshot.resumed = false
        try {
          val plan = steps.map { SyncStep.of(it.type, it.at, it.removeCount, it.keys, it.index, it.key) }
          CrossfadeLink.causes.sync(cause, SystemClock.elapsedRealtime(), { playlist.currentKey }) {
            QueueSync.apply(plan, playlist, incoming)
          }
          if (player.playbackState == Player.STATE_IDLE && player.mediaItemCount > 0) player.prepare()
          promise.resolve(null)
        } catch (error: IllegalArgumentException) {
          promise.reject("ERR_PLAYER_SYNC", error.message, error)
        } finally {
          syncing = false
        }
      }
    }.runOnQueue(Queues.MAIN)

    /**
     * Gives loaded items a cover cached after they were set (a YT Music song's
     * file in place of YouTube's address), so the notification, Auto and Now
     * Playing show the file. Same media ID and URI, so the player swaps each
     * item in place without interrupting playback. Keys it doesn't hold are skipped.
     */
    AsyncFunction("setItemArtwork") { updates: List<ItemArtworkRecord>, promise: Promise ->
      withController(promise) { player ->
        val byKey = updates.associate { it.key to it.artworkPath }
        syncing = true
        try {
          for (index in 0 until player.mediaItemCount) {
            val item = player.getMediaItemAt(index)
            val artworkPath = byKey[item.mediaId] ?: continue
            player.replaceMediaItem(index, PlayerMediaItems.withArtwork(item, artworkPath))
          }
          promise.resolve(null)
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

    /**
     * The queue's shuffle and repeat (`off`, `all` or `one`), after every change
     * made in the app or in the car: the service shows them on Auto's buttons.
     */
    AsyncFunction("setModes") { shuffle: Boolean, repeat: String, promise: Promise ->
      val modes = AutoModes.fromJs(shuffle, repeat)
        ?: return@AsyncFunction promise.reject("ERR_PLAYER_MODES", "Unknown repeat mode: $repeat", null)
      AutoModes.state.publish(modes)
      promise.resolve(null)
    }.runOnQueue(Queues.MAIN)

    /**
     * The chosen primary (`#rrggbb`) in each scheme, for the media notification
     * wherever the system colours it from the app ([NotificationAccent]).
     */
    AsyncFunction("setNotificationAccent") { light: String, dark: String, promise: Promise ->
      val colours = NotificationAccent.fromJs(light, dark)
        ?: return@AsyncFunction promise.reject("ERR_NOTIFICATION_ACCENT", "Not #rrggbb tones: $light, $dark", null)
      NotificationAccent.publish(context, colours)
      promise.resolve(null)
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

    /**
     * Keeps the queue for when JS comes back (see [QueueSnapshot]), and for a
     * cold start ([ResumeStore]), with where it was started from.
     */
    Function("saveQueue") { json: String, source: String? ->
      QueueSnapshot.json = json
      if (source != null) QueueSnapshot.source = source
      ResumeStore.saveQueue(json, source)
    }

    Function("savedQueue") { QueueSnapshot.json }

    Function("savedQueueSource") { QueueSnapshot.source }

    /** Whether the player resumed the saved queue on its own (see [QueueSnapshot.resumed]); clears it. */
    Function("takeResumed") {
      val resumed = QueueSnapshot.resumed
      QueueSnapshot.resumed = false
      resumed
    }

    AsyncFunction("play") { promise: Promise ->
      withController(promise) { player ->
        CrossfadeLink.pausedForSearch = false
        // A finished or failed item starts over.
        if (player.playbackState == Player.STATE_ENDED) player.seekToDefaultPosition()
        if (player.playbackState == Player.STATE_IDLE) player.prepare()
        player.play()
        promise.resolve(null)
      }
    }.runOnQueue(Queues.MAIN)

    /** [forSearch]: paused while the song to play is searched, as the app log's crossfade lines say. */
    AsyncFunction("pause") { forSearch: Boolean?, promise: Promise ->
      withController(promise) { player ->
        CrossfadeLink.pausedForSearch = forSearch == true
        player.pause()
        promise.resolve(null)
      }
    }.runOnQueue(Queues.MAIN)

    /** [source] is where the seek came from (Core's `SeekSource`), for the app log's crossfade lines. */
    AsyncFunction("seekTo") { positionMs: Double, source: String?, promise: Promise ->
      withController(promise) { player ->
        source?.let { CrossfadeLink.causes.noteApp(it, SystemClock.elapsedRealtime()) }
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

    /** The Lyrics toggle on Auto's player screen and whether Auto is connected; `onAutoLyrics` reports changes. */
    AsyncFunction("getAutoLyrics") { promise: Promise ->
      followAutoLyrics()
      promise.resolve(autoLyrics())
    }.runOnQueue(Queues.MAIN)

    /**
     * Shows [text] as the title and artist of item [itemId] on Auto's player
     * screen, or its own title and artist again with null (see [AutoLyrics]).
     */
    AsyncFunction("setAutoLyricsText") { itemId: String?, text: AutoLyricsTextRecord?, promise: Promise ->
      AutoLyrics.state.showText(itemId, text?.let { LyricsText(it.title, it.artist) })
      promise.resolve(null)
    }.runOnQueue(Queues.MAIN)

    OnDestroy {
      AutoLibrary.bridge.detach()
      main.post {
        stopAutoLyrics?.invoke()
        stopAutoLyrics = null
        if (CrossfadeLink.onFadeEnded === fadeEnded) CrossfadeLink.onFadeEnded = null
        main.removeCallbacks(positionTicker)
        controller?.removeListener(listener)
        controllerFuture?.let(MediaController::releaseFuture)
        controller = null
        controllerFuture = null
      }
    }
  }

  private val fadeEnded: (Long) -> Unit = { at -> sendEvent("onCrossfade", mapOf("at" to at.toDouble())) }

  /**
   * Reports the end of each crossfade's fade to JS. A handoff from before this
   * module was made went unreported, so it isn't taken for a later one.
   */
  private fun followCrossfade() {
    CrossfadeLink.handoff.clear()
    CrossfadeLink.onFadeEnded = fadeEnded
  }

  /** Stops reporting [AutoLyrics.state]; null while not following it. */
  private var stopAutoLyrics: (() -> Unit)? = null

  /** The toggle and connection last reported, so new lines don't echo back to JS. */
  private var reportedAutoLyrics: Map<String, Boolean>? = null

  private fun autoLyrics(): Map<String, Boolean> =
    mapOf("on" to AutoLyrics.state.on, "carConnected" to AutoLyrics.state.carConnected)

  /** Reports the Lyrics toggle and Auto's connection to JS as they change. Main thread. */
  private fun followAutoLyrics() {
    if (stopAutoLyrics != null) return
    AutoLyrics.state.init(PreferencesLyricsToggleStore(context))
    reportedAutoLyrics = autoLyrics()
    stopAutoLyrics = AutoLyrics.state.listen {
      val current = autoLyrics()
      if (current != reportedAutoLyrics) {
        reportedAutoLyrics = current
        sendEvent("onAutoLyrics", current)
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

  private fun toMediaItem(item: PlayerItem): MediaItem =
    PlayerMediaItems.build(item.id, item.path, item.title, item.artist, item.album, item.artworkPath)

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
          "artworkUri" to PlayerMediaItems.appArtworkUri(it.mediaMetadata),
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
