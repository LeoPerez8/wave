package expo.modules.wavenative.player

import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

/**
 * Hosts the player. Media3 provides the media notification, lock-screen and
 * Bluetooth/headset controls through the session, and the player handles
 * audio focus and pauses when headphones disconnect (becoming noisy).
 */
class PlaybackService : MediaSessionService() {
  private var session: MediaSession? = null

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
    session = MediaSession.Builder(this, player)
      .setCallback(ResolveItemsCallback)
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

  /**
   * Items from a controller may arrive without their local configuration; Wave
   * puts the file URI in the request metadata so the session can rebuild it.
   */
  private object ResolveItemsCallback : MediaSession.Callback {
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
