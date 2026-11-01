package expo.modules.wavenative.selfinstall

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import expo.modules.wavenative.download.AndroidDownloads
import expo.modules.wavenative.locale.NativeLanguage
import expo.modules.wavenative.log.WaveLog
import kotlin.concurrent.thread

/**
 * After an update Android delivers this to the new version, which brings Wave's process back.
 *
 * It doesn't reopen the Activity. Android's background-start rules give a receiver no exception, and
 * Wave won't hold SYSTEM_ALERT_WINDOW to get round them. An install follows a tap, so the person
 * may have moved on by the time it ends, and a screen would land over whatever they went to.
 *
 * It brings back what ought to be running: the download journal, whose foreground service an update
 * ends for good and which Android doesn't restart. MY_PACKAGE_REPLACED is an exception to the
 * limits on starting a foreground service from the background. Playback doesn't come back, even if
 * music was playing at the tap: [expo.modules.wavenative.player.PlaybackService] starts when a media
 * button or Android Auto asks, and resumes from its saved queue. Persisted jobs and scheduled work
 * survive an update on their own.
 *
 * It also posts [UpdatedNotification], whose tap reopens Wave. Android sends this broadcast only when
 * an APK replaced the app, so a fresh install or a JS bundle update posts nothing.
 */
class PackageReplacedReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
    val app = context.applicationContext
    // No JS has run in this process. On the main thread, as here, this settles the language at once.
    try {
      NativeLanguage.init(app)
    } catch (error: Exception) {
      WaveLog.w(SELF_INSTALL_TAG, "Couldn't read the language after the update", error)
    }
    val pending = goAsync()
    thread(name = "WavePackageReplaced") {
      try {
        runUpdateSteps(
          listOf(
            "the log line" to {
              WaveLog.i(SELF_INSTALL_TAG, "Updated to ${SelfInstaller.installedVersion(app)}; Wave's process is back, its screen stays closed")
            },
            "the installed APK" to { SelfInstaller.forgetInstalled(app) },
            // Android may refuse the service; the journal then waits for the next launch.
            "the download service" to { AndroidDownloads.get(app).requestService() },
            "the notification" to { UpdatedNotification.post(app) },
          ),
        ) { step, error -> WaveLog.w(SELF_INSTALL_TAG, "After the update, $step failed", error) }
      } finally {
        pending.finish()
      }
    }
  }
}
