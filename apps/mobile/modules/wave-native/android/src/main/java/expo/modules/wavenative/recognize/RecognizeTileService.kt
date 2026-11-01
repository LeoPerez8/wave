package expo.modules.wavenative.recognize

import android.Manifest
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

/**
 * Listens without opening Wave: RecognizeTileActivity starts the session's service, and
 * notifications take it from there. A second tap cancels.
 */
class RecognizeTileService : TileService() {
  private val run = RecognizeTileRun.shared
  private var leave: (() -> Unit)? = null

  override fun onStartListening() {
    super.onStartListening()
    expo.modules.wavenative.locale.NativeLanguage.init(this)
    leave = run.listen { mainExecutor.execute { show() } }
    show()
  }

  override fun onStopListening() {
    leave?.invoke()
    leave = null
    super.onStopListening()
  }

  private fun show() {
    qsTile?.let {
      it.label = expo.modules.wavenative.locale.NativeText.get("recognize")
      it.state = if (run.listening) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
      it.updateTile()
    }
  }

  override fun onClick() {
    super.onClick()
    when (run.tap()) {
      RecognizeTileTap.CANCEL -> RecognizeListeningService.cancel(this)
      RecognizeTileTap.IGNORE -> Unit
      RecognizeTileTap.LISTEN -> if (isLocked) unlockAndRun(::listen) else listen()
    }
  }

  /** After an unlock too, which can take long enough for a card session to start. */
  private fun listen() {
    if (run.tap() != RecognizeTileTap.LISTEN) return
    // The service can't start without it, and only the card can ask (#902).
    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      collapseInto(recognizeIntent(this))
    } else {
      collapseInto(Intent(this, RecognizeTileActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
  }

  @Suppress("DEPRECATION")
  private fun collapseInto(intent: Intent) {
    if (Build.VERSION.SDK_INT >= 34) {
      startActivityAndCollapse(PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
    } else {
      startActivityAndCollapse(intent)
    }
  }
}
