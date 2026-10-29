package expo.modules.wavenative.recognize

import android.app.PendingIntent
import android.os.Build
import android.service.quicksettings.TileService

/** Only brings Wave forward; capture starts in the visible Recognize card. */
class RecognizeTileService : TileService() {
  override fun onClick() {
    super.onClick()
    if (isLocked) unlockAndRun { openWave() } else openWave()
  }

  @Suppress("DEPRECATION")
  private fun openWave() {
    val intent = recognizeIntent(this)
    if (Build.VERSION.SDK_INT >= 34) {
      startActivityAndCollapse(PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
    } else {
      startActivityAndCollapse(intent)
    }
  }
}
