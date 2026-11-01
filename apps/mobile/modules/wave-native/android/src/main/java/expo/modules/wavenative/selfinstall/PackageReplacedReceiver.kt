package expo.modules.wavenative.selfinstall

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import expo.modules.wavenative.download.AndroidDownloads
import expo.modules.wavenative.log.WaveLog
import kotlin.concurrent.thread

/**
 * After an update Android delivers this to the new version, which brings Wave's process back.
 *
 * It doesn't reopen the Activity. Android's background-start rules give a receiver no exception, and
 * Wave won't hold SYSTEM_ALERT_WINDOW to get round them. The installs that close Wave run with it
 * out of use, so opening a screen would land over whatever the person went to instead.
 *
 * It brings back what ought to be running: the download journal, whose foreground service an update
 * ends for good and which Android doesn't restart. MY_PACKAGE_REPLACED is an exception to the
 * limits on starting a foreground service from the background. Playback doesn't come back, as a
 * silent install only runs with nothing playing: [expo.modules.wavenative.player.PlaybackService]
 * starts when a media button or Android Auto asks, and resumes from its saved queue. Persisted jobs
 * and scheduled work survive an update on their own.
 */
class PackageReplacedReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
    val app = context.applicationContext
    val pending = goAsync()
    thread(name = "WavePackageReplaced") {
      try {
        WaveLog.i(SELF_INSTALL_TAG, "Updated to ${SelfInstaller.installedVersion(app)}; Wave's process is back, its screen stays closed")
        SelfInstaller.forgetInstalled(app)
        // Android may refuse the service; the journal then waits for the next launch.
        AndroidDownloads.get(app).requestService()
      } catch (error: Exception) {
        WaveLog.w(SELF_INSTALL_TAG, "Couldn't finish after the update", error)
      } finally {
        pending.finish()
      }
    }
  }
}
