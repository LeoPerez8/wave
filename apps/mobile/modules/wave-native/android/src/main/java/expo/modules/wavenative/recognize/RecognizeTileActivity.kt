package expo.modules.wavenative.recognize

import android.app.Activity
import android.app.ForegroundServiceStartNotAllowedException
import android.content.Intent
import expo.modules.wavenative.log.WaveLog

/**
 * A transparent moment on screen for a tile tap. Android lets a foreground service use
 * the microphone only when it is started while the app has a visible activity, and its
 * exemptions don't name Quick Settings, so the tile doesn't start the service itself
 * (docs/spec.md, "Recognize"). It shows nothing and leaves nothing in Recents. The
 * service keeps the microphone once this has gone. If Android refuses the start anyway,
 * the card is the way to an answer.
 */
class RecognizeTileActivity : Activity() {
  override fun onResume() {
    super.onResume()
    try {
      startForegroundService(Intent(this, RecognizeListeningService::class.java))
    } catch (e: ForegroundServiceStartNotAllowedException) {
      WaveLog.w("WaveRecognize", "Android refused the tile's foreground service", e)
      startActivity(recognizeIntent(this))
    }
    finish()
  }
}
