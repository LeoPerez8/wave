package expo.modules.wavenative.recognize

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/**
 * Static shortcuts always clear their target's task. This invisible, separate task
 * forwards to Wave without clearing its task, so a running session stays running.
 */
class RecognizeShortcutActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (intent?.action == RecognizeInbox.ACTION && (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) == 0) {
      startActivity(recognizeIntent(this))
    }
    finish()
  }
}
