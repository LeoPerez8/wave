package expo.modules.wavenative.player

import android.app.Notification
import android.content.Context
import android.content.res.Configuration
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.CommandButton
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.MediaNotification
import androidx.media3.session.MediaSession
import com.google.common.collect.ImmutableList
import expo.modules.wavenative.R

/**
 * Media3's media notification with Wave's two waves as the small icon (status
 * bar, notification header, lock screen; `wave_notification.xml`) instead of
 * its music note, coloured with the chosen primary ([NotificationAccent])
 * wherever the system takes a colour from the app, and [subText] under the
 * app's name while the network holds the song up ("No internet", "Slow
 * connection"; Ghost wave, #1498). Android 13+'s media controls leave the sub
 * text out; there the play button's loading ring says it (the session shows the
 * wait as buffering, `LyricsTextPlayer`). Everything else, controls included, is
 * Media3's.
 */
@OptIn(UnstableApi::class)
internal class WaveNotificationProvider private constructor(
  private val context: Context,
  private val subText: () -> CharSequence?,
  private val media3: DefaultMediaNotificationProvider,
) : MediaNotification.Provider by media3 {
  constructor(context: Context, subText: () -> CharSequence? = { null }) : this(
    context,
    subText,
    DefaultMediaNotificationProvider.Builder(context).build().apply {
      setSmallIcon(R.drawable.wave_notification)
    },
  )

  override fun createNotification(
    mediaSession: MediaSession,
    mediaButtonPreferences: ImmutableList<CommandButton>,
    actionFactory: MediaNotification.ActionFactory,
    onNotificationChangedCallback: MediaNotification.Provider.Callback,
  ): MediaNotification =
    // The callback brings the notification again once the artwork has loaded.
    tint(
      media3.createNotification(mediaSession, mediaButtonPreferences, actionFactory) {
        onNotificationChangedCallback.onNotificationChanged(tint(it))
      },
    )

  private fun tint(notification: MediaNotification): MediaNotification {
    // The built notification keeps its fields in extras, which Android draws it from.
    notification.notification.extras.putCharSequence(Notification.EXTRA_SUB_TEXT, subText())
    val accent = NotificationAccent.state.current ?: return notification
    val night = (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
      Configuration.UI_MODE_NIGHT_YES
    notification.notification.color = accent.forScheme(night)
    return notification
  }
}
