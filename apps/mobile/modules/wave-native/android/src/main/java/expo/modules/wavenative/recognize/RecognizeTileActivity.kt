package expo.modules.wavenative.recognize

import android.Manifest
import android.app.Activity
import android.app.ForegroundServiceStartNotAllowedException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import expo.modules.wavenative.log.WaveLog

/**
 * A transparent moment on screen for a tile tap, or a press of a failure notification's
 * Try Again or Use Microphone, which a phone may reach long after the tap. Android lets a foreground service use
 * the microphone only when it is started while the app has a visible activity, and its
 * exemptions don't name Quick Settings, so the tile doesn't start the service itself
 * (docs/spec.md, "Recognize"). It shows nothing and leaves nothing in Recents. The
 * service keeps the microphone once this has gone. A press with a session running
 * leaves it alone, and without the microphone or if Android refuses the start, the card
 * is the way to an answer.
 */
class RecognizeTileActivity : Activity() {
  override fun onResume() {
    super.onResume()
    if (intent.action == ACTION_RETRY) RecognizeNotifications.clearFailure(this)
    if (RecognizeTileRun.shared.tap() == RecognizeTileTap.LISTEN) listen()
    finish()
  }

  private fun listen() {
    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      startActivity(recognizeIntent(this))
      return
    }
    try {
      startForegroundService(
        Intent(this, RecognizeListeningService::class.java)
          .putExtra(RecognizeListeningService.EXTRA_MICROPHONE, intent.getBooleanExtra(EXTRA_MICROPHONE, false)),
      )
    } catch (e: ForegroundServiceStartNotAllowedException) {
      WaveLog.w("WaveRecognize", "Android refused the tile's foreground service", e)
      startActivity(recognizeIntent(this))
    }
  }

  companion object {
    private const val ACTION_RETRY = "expo.modules.wavenative.recognize.RETRY"
    private const val EXTRA_MICROPHONE = "expo.modules.wavenative.recognize.MICROPHONE"

    /** A failure notification's action; [microphone] is Use Microphone. */
    fun retry(context: Context, microphone: Boolean): Intent =
      Intent(context, RecognizeTileActivity::class.java)
        .setAction(ACTION_RETRY)
        .putExtra(EXTRA_MICROPHONE, microphone)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
  }
}
