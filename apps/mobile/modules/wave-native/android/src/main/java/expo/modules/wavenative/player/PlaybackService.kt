package expo.modules.wavenative.player

import android.app.PendingIntent
import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.Process
import android.os.SystemClock
import android.util.Log
import androidx.annotation.OptIn
import androidx.car.app.connection.CarConnection
import androidx.lifecycle.LiveData
import androidx.lifecycle.Observer
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.common.util.Util
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionError
import androidx.media3.session.SessionResult
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.FutureCallback
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import expo.modules.wavenative.artwork.ArtworkProvider
import expo.modules.wavenative.launcher.LauncherIconSwitcher
import expo.modules.wavenative.log.WaveLog
import expo.modules.wavenative.yt.YtClient
import expo.modules.wavenative.yt.YtDataSource
import expo.modules.wavenative.yt.YtMedia
import expo.modules.wavenative.yt.YtStreamFailure
import java.util.Locale

/**
 * Hosts the player. Media3 provides the media notification, lock-screen and
 * Bluetooth/headset controls through the session, and the player handles
 * audio focus and pauses when headphones disconnect (becoming noisy). The
 * notification shows Wave's two waves in the chosen primary
 * ([WaveNotificationProvider]).
 *
 * The sleep timer runs here too, so it pauses playback with Wave in the
 * background (the JS side may be suspended by then).
 *
 * It is a media library service so Android Auto can browse Wave: the root is
 * answered here, and other browse requests go to JS over [AutoLibrary.bridge],
 * starting the JS runtime headless first when Wave isn't running ([JsRuntime]).
 * A page JS answers only after Auto gave up on it is reloaded in Auto
 * ([AutoLibrary.onChildrenRecovered]). Auto's play requests
 * go to JS too, whose queue engine answers with the items to play
 * ([SessionCallback.onSetMediaItems]).
 *
 * The player's state is kept on disk ([ResumeStore]), so after Wave's process
 * died, Auto and the system media controls can resume the last queue before
 * JS is up ([SessionCallback.onPlaybackResumption]).
 *
 * While Auto is connected and its Lyrics toggle is on, the session's artwork
 * shows the lyrics JS sends, drawn over the cover ([AutoLyrics],
 * [LyricArtworkPlayer]).
 *
 * With Crossfade on, a second player plays the outgoing song's last seconds
 * while the session's player moves on to the next one ([Crossfade]).
 */
class PlaybackService : MediaLibraryService() {
  private var session: MediaLibrarySession? = null

  /** Controllers browsing the library (Auto); JS is kept running while there are any. */
  private val browsers = mutableSetOf<MediaSession.ControllerInfo>()
  private var exoPlayer: ExoPlayer? = null
  private val main = Handler(Looper.getMainLooper())

  private val sleepCheck: Runnable = Runnable { sleepTimer.onCheck() }

  private val sleepTimer: SleepTimer = SleepTimer(
    object : SleepTimerHost {
      override fun nowMs() = System.currentTimeMillis()

      override fun pause() {
        exoPlayer?.pause()
      }

      override fun setPauseAtEndOfItems(enabled: Boolean) {
        exoPlayer?.pauseAtEndOfMediaItems = enabled
      }

      // While playing, the player's wake lock keeps the CPU (and so this
      // handler) running; while paused, a late check changes nothing.
      override fun scheduleCheck(delayMs: Long) {
        main.removeCallbacks(sleepCheck)
        main.postDelayed(sleepCheck, delayMs)
      }

      override fun cancelCheck() {
        main.removeCallbacks(sleepCheck)
      }

      override fun onChanged(mode: SleepTimerMode?) {
        session?.setSessionExtras(SleepTimerSession.toBundle(mode))
      }
    },
  )

  /** Tells the sleep timer when a track finishes and when playback starts. */
  private val sleepTimerListener = object : Player.Listener {
    override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
      if (!playWhenReady && reason == Player.PLAY_WHEN_READY_CHANGE_REASON_END_OF_MEDIA_ITEM) {
        sleepTimer.onPausedAtEndOfItem()
      }
    }

