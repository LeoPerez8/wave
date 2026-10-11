package expo.modules.wavenative.player

import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionError
import androidx.media3.session.SessionResult
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

/**
 * Hosts the player. Media3 provides the media notification, lock-screen and
 * Bluetooth/headset controls through the session, and the player handles
 * audio focus and pauses when headphones disconnect (becoming noisy).
 *
 * The sleep timer runs here too, so it pauses playback with Wave in the
 * background (the JS side may be suspended by then).
 */
class PlaybackService : MediaSessionService() {
  private var session: MediaSession? = null
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

  @OptIn(UnstableApi::class)
  override fun onCreate() {
    super.onCreate()
    val player = ExoPlayer.Builder(this, WaveRenderersFactory(this))
      .setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(C.USAGE_MEDIA)
          .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
          .build(),
        /* handleAudioFocus = */ true,
      )
      .setHandleAudioBecomingNoisy(true)
      .setWakeMode(C.WAKE_MODE_LOCAL)
      .build()
    player.addListener(sleepTimerListener)
    exoPlayer = player
    session = MediaSession.Builder(this, player)
      .setCallback(SessionCallback())
      .apply { openAppIntent()?.let(::setSessionActivity) }
      .build()
  }

  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

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
    main.removeCallbacks(sleepCheck)
    exoPlayer = null
    session?.run {
      player.release()
      release()
    }
    session = null
    super.onDestroy()
  }

  /** Tapping the notification opens Wave. */
  private fun openAppIntent(): PendingIntent? {
    val launch = packageManager.getLaunchIntentForPackage(packageName) ?: return null
    return PendingIntent.getActivity(
      this,
      0,
      launch,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }

  private inner class SessionCallback : MediaSession.Callback {
    /** Wave's own controller (the JS module) may also start and cancel the sleep timer. */
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
      }
      return result.build()
    }

    override fun onCustomCommand(
      session: MediaSession,
      controller: MediaSession.ControllerInfo,
      customCommand: SessionCommand,
      args: Bundle,
    ): ListenableFuture<SessionResult> {
      val code = when (customCommand.customAction) {
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
     * Items from a controller may arrive without their local configuration; Wave
     * puts the file URI in the request metadata so the session can rebuild it.
     */
    override fun onAddMediaItems(
      mediaSession: MediaSession,
      controller: MediaSession.ControllerInfo,
      mediaItems: MutableList<MediaItem>,
    ): ListenableFuture<MutableList<MediaItem>> =
      Futures.immediateFuture(
        mediaItems.mapTo(mutableListOf()) { item ->
          val uri: Uri? = item.localConfiguration?.uri ?: item.requestMetadata.mediaUri
          if (item.localConfiguration != null || uri == null) item else item.buildUpon().setUri(uri).build()
        },
      )
  }
}
