package expo.modules.wavenative.selfinstall

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import expo.modules.wavenative.log.WaveLog

/** Android's answer to [SelfInstallSpike]'s session: logged, and any confirmation it asks for shown. */
class SelfInstallStatusReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, Int.MIN_VALUE)
    val session = intent.getIntExtra(PackageInstaller.EXTRA_SESSION_ID, -1)
    val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
    WaveLog.i(SELF_INSTALL_TAG, "Session $session status ${installStatusName(status)}: ${message ?: "no message"}")
    if (status != PackageInstaller.STATUS_PENDING_USER_ACTION) return
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
