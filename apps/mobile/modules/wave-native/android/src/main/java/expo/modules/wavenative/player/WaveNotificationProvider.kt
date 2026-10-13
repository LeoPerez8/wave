package expo.modules.wavenative.player

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
 * wherever the system takes a colour from the app. Everything else, controls
 * included, is Media3's.
 */
@OptIn(UnstableApi::class)
internal class WaveNotificationProvider private constructor(
  private val context: Context,
  private val media3: DefaultMediaNotificationProvider,
) : MediaNotification.Provider by media3 {
  constructor(context: Context) : this(
    context,
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
    val accent = NotificationAccent.state.current ?: return notification
    val night = (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
      Configuration.UI_MODE_NIGHT_YES
    notification.notification.color = accent.forScheme(night)
    return notification
  }
}
