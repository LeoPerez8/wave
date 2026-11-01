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
 * notifications take it from there. A second tap cancels. A tap that session couldn't
 * answer opens the card instead.
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
    when (tap()) {
      RecognizeTileTap.CANCEL -> RecognizeListeningService.cancel(this)
      RecognizeTileTap.IGNORE -> Unit
      RecognizeTileTap.LISTEN, RecognizeTileTap.OPEN_CARD -> if (isLocked) unlockAndRun(::answer) else answer()
    }
  }

  /**
   * The service can't start without the microphone, and only the card can ask for it;
   * with results not reaching the user, only the card can show one (#902).
   */
  private fun tap() = run.tap(
    microphone = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED,
    notifications = RecognizeNotifications.resultsShown(this),
  )

  /** After an unlock too, which can take long enough for a card session to start. */
  private fun answer() {
    when (tap()) {
      RecognizeTileTap.LISTEN -> collapseInto(Intent(this, RecognizeTileActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      RecognizeTileTap.OPEN_CARD -> collapseInto(recognizeIntent(this))
      RecognizeTileTap.CANCEL, RecognizeTileTap.IGNORE -> Unit
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
