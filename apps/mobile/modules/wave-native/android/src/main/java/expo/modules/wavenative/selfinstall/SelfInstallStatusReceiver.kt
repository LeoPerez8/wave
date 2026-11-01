package expo.modules.wavenative.selfinstall

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import expo.modules.wavenative.log.WaveLog

/**
 * Android's answer to [SelfInstaller]'s session: logged, and any confirmation it asks for shown if
 * Wave is in front. Behind another app it isn't shown: Android blocks an activity start from the
 * background anyway, and Wave never opens over someone else. The next try is with Wave in front.
 */
class SelfInstallStatusReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, Int.MIN_VALUE)
    val session = intent.getIntExtra(PackageInstaller.EXTRA_SESSION_ID, -1)
    val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
    WaveLog.i(SELF_INSTALL_TAG, "Session $session status ${installStatusName(status)}: ${message ?: "no message"}")
    if (!keepsApkAfter(status)) SelfInstaller.deleteApks(context)
    if (status != PackageInstaller.STATUS_PENDING_USER_ACTION) return
    if (!SelfInstaller.isInForeground()) {
      WaveLog.i(SELF_INSTALL_TAG, "Android asks for a confirmation with Wave behind; it waits for Wave in front")
      SelfInstaller.oweConfirmation(context)
      runCatching { context.packageManager.packageInstaller.abandonSession(session) }
      return
    }
    val confirm = confirmation(intent)
    if (confirm == null) {
      WaveLog.w(SELF_INSTALL_TAG, "Android asked for a confirmation without its screen")
      return
    }
    try {
      context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      WaveLog.i(SELF_INSTALL_TAG, "Showed Android's confirmation")
    } catch (error: RuntimeException) {
      WaveLog.w(SELF_INSTALL_TAG, "Couldn't show Android's confirmation", error)
    }
  }

  private fun confirmation(intent: Intent): Intent? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
    } else {
      @Suppress("DEPRECATION")
      intent.getParcelableExtra(Intent.EXTRA_INTENT)
    }
}