    override fun onPlaybackStateChanged(playbackState: Int) {
      if (playbackState == Player.STATE_ENDED) sleepTimer.onEnded()
    }

    override fun onIsPlayingChanged(isPlaying: Boolean) {
      if (isPlaying) sleepTimer.onResumed()
    }
  }

  /** Keeps the resume snapshot up to date with the player. */
  private val resumeListener = object : Player.Listener {
    override fun onEvents(player: Player, events: Player.Events) {
      if (events.contains(Player.EVENT_TIMELINE_CHANGED)) {
        ResumeStore.savePlayer(player, withItems = true)
      } else if (events.containsAny(*RESUME_EVENTS)) {
        ResumeStore.savePlayer(player, withItems = false)
      }
    }

    override fun onIsPlayingChanged(isPlaying: Boolean) {
      main.removeCallbacks(resumePositionSave)
      if (isPlaying) main.postDelayed(resumePositionSave, RESUME_SAVE_INTERVAL_MS)
    }
  }

  /** Whether playback paused because a YT Music song couldn't stream; moving on plays again. */
  private var pausedOnStreamFailure = false

  /**
   * Streaming: keeps Wi-Fi awake while a YT Music song plays, and pauses on
   * one that can't stream (offline, YT Music off, a song YouTube won't serve)
   * instead of sitting idle as if playing; JS shows why. Skipping on (from
   * Wave, the notification, Bluetooth) plays the next song, Library or not.
   */
  private val streamListener = object : Player.Listener {
    override fun onPlayerError(error: PlaybackException) {
      if (YtStreamFailure.codeOf(error.cause?.message) == null) return
      pausedOnStreamFailure = true
      exoPlayer?.pause()
    }

    override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
      val player = exoPlayer ?: return
      val streamed = YtMedia.videoIdOf(mediaItem?.localConfiguration?.uri?.toString() ?: "") != null
      player.setWakeMode(if (streamed) C.WAKE_MODE_NETWORK else C.WAKE_MODE_LOCAL)
      if (pausedOnStreamFailure && reason == Player.MEDIA_ITEM_TRANSITION_REASON_SEEK) {
        pausedOnStreamFailure = false
        if (player.playbackState == Player.STATE_IDLE) player.prepare()
        player.play()
      }
    }

    override fun onIsPlayingChanged(isPlaying: Boolean) {
      if (isPlaying) pausedOnStreamFailure = false
    }
  }

  /** Builds a player: the session's, or the tail a crossfade plays the outgoing song on. */
  @OptIn(UnstableApi::class)
  private fun buildPlayer(forSession: Boolean): ExoPlayer {
    // Library files play from storage; YT Music songs (`yt:` items) are streamed,
    // their address resolved as the player loads them (YtDataSource).
    val dataSources = YtDataSource.Factory(
      DefaultDataSource.Factory(this, DefaultHttpDataSource.Factory().setAllowCrossProtocolRedirects(true)),
    ) { YtClient.get(this) }
    return ExoPlayer.Builder(this, WaveRenderersFactory(this))
      .setMediaSourceFactory(DefaultMediaSourceFactory(dataSources))
      // The tail follows the session's player, which alone holds audio focus.
      .setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(C.USAGE_MEDIA)
          .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
          .build(),
        /* handleAudioFocus = */ forSession,
      )
      .setHandleAudioBecomingNoisy(forSession)
      .setWakeMode(if (forSession) C.WAKE_MODE_LOCAL else C.WAKE_MODE_NONE)
      .build()
  }

  /** The player the outgoing song fades out on during a crossfade; null otherwise. */
  private var tailPlayer: ExoPlayer? = null

  private val crossfade = Crossfade(
    object : CrossfadeHost {
      override val main: CrossfadeDeck = object : CrossfadeDeck {
        override val positionMs get() = exoPlayer?.currentPosition ?: 0L
        override val isPlaying get() = exoPlayer?.isPlaying == true
        override val ended get() = exoPlayer?.playbackState == Player.STATE_ENDED

        override fun setVolume(volume: Float) {
          exoPlayer?.volume = volume
        }

        override fun setSpeed(speed: Float) {
          exoPlayer?.setPlaybackSpeed(speed)
        }

        override fun seekTo(positionMs: Long) {
          exoPlayer?.seekTo(positionMs)
        }

        override fun setPlaying(playing: Boolean) {
          exoPlayer?.playWhenReady = playing
        }
      }

      override val mainDurationMs: Long?
        get() = exoPlayer?.duration?.takeIf { it != C.TIME_UNSET && it > 0 }

      override val mainWantsToPlay: Boolean
        get() = exoPlayer?.let {
          it.playWhenReady && it.playbackSuppressionReason == Player.PLAYBACK_SUPPRESSION_REASON_NONE
        } == true

      override val movesOnNaturally: Boolean
        get() {
          val player = exoPlayer ?: return false
          val next = player.nextMediaItemIndex
          // An end-of-song sleep timer pauses there, with nothing of the next song.
          return player.repeatMode != Player.REPEAT_MODE_ONE && !player.pauseAtEndOfMediaItems &&
            next != C.INDEX_UNSET && next != player.currentMediaItemIndex
        }

      // The player loads the next song once this one is loaded (a preload
      // started it earlier, [prefetchNext]), so what's buffered past this
      // song's end is the next one's start.
      override val nextReady: Boolean
        get() {
          val player = exoPlayer ?: return false
          // The next song is an unsearched one JS is still searching: the player's next isn't it.
          if (searchingNext()) return false
          val durationMs = mainDurationMs ?: return false
          return player.totalBufferedDuration - (durationMs - player.currentPosition) >= NEXT_READY_MS
        }

      override val currentKey: String?
        get() = exoPlayer?.currentMediaItem?.mediaId

      override val nextKey: String?
        get() {
          val player = exoPlayer ?: return null
          val next = player.nextMediaItemIndex
          return if (next == C.INDEX_UNSET) null else player.getMediaItemAt(next).mediaId
        }

      // Preloads the next playlist item while this one plays: a YT Music
      // song's address is resolved (YtDataSource) and its start buffered.
      // Off again once the player moves (crossfadeListener).
      @OptIn(UnstableApi::class)
      override fun prefetchNext() {
        exoPlayer?.preloadConfiguration = ExoPlayer.PreloadConfiguration(Util.msToUs(PRELOAD_MS))
      }

      override fun nextLate(lateMs: Long, overlapMs: Long) {
        val late =
          if (searchingNext()) "the next song was still being searched after ${seconds(lateMs)}"
          else "the next song was ${seconds(lateMs)} late"
        WaveLog.i(
          CROSSFADE_LOG_TAG,
          if (overlapMs > 0) "Crossfade shortened to ${seconds(overlapMs)}: $late"
          else "Crossfade dropped, the song ended gapless: $late",
        )
      }

      override fun endedEarly(why: CrossfadeEnd, overlapping: Boolean) {
        WaveLog.i(
          CROSSFADE_LOG_TAG,
          if (overlapping) "Crossfade ended early: ${why.reason}"
          else "Crossfade called off before the overlap: ${why.reason}",
        )
      }

      override fun openTail(positionMs: Long): CrossfadeDeck {
        closeTail()
        val tail = buildPlayer(forSession = false)
        exoPlayer?.currentMediaItem?.let { tail.setMediaItem(it, positionMs) }
        tail.playWhenReady = true
        tail.prepare()
        tailPlayer = tail
        return object : CrossfadeDeck {
          override val positionMs get() = tail.currentPosition
          override val isPlaying get() = tail.isPlaying
          override val ended get() = tail.playbackState == Player.STATE_ENDED

          override fun setVolume(volume: Float) {
            tail.volume = volume
          }

          override fun setSpeed(speed: Float) {
            tail.setPlaybackSpeed(speed)
          }

          override fun seekTo(positionMs: Long) {
            tail.seekTo(positionMs)
          }

          override fun setPlaying(playing: Boolean) {
            tail.playWhenReady = playing
          }
        }
      }

      override fun closeTail() {
        tailPlayer?.release()
        tailPlayer = null
      }

      override fun advance() {
        val player = exoPlayer ?: return
        val next = player.nextMediaItemIndex
        if (next == C.INDEX_UNSET) return
        val key = player.getMediaItemAt(next).mediaId
        CrossfadeLink.handoff.mark(key, SystemClock.elapsedRealtime())
        player.seekTo(next, 0)
      }

      override fun fadeEnded() {
        CrossfadeLink.onFadeEnded?.invoke(System.currentTimeMillis())
      }
    },
  )

  private val crossfadeTick: Runnable = Runnable { scheduleCrossfade(crossfade.tick()) }

  /** Whether JS is still searching the song after the one playing (`CrossfadeLink.searchingAfter`). */
  private fun searchingNext(): Boolean {
    val after = CrossfadeLink.searchingAfter ?: return false
    return after == exoPlayer?.currentMediaItem?.mediaId
  }

  /** Runs the crossfade's next tick after [delayMs] (null: none until playback changes). */
  private fun scheduleCrossfade(delayMs: Long? = 0L) {
    main.removeCallbacks(crossfadeTick)
    if (delayMs != null) main.postDelayed(crossfadeTick, delayMs)
  }

  /**
   * Hands the crossfade play and pause, and every move of the player: one to
   * another song than the one being faded into (skip, previous, picking a
   * song, the next song replaced), a seek or an error switches at once, while
   * the crossfade's own move and queue syncs around it don't. Ticks are
   * posted, never run inside a listener, so the crossfade's own move is
   * reported before the next tick.
   */
  private val crossfadeListener = object : Player.Listener {
    @OptIn(UnstableApi::class)
    override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
      // The song after this one is preloaded only once this one nears its overlap; a queue sync
      // reporting the same song again keeps a preload already asked for.
      val restarted = reason == Player.MEDIA_ITEM_TRANSITION_REASON_REPEAT
      if (crossfade.moved(mediaItem?.mediaId, restarted)) {
        exoPlayer?.preloadConfiguration = ExoPlayer.PreloadConfiguration.DEFAULT
      }
      scheduleCrossfade()
    }

    override fun onPositionDiscontinuity(
      oldPosition: Player.PositionInfo,
      newPosition: Player.PositionInfo,
      reason: Int,
    ) {
      val within = PlayerEvents.isSeekWithinItem(reason, oldPosition.mediaItem?.mediaId, newPosition.mediaItem?.mediaId)
      if (within) crossfade.interrupt(CrossfadeEnd.Seek)
    }

    override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
      crossfade.onPlayingChanged()
      scheduleCrossfade()
    }

    override fun onPlaybackSuppressionReasonChanged(playbackSuppressionReason: Int) {
      crossfade.onPlayingChanged()
      scheduleCrossfade()
    }

    override fun onIsPlayingChanged(isPlaying: Boolean) {
      scheduleCrossfade()
    }

    override fun onPlayerError(error: PlaybackException) {
      crossfade.interrupt(CrossfadeEnd.Error)
    }
  }

  /** Brings the snapshot's position up to date while playing, should the process die. */
  private val resumePositionSave: Runnable = object : Runnable {
    override fun run() {
      val player = exoPlayer ?: return
      ResumeStore.savePlayer(player, withItems = false)
      if (player.isPlaying) main.postDelayed(this, RESUME_SAVE_INTERVAL_MS)
    }
  }

  @OptIn(UnstableApi::class)
  override fun onCreate() {
    super.onCreate()
    ResumeStore.init(this)
    val player = buildPlayer(forSession = true)
    player.addListener(sleepTimerListener)
    player.addListener(resumeListener)
    player.addListener(streamListener)
    player.addListener(crossfadeListener)
    exoPlayer = player
    CrossfadeLink.init(this)
    crossfade.overlapMs = CrossfadeLink.overlapMs
    CrossfadeLink.onOverlapChanged = { overlapMs ->
      crossfade.overlapMs = overlapMs
      scheduleCrossfade()
    }
    NotificationAccent.init(this)
    setMediaNotificationProvider(WaveNotificationProvider(this))
    stopAccent = NotificationAccent.state.listen { triggerNotificationUpdate() }
    AutoLyrics.state.init(PreferencesLyricsToggleStore(this))
    val shown = LyricArtworkPlayer(player) { itemId, cover ->
      ArtworkProvider.authority?.let { AutoLyrics.artworks.uriFor(it, AutoLyrics.state.linesFor(itemId), cover) }
    }
    session = MediaLibrarySession.Builder(this, shown, SessionCallback())
      .apply { openAppIntent()?.let(::setSessionActivity) }
      .build()
    showModes(AutoModes.state.current)
    stopModes = AutoModes.state.listen(::showModes)
    stopLyrics = AutoLyrics.state.listen {
      shown.refresh()
      showModes(AutoModes.state.current)
    }
    carConnection = CarConnection(this).type.also { it.observeForever(carConnectionObserver) }
    AutoLibrary.onChildrenRecovered = { parentId ->
      // The count is unknown here; Auto asks for the pages again.
      main.post { session?.notifyChildrenChanged(parentId, Int.MAX_VALUE, null) }
    }
  }

  /** Stops following JS's shuffle and repeat ([AutoModes.state]). */
  private var stopModes: (() -> Unit)? = null

  /** Stops following the Lyrics toggle and lines ([AutoLyrics.state]). */
  private var stopLyrics: (() -> Unit)? = null

  /** Whether Android Auto is connected (projected on a car's screen, or Android Automotive). */
  private var carConnection: LiveData<Int>? = null
  private val carConnectionObserver = Observer<Int> { type ->
    AutoLyrics.state.setCarConnected(type != CarConnection.CONNECTION_TYPE_NOT_CONNECTED)
  }

  /** Stops redrawing the notification when the primary changes ([NotificationAccent.state]). */
  private var stopAccent: (() -> Unit)? = null

  /** The notification takes the primary's tone for the scheme, so a scheme change redraws it. */
  @OptIn(UnstableApi::class)
  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    triggerNotificationUpdate()
  }

  /**
   * Shows the queue's shuffle and repeat on the mode buttons (Auto's player
   * screen), with More from this artist and the Lyrics toggle after them.
   */
  private fun showModes(modes: PlaybackModes) {
    session?.setMediaButtonPreferences(
      AutoModesSession.buttons(modes) + MoreFromArtistSession.button +
        AutoLyricsSession.button(AutoLyrics.state.on),
    )
  }

  /**
   * The controllers that show the shuffle and repeat buttons: Auto, and the
   * media notification, whose buttons legacy controllers (Auto on a phone) share.
   */
  private fun showsModeButtons(session: MediaSession, controller: MediaSession.ControllerInfo) =
    session.isAutoCompanionController(controller) ||
      session.isAutomotiveController(controller) ||
      session.isMediaNotificationController(controller)

  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession? = session

  /** Logs bind times for the Auto spike's measurements (docs/auto-spike.md). */
  override fun onBind(intent: Intent?): IBinder? {
    Log.i(
      JsRuntime.LOG_TAG,
      "Bound (${intent?.action}) at ${SystemClock.elapsedRealtime()} ms; " +
        "process started at ${Process.getStartElapsedRealtime()} ms",
    )
    return super.onBind(intent)
  }

  /** Starts JS (headless if needed) and keeps it running while [controller] browses. */
  private fun keepJsFor(controller: MediaSession.ControllerInfo) {
    browsers += controller
    JsRuntime.ensureStarted(this)
  }

  /** Keeps playing after Wave is swiped away; otherwise there's nothing to keep the service for. */
  override fun onTaskRemoved(rootIntent: Intent?) {
    val player = session?.player
    if (player == null || !player.playWhenReady || player.mediaItemCount == 0 ||
      player.playbackState == Player.STATE_ENDED
    ) {
      stopSelf()
    }
  }

  override fun onDestroy() {
    stopModes?.invoke()
    stopModes = null
    stopAccent?.invoke()
    stopAccent = null
    stopLyrics?.invoke()
    stopLyrics = null
    carConnection?.removeObserver(carConnectionObserver)
    carConnection = null
    AutoLyrics.state.setCarConnected(false)
    AutoLibrary.onChildrenRecovered = null
    browsers.clear()
    JsRuntime.release()
    main.removeCallbacks(sleepCheck)
    main.removeCallbacks(resumePositionSave)
    main.removeCallbacks(crossfadeTick)
    CrossfadeLink.onOverlapChanged = null
    crossfade.interrupt(CrossfadeEnd.Stopped)
    exoPlayer?.let { ResumeStore.savePlayer(it, withItems = false) }
    exoPlayer = null
    session?.run {
      player.release()
      release()
    }
    session = null
    super.onDestroy()
  }

  /**
   * Tapping the notification opens Wave. It points at MainActivity rather than
   * the launcher icon's alias, which a theme change can turn off.
   */
  private fun openAppIntent(): PendingIntent? {
    val launch = packageManager.getLaunchIntentForPackage(packageName) ?: return null
    launch.component?.let { launch.component = LauncherIconSwitcher.launchTarget(packageManager, it) }
    return PendingIntent.getActivity(
      this,
      0,
      launch,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }

  @OptIn(UnstableApi::class)
  private inner class SessionCallback : MediaLibrarySession.Callback {
    /**
     * Wave's own controller (the JS module) may also start and cancel the sleep
     * timer. Auto gets the default library commands, and its connection starts
     * JS right away, ahead of its first browse request.
     */
    override fun onConnect(
      session: MediaSession,
      controller: MediaSession.ControllerInfo,
    ): MediaSession.ConnectionResult {
      val result = MediaSession.ConnectionResult.AcceptedResultBuilder(session, controller)
      if (controller.packageName == packageName) {
        result.setAvailableSessionCommands(
          MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS.buildUpon()
            .add(SleepTimerSession.START)
            .add(SleepTimerSession.CANCEL)
            .build(),
        )
      } else if (session.isAutoCompanionController(controller) || session.isAutomotiveController(controller)) {
        Log.i(JsRuntime.LOG_TAG, "Auto connected at ${SystemClock.elapsedRealtime()} ms")
        keepJsFor(controller)
      }
      // Shuffle and repeat are custom commands for JS's queue engine; the player's own stay unused.
      if (showsModeButtons(session, controller)) {
        result
          .setAvailableSessionCommands(
            AutoLyricsSession.withCommand(MoreFromArtistSession.withCommand(AutoModesSession.sessionCommands)),
          )
          .setAvailablePlayerCommands(AutoModesSession.playerCommands)
      }
      return result.build()
    }

    override fun onDisconnected(session: MediaSession, controller: MediaSession.ControllerInfo) {
      if (browsers.remove(controller) && browsers.isEmpty()) JsRuntime.release()
    }

    override fun onGetLibraryRoot(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      params: LibraryParams?,
    ): ListenableFuture<LibraryResult<MediaItem>> {
      Log.i(JsRuntime.LOG_TAG, "Root requested at ${SystemClock.elapsedRealtime()} ms by ${browser.packageName}")
      keepJsFor(browser)
      return AutoLibrary.root(params)
    }

    /**
     * Accepts every subscription without asking JS (the default asks [onGetItem]):
     * a subscription failing on a cold start would stop
     * [AutoLibrary.onChildrenRecovered] from reaching Auto.
     */
    override fun onSubscribe(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      parentId: String,
      params: LibraryParams?,
    ): ListenableFuture<LibraryResult<Void>> {
      keepJsFor(browser)
      return Futures.immediateFuture(LibraryResult.ofVoid(params))
    }

    override fun onGetChildren(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      parentId: String,
      page: Int,
      pageSize: Int,
      params: LibraryParams?,
    ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
      keepJsFor(browser)
      return AutoLibrary.children(parentId, page, pageSize, params)
    }

    override fun onGetItem(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      mediaId: String,
    ): ListenableFuture<LibraryResult<MediaItem>> {
      keepJsFor(browser)
      return AutoLibrary.item(mediaId)
    }

    /**
     * Wave's own controller sets items it built itself (see [onAddMediaItems]).
     * Anything else (Auto playing a node of the browse tree) names a media ID:
     * JS starts that queue through its queue engine and answers with the
     * player items. A request JS can't serve sends Auto its message and
     * changes nothing.
     */
    override fun onSetMediaItems(
      mediaSession: MediaSession,
      controller: MediaSession.ControllerInfo,
      mediaItems: MutableList<MediaItem>,
      startIndex: Int,
      startPositionMs: Long,
    ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
      if (controller.packageName == packageName) {
        return super.onSetMediaItems(mediaSession, controller, mediaItems, startIndex, startPositionMs)
      }
      val requested = mediaItems.getOrNull(startIndex) ?: mediaItems.firstOrNull()
        ?: return Futures.immediateFailedFuture(AutoPlayException("Nothing to play."))
      keepJsFor(controller)
      return AutoLibrary.play(requested.mediaId)
        .alsoReportFailure(mediaSession, controller, "play ${requested.mediaId}")
    }

    /**
     * Sends [controller] the message of a failed play or add request, so Auto
     * shows it; the session itself changes nothing.
     */
    private fun <T> ListenableFuture<T>.alsoReportFailure(
      mediaSession: MediaSession,
      controller: MediaSession.ControllerInfo,
      what: String,
    ): ListenableFuture<T> {
      Futures.addCallback(
        this,
        object : FutureCallback<T> {
          override fun onSuccess(result: T) = Unit

          override fun onFailure(error: Throwable) {
            WaveLog.w(JsRuntime.LOG_TAG, "Couldn't $what", error)
            mediaSession.sendError(
              controller,
              SessionError(SessionError.ERROR_UNKNOWN, error.message ?: AutoBridge.STILL_LOADING),
            )
          }
        },
        mainExecutor,
      )
      return this
    }

    override fun onCustomCommand(
      session: MediaSession,
      controller: MediaSession.ControllerInfo,
      customCommand: SessionCommand,
      args: Bundle,
    ): ListenableFuture<SessionResult> {
      // The Lyrics toggle: JS hears of it and sends lines while it's on.
      if (customCommand.customAction == AutoLyrics.TOGGLE_ACTION) {
        AutoLyrics.state.toggle()
        return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
      }
      // A shuffle or repeat button: JS's queue engine changes the mode and reports it back.
      // More from this artist: JS's queue engine adds the songs.
      val action = customCommand.customAction
      (AutoModes.request(action) ?: MoreFromArtist.request(action))?.let { request ->
        if (session.isAutoCompanionController(controller) || session.isAutomotiveController(controller)) {
          keepJsFor(controller)
        }
        return AutoLibrary.command(request)
      }
      val code = when (action) {
        SleepTimerSession.START.customAction ->
          SleepTimerSession.fromBundle(args)
            ?.let { sleepTimer.start(it); SessionResult.RESULT_SUCCESS }
            ?: SessionError.ERROR_BAD_VALUE
        SleepTimerSession.CANCEL.customAction -> {
          sleepTimer.cancel()
          SessionResult.RESULT_SUCCESS
        }
        else -> SessionError.ERROR_NOT_SUPPORTED
      }
      return Futures.immediateFuture(SessionResult(code))
    }

    /**
     * Resumes the last queue from the snapshot ([ResumeStore]) when a
     * controller asks to play with nothing loaded: Auto or the system media
     * controls after Wave's process died, before JS is up. The queue JS saved
     * with it is kept for JS to adopt when it comes up (see [QueueSnapshot]).
     */
    override fun onPlaybackResumption(
      mediaSession: MediaSession,
      controller: MediaSession.ControllerInfo,
      isForPlayback: Boolean,
    ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
      val byAuto = mediaSession.isAutoCompanionController(controller) ||
        mediaSession.isAutomotiveController(controller)
      if (byAuto) keepJsFor(controller)
      return Futures.transform(
        ResumeStore.load(),
        { snapshot ->
          val resumption = PlaybackResumption.plan(snapshot, byAuto) {
            PlayerMediaItems.build(it.id, it.path, it.title, it.artist, it.album, it.artworkPath)
          } ?: throw UnsupportedOperationException("Nothing to resume")
          if (isForPlayback) {
            mediaSession.player.repeatMode = resumption.repeatMode
            mediaSession.player.shuffleModeEnabled = false
            // Auto's buttons show the resumed modes before JS is up to publish them.
            snapshot?.let { saved ->
              AutoModes.fromJs(saved.shuffle, saved.repeat)?.let(AutoModes.state::publish)
            }
            QueueSnapshot.json = snapshot?.queueJson
            QueueSnapshot.source = resumption.source
            QueueSnapshot.resumed = true
          }
          Log.i(JsRuntime.LOG_TAG, "Resuming ${resumption.items.size} items at ${resumption.startIndex}")
          MediaSession.MediaItemsWithStartPosition(resumption.items, resumption.startIndex, resumption.positionMs)
        },
        mainExecutor,
      )
    }

    /**
     * Items from Wave's own controller may arrive without their local
     * configuration; Wave puts the file URI in the request metadata so the
     * session can rebuild it. Anything else (Auto adding a node of the browse
     * tree to the queue) names media IDs: JS adds them through its queue
     * engine, which puts them on the player itself, so the session adds
     * nothing here. A request JS can't serve sends Auto its message.
     */
    override fun onAddMediaItems(
      mediaSession: MediaSession,
      controller: MediaSession.ControllerInfo,
      mediaItems: MutableList<MediaItem>,
    ): ListenableFuture<MutableList<MediaItem>> {
      if (controller.packageName != packageName) {
        keepJsFor(controller)
        val mediaIds = mediaItems.map { it.mediaId }
        return AutoLibrary.add(mediaIds).alsoReportFailure(mediaSession, controller, "add $mediaIds")
      }
      return Futures.immediateFuture(
        mediaItems.mapTo(mutableListOf()) { item ->
          val uri: Uri? = item.localConfiguration?.uri ?: item.requestMetadata.mediaUri
          if (item.localConfiguration != null || uri == null) item else item.buildUpon().setUri(uri).build()
        },
      )
    }
  }

  private companion object {
    /** Player changes that move the snapshot's current item, position or repeat. */
    val RESUME_EVENTS = intArrayOf(
      Player.EVENT_MEDIA_ITEM_TRANSITION,
      Player.EVENT_IS_PLAYING_CHANGED,
      Player.EVENT_POSITION_DISCONTINUITY,
      Player.EVENT_REPEAT_MODE_CHANGED,
    )

    const val RESUME_SAVE_INTERVAL_MS = 10_000L

    const val CROSSFADE_LOG_TAG = "WaveCrossfade"

    /** Buffered of the next song for it to sound at once (ExoPlayer's default to start playing). */
    const val NEXT_READY_MS = 2500L

    /** How much of the next song a crossfade preloads. */
    const val PRELOAD_MS = 10_000L

    fun seconds(ms: Long) = String.format(Locale.ROOT, "%.1f s", ms / 1000.0)
  }
}
