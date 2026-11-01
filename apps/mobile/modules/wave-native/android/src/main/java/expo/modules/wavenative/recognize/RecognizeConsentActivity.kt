package expo.modules.wavenative.recognize

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle

/** Hosts only Android's consent dialog. A tile never needs Wave's React activity. */
class RecognizeConsentActivity : Activity() {
  private var consent: Consent? = null

  override fun onCreate(state: Bundle?) {
    super.onCreate(state)
    val current = pending?.takeIf { it.request == intent.getIntExtra(REQUEST, -1) }
    if (current == null) {
      finish()
      return
    }
    consent = current
    current.activity = this
    if (state == null) startActivityForResult(current.intent, CONSENT)
  }

  @Deprecated("Activity result API used by this standalone native activity")
  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    super.onActivityResult(requestCode, resultCode, data)
    if (requestCode != CONSENT) return
    deliver(resultCode, data)
    finish()
  }

  override fun onDestroy() {
    if (consent?.activity === this) {
      consent?.activity = null
      if (!isChangingConfigurations) deliver(RESULT_CANCELED, null)
    }
    super.onDestroy()
  }

  private fun deliver(code: Int, data: Intent?) {
    val current = consent ?: return
    if (pending !== current) return
    pending = null
    current.result(code, data)
  }

  private class Consent(
    val request: Int,
    val intent: Intent,
    val result: (Int, Intent?) -> Unit,
  ) {
    var activity: RecognizeConsentActivity? = null
  }

  companion object {
    private const val REQUEST = "request"
    private const val CONSENT = 1
    private var pending: Consent? = null

    /** Called on the main thread. The returned cancel dismisses an outstanding dialog. */
    fun open(context: Context, request: Int, intent: Intent, result: (Int, Intent?) -> Unit): () -> Unit {
      check(pending == null) { "Phone audio consent is already pending" }
      val current = Consent(request, intent, result)
      pending = current
      try {
        context.startActivity(Intent(context, RecognizeConsentActivity::class.java)
          .putExtra(REQUEST, request).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      } catch (e: Exception) {
        pending = null
        throw e
      }
      return {
        if (pending === current) {
          pending = null
          current.activity?.let {
            it.finishActivity(CONSENT)
            it.finish()
          }
        }
      }
    }
  }
}
