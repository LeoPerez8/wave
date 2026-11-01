package expo.modules.wavenative.selfinstall

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import expo.modules.wavenative.R
import expo.modules.wavenative.locale.NativeText
import expo.modules.wavenative.log.WaveLog
import expo.modules.wavenative.lookup.LibraryLookupNotice

/**
 * "Wave updated", posted once an APK has replaced the app. Android won't let a receiver reopen the
 * screen, so this is the way back, and it keeps the closure from looking like a crash. It alerts on
 * its own channel because the person has just watched Wave close.
 */
object UpdatedNotification {
  private const val CHANNEL = "wave-updates"
  private const val TAG = "wave-updated"
  private const val ID = 1

  fun post(context: Context) {
    val manager = context.getSystemService(NotificationManager::class.java)
    if (!manager.areNotificationsEnabled()) {
      WaveLog.i(SELF_INSTALL_TAG, "Notifications are off, so no \"Wave updated\" notification")
      return
    }
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL, NativeText.get("appUpdates"), NotificationManager.IMPORTANCE_HIGH),
    )
    val builder = Notification.Builder(context, CHANNEL)
      .setSmallIcon(R.drawable.wave_notification)
      .setContentTitle(NativeText.get("waveUpdated"))
      .setContentText(NativeText.get("tapToOpen"))
      .setCategory(Notification.CATEGORY_STATUS)
      .setAutoCancel(true)
    LibraryLookupNotice.openApp(context)?.let { builder.setContentIntent(it) }
    manager.notify(TAG, ID, builder.build())
  }
}
