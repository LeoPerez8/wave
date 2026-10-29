package expo.modules.wavenative.shows

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import expo.modules.wavenative.R

/** The Shows channel: one notification per new show of a followed artist; a tap opens its ticket page. */
object ShowNotifications {
  private const val CHANNEL = "shows"
  fun enabled(context: Context): Boolean {
    if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false
    return Build.VERSION.SDK_INT < 26 ||
      context.getSystemService(NotificationManager::class.java).getNotificationChannel(CHANNEL)?.importance != NotificationManager.IMPORTANCE_NONE
  }
  fun settings(context: Context) {
    context.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
      .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
  }
  fun post(context: Context, id: String, title: String, body: String, url: String, channel: String): Boolean {
    if (!enabled(context) || Uri.parse(url).scheme != "https") return false
    val manager = context.getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= 26)
      manager.createNotificationChannel(NotificationChannel(CHANNEL, channel, NotificationManager.IMPORTANCE_DEFAULT))
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
    val tap = PendingIntent.getActivity(context, id.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val notification = NotificationCompat.Builder(context, CHANNEL)
      .setSmallIcon(R.drawable.wave_notification)
      .setContentTitle(title).setContentText(body)
      .setStyle(NotificationCompat.BigTextStyle().bigText(body))
      .setContentIntent(tap).setAutoCancel(true).build()
    return try { manager.notify(id, 0, notification); true } catch (_: SecurityException) { false }
  }
}
