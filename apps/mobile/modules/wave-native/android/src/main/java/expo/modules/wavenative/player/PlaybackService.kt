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
import android.view.KeyEvent
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
import androidx.media3.datasource.DataSourceBitmapLoader
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.CacheBitmapLoader
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
import expo.modules.wavenative.launcher.LauncherIconSwitcher
import expo.modules.wavenative.log.WaveLog
import expo.modules.wavenative.yt.YtAudioCache
import expo.modules.wavenative.yt.YtClient
import expo.modules.wavenative.yt.YtDataSource
import expo.modules.wavenative.yt.YtMedia
import expo.modules.wavenative.yt.YtStreamFailure

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
 * While Auto is connected and its Lyrics toggle is on, the session's title and
 * artist show the lyrics JS sends ([AutoLyrics], [LyricsTextPlayer]).
 *
 * With Crossfade on, the next song opens on a second player ahead of the
 * overlap; at the handoff that player becomes the session's, and the one it
 * replaces fades the outgoing song out ([Crossfade], [promoteNext]).
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
      player.setWakeMode(if (streams(mediaItem)) C.WAKE_MODE_NETWORK else C.WAKE_MODE_LOCAL)
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

  /**
   * Builds a player: the session's, or the one a crossfade opens the next song
   * on, which becomes the session's at the handoff ([takeSession]).
   */
  @OptIn(UnstableApi::class)
  private fun buildPlayer(): ExoPlayer {
    // Library files play from storage; YT Music songs (`yt:` items) are streamed,
    // their address resolved as the player loads them (YtDataSource), their audio
    // kept in the audio cache, which both players share (YtAudioCache).
    val dataSources = YtDataSource.Factory(
      DefaultDataSource.Factory(this, DefaultHttpDataSource.Factory().setAllowCrossProtocolRedirects(true)),
      audioCache = { YtAudioCache.get(this) },
    ) { YtClient.get(this) }
    return ExoPlayer.Builder(this, WaveRenderersFactory(this))
      // Keeps the Buffer setting's streamed audio ahead (StreamBuffer).
      .setLoadControl(StreamLoadControl())
      .setMediaSourceFactory(DefaultMediaSourceFactory(dataSources))
      // Only the session's player holds audio focus ([takeSession]); the other follows it.
      .setAudioAttributes(MUSIC, /* handleAudioFocus = */ false)
      .setWakeMode(C.WAKE_MODE_NONE)
      .build()
  }

  /** The session's player's listeners, which move with the role at a crossfade's handoff. */
  private val sessionListeners: List<Player.Listener>
    get() = listOf(sleepTimerListener, resumeListener, streamListener, crossfadeListener)

  /**
   * Makes [player] the session's player: audio focus, becoming noisy, the wake
   * lock and the service's listeners. [from] is the one it replaces, which
   * gives them up first, so the two never compete for audio focus.
   */
  private fun takeSession(player: ExoPlayer, from: ExoPlayer?) {
    from?.let { old ->
      sessionListeners.forEach(old::removeListener)
      old.setAudioAttributes(MUSIC, /* handleAudioFocus = */ false)
      old.setHandleAudioBecomingNoisy(false)
      old.setWakeMode(C.WAKE_MODE_NONE)
    }
    player.setAudioAttributes(MUSIC, /* handleAudioFocus = */ true)
    player.setHandleAudioBecomingNoisy(true)
    player.setWakeMode(if (streams(player.currentMediaItem)) C.WAKE_MODE_NETWORK else C.WAKE_MODE_LOCAL)
    sessionListeners.forEach(player::addListener)
    exoPlayer = player
  }

  /** Whether [item] is a streamed YT Music song. */
  private fun streams(item: MediaItem?) = YtMedia.videoIdOf(item?.localConfiguration?.uri?.toString() ?: "") != null

  /** The player the media session shows ([LyricsTextPlayer] over [exoPlayer]). */
  private var shown: LyricsTextPlayer? = null

  private fun showOnSession(player: ExoPlayer): LyricsTextPlayer =
    LyricsTextPlayer(player, AutoLyrics.state::textFor).also { shown = it }

  /**
   * A crossfade's handoff: the second player, already playing the next song,
   * becomes the session's player with no seek. It gets the rest of the queue
   * around its song (inserting around the playing item doesn't interrupt it),
   * the repeat mode and the end-of-song sleep timer, audio focus and the
   * listeners; the media session, and so the notification, Auto and Wave's
   * own controller, switch to it. The player it replaces keeps only the
   * outgoing song, so it stops at its end, and becomes the second player.
   */
  private fun promoteNext(): ExoPlayer? {
    val old = exoPlayer ?: return null
    val incoming = secondPlayer ?: return null
    val next = old.nextMediaItemIndex
    if (next == C.INDEX_UNSET) return null
    val count = old.mediaItemCount
    incoming.addMediaItems(0, (0 until next).map(old::getMediaItemAt))
    incoming.addMediaItems((next + 1 until count).map(old::getMediaItemAt))
    incoming.repeatMode = old.repeatMode
    incoming.shuffleModeEnabled = old.shuffleModeEnabled
    incoming.pauseAtEndOfMediaItems = old.pauseAtEndOfMediaItems
    takeSession(incoming, from = old)
    val current = old.currentMediaItemIndex
    old.repeatMode = Player.REPEAT_MODE_OFF
    old.removeMediaItems(current + 1, count)
    old.removeMediaItems(0, current)
    secondPlayer = old
    incoming.currentMediaItem?.mediaId?.let { CrossfadeLink.handoff.mark(it, SystemClock.elapsedRealtime()) }
    session?.player = showOnSession(incoming)
    ResumeStore.savePlayer(incoming, withItems = true)
    main.removeCallbacks(resumePositionSave)
    main.postDelayed(resumePositionSave, RESUME_SAVE_INTERVAL_MS)
    return old
  }

  /**
   * The player [player] gives each time, as [Crossfade] drives it: a fixed
   * one, or whichever is the session's (a handoff changes it). With none, it
   * stands still and silent.
   */
  private fun deckOf(player: () -> ExoPlayer?): CrossfadeDeck =
    object : CrossfadeDeck {
      override val positionMs get() = player()?.currentPosition ?: 0L
      override val isPlaying get() = player()?.isPlaying == true
      override val ended get() = player()?.playbackState == Player.STATE_ENDED
      override val ready get() = player()?.playbackState == Player.STATE_READY
      override val buffering get() = player()?.playbackState == Player.STATE_BUFFERING

      override fun setVolume(volume: Float) {
        player()?.volume = volume
      }

      override fun setPlaying(playing: Boolean) {
        player()?.playWhenReady = playing
      }
    }

  /**
   * A crossfade's second player: the next song's, waiting for the handoff,
   * then the outgoing song's as it fades out; null otherwise.
   */
  private var secondPlayer: ExoPlayer? = null

  private val crossfade = Crossfade(
    object : CrossfadeHost {
      // Whichever player is the session's: a handoff changes it.
      override val main: CrossfadeDeck = deckOf { exoPlayer }

      override val mainDurationMs: Long?
        get() = exoPlayer?.duration?.takeIf { it != C.TIME_UNSET && it > 0 }

      override val mainWantsToPlay: Boolean
        get() = exoPlayer?.let {
          it.playWhenReady && it.playbackSuppressionReason == Player.PLAYBACK_SUPPRESSION_REASON_NONE
        } == true

      override val mainPlayWhenReady: Boolean
        get() = exoPlayer?.playWhenReady == true

      override val mainPausedForSearch: Boolean
        get() = CrossfadeLink.pausedForSearch

      override val movesOnNaturally: Boolean
        get() {
          val player = exoPlayer ?: return false
          val next = player.nextMediaItemIndex
          // An end-of-song sleep timer pauses there, with nothing of the next song.
          return player.repeatMode != Player.REPEAT_MODE_ONE && !player.pauseAtEndOfMediaItems &&
            next != C.INDEX_UNSET && next != player.currentMediaItemIndex
        }

      override val currentKey: String?
        get() = exoPlayer?.currentMediaItem?.mediaId

      override val nextKey: String?
        get() {
          val player = exoPlayer ?: return null
          val next = player.nextMediaItemIndex
          return if (next == C.INDEX_UNSET) null else player.getMediaItemAt(next).mediaId
        }

      // Preloads the next playlist item on the session's player too, so a song
      // change without an overlap stays gapless: a YT Music song's address is
      // resolved (YtDataSource) and its start buffered. Off again once the
      // player moves (crossfadeListener).
      @OptIn(UnstableApi::class)
      override fun prefetchNext() {
        exoPlayer?.preloadConfiguration = ExoPlayer.PreloadConfiguration(Util.msToUs(PRELOAD_MS))
      }

      override val nowMs: Long
        get() = SystemClock.elapsedRealtime()

      override val nextSearching: Boolean
        get() = searchingNext()

      override fun outcome(outcome: CrossfadeOutcome) {
        WaveLog.i(CROSSFADE_LOG_TAG, CrossfadeLog.line(outcome, deckState(exoPlayer), deckState(secondPlayer)))
      }

      override fun openNext(): CrossfadeDeck {
        closeSecond()
        val player = exoPlayer
        val next = player?.nextMediaItemIndex ?: C.INDEX_UNSET
        val incoming = buildPlayer()
        if (player != null && next != C.INDEX_UNSET) incoming.setMediaItem(player.getMediaItemAt(next), 0L)
        incoming.volume = 0f
        incoming.playWhenReady = false
        incoming.prepare()
        secondPlayer = incoming
        return deckOf { incoming }
      }

      override fun promote(): CrossfadeDeck? = promoteNext()?.let { old -> deckOf { old } }

      override fun closeSecond() {
        secondPlayer?.release()
        secondPlayer = null
      }

      override fun fadeEnded() {
        CrossfadeLink.onFadeEnded?.invoke(System.currentTimeMillis())
      }
    },
  )

  /** A player's state for a crossfade line in the app log. */
  private fun deckState(player: Player?): CrossfadeLog.DeckState? =
    player?.let {
      CrossfadeLog.DeckState(it.currentPosition, it.playbackState, it.playWhenReady, it.isPlaying, it.playbackSuppressionReason)
    }

  /**
   * How the app log names [controller], when it moves or seeks the player:
   * null for Wave's own (JS names its moves itself, [CrossfadeLink.causes]).
   */
  private fun describeController(session: MediaSession, controller: MediaSession.ControllerInfo): String? =
    when {
      session.isMediaNotificationController(controller) -> "the notification"
      session.isAutoCompanionController(controller) || session.isAutomotiveController(controller) -> "Android Auto"
      controller.packageName == packageName -> null
      else -> controller.packageName
    }

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
      val cause = CrossfadeLink.causes.move(reason, SystemClock.elapsedRealtime())
      if (crossfade.moved(mediaItem?.mediaId, restarted, cause)) {
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
      if (within) crossfade.interrupt(CrossfadeEnd.Seek, CrossfadeLink.causes.seek(SystemClock.elapsedRealtime()))
    }

    override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
      if (playWhenReady) CrossfadeLink.pausedForSearch = false
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
    ActiveWaveAudio.count = { listOf(exoPlayer, secondPlayer).count { it?.isPlaying == true } }
    ResumeStore.init(this)
    // The stored Buffer setting, before JS (if any) sends it again.
    StreamBuffer.init(this)
    val player = buildPlayer()
    takeSession(player, from = null)
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
    session = MediaLibrarySession.Builder(this, showOnSession(player), SessionCallback())
      .setBitmapLoader(
        CacheBitmapLoader(DataSourceBitmapLoader.Builder(this).setMaximumOutputDimension(640).build()),
      )
      .apply { openAppIntent()?.let(::setSessionActivity) }
      .build()
    showModes(AutoModes.state.current)
    stopModes = AutoModes.state.listen(::showModes)
    stopLyrics = AutoLyrics.state.listen {
      shown?.refresh()
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

  /** Stops following the Lyrics toggle and text ([AutoLyrics.state]). */
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
    ActiveWaveAudio.count = { 0 }
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

    /**
     * Notes who moves or seeks the player, for the app log's crossfade lines:
     * the notification, Android Auto, the system's media controls. Changes nothing.
     * Deprecated, but still asked before each controller's command in Media3
     * 1.11; nothing else names the controller before the player moves.
     */
    @Suppress("OVERRIDE_DEPRECATION", "DEPRECATION")
    override fun onPlayerCommandRequest(
      session: MediaSession,
      controller: MediaSession.ControllerInfo,
      playerCommand: Int,
    ): Int {
      val from = describeController(session, controller)
      if (playerCommand in MOVING_COMMANDS && from != null) CrossfadeLink.causes.noteSession(from, SystemClock.elapsedRealtime())
      // Play or pause from anywhere but the app: no longer the app's pause for a search.
      if (playerCommand == Player.COMMAND_PLAY_PAUSE && from != null) CrossfadeLink.pausedForSearch = false
      return super.onPlayerCommandRequest(session, controller, playerCommand)
    }

    /** Notes a media button (a headset, the notification's buttons) the same way; the session handles it as before. */
    override fun onMediaButtonEvent(
      session: MediaSession,
      controllerInfo: MediaSession.ControllerInfo,
      intent: Intent,
    ): Boolean {
      val from = describeController(session, controllerInfo) ?: controllerInfo.packageName
      CrossfadeLink.causes.noteMediaButton(from, SystemClock.elapsedRealtime())
      @Suppress("DEPRECATION")
      val key = intent.getParcelableExtra<KeyEvent>(Intent.EXTRA_KEY_EVENT)?.keyCode
      if (key in PLAY_PAUSE_KEYS) CrossfadeLink.pausedForSearch = false
      return super.onMediaButtonEvent(session, controllerInfo, intent)
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
      // JS may search the song first, longer than a note waits: the move its answer makes keeps
      // the controller's name in the app log's crossfade lines.
      val cause = CrossfadeLink.causes.held(SystemClock.elapsedRealtime())
      val answer = Futures.transform(
        AutoLibrary.play(requested.mediaId),
        { items -> items.also { CrossfadeLink.causes.noteAgain(cause, SystemClock.elapsedRealtime()) } },
        mainExecutor,
      )
      return answer.alsoReportFailure(mediaSession, controller, "play ${requested.mediaId}")
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
      // The Lyrics toggle: JS hears of it and sends the lyrics while it's on.
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
            QueueSnapshot.index = snapshot?.queueIndex
            QueueSnapshot.metadata = snapshot?.queueMetadata
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

    val MUSIC: AudioAttributes = AudioAttributes.Builder()
      .setUsage(C.USAGE_MEDIA)
      .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
      .build()

    const val CROSSFADE_LOG_TAG = "WaveCrossfade"

    /** How much of the next song a crossfade preloads. */
    const val PRELOAD_MS = 10_000L

    /** The player commands that move the player to another song or seek it, whose controller the app log names. */
    val MOVING_COMMANDS = setOf(
      Player.COMMAND_SEEK_TO_NEXT,
      Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM,
      Player.COMMAND_SEEK_TO_PREVIOUS,
      Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM,
      Player.COMMAND_SEEK_TO_MEDIA_ITEM,
      Player.COMMAND_SEEK_TO_DEFAULT_POSITION,
      Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM,
      Player.COMMAND_SEEK_BACK,
      Player.COMMAND_SEEK_FORWARD,
      Player.COMMAND_SET_MEDIA_ITEM,
      Player.COMMAND_CHANGE_MEDIA_ITEMS,
    )

    /** The media buttons that play or pause. */
    val PLAY_PAUSE_KEYS = setOf(
      KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE,
      KeyEvent.KEYCODE_MEDIA_PLAY,
      KeyEvent.KEYCODE_MEDIA_PAUSE,
      KeyEvent.KEYCODE_HEADSETHOOK,
    )
  }
}
