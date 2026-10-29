package expo.modules.wavenative.locale

import android.content.Context
import android.os.Handler
import android.os.Looper
import expo.modules.wavenative.share.ShareShortcut

/** Resolves Android's current tags for native text, at service starts before JS and on each change. */
object NativeLanguage {
  private var observer: PreferredLanguageObserver? = null
  private val main = Handler(Looper.getMainLooper())
  fun init(context: Context) {
    val app = context.applicationContext
    if (observer == null) observer = PreferredLanguageObserver(app) { refresh(app) }
    refresh(app)
  }
  private fun refresh(context: Context) {
    val supported = PreferredLanguages.read(context).firstNotNullOfOrNull { tag ->
      when (tag.substringBefore('-').lowercase()) {
        "en" -> "en"
        "pt" -> "pt-BR"
        else -> null
      }
    } ?: "en"
    val update = { NativeText.publish(supported); ShareShortcut.publish(context) }
    if (Looper.myLooper() == Looper.getMainLooper()) update() else main.post { update() }
  }
}
