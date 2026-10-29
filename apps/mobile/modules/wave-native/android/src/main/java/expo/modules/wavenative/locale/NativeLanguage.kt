package expo.modules.wavenative.locale

import android.content.Context
import android.os.Handler
import android.os.Looper
import expo.modules.wavenative.share.ShareShortcut

/** Persist the preview gate for service starts before JS, then resolve Android's current tags. */
object NativeLanguage {
  private var observer: PreferredLanguageObserver? = null
  private val main = Handler(Looper.getMainLooper())
  fun init(context: Context) {
    val app = context.applicationContext
    if (observer == null) observer = PreferredLanguageObserver(app) { refresh(app) }
    refresh(app)
  }
  fun setPreview(context: Context, enabled: Boolean) {
    context.getSharedPreferences("wave_language", Context.MODE_PRIVATE).edit().putBoolean("preview", enabled).apply()
    init(context)
  }
  private fun refresh(context: Context) {
    val enabled = context.getSharedPreferences("wave_language", Context.MODE_PRIVATE).getBoolean("preview", false)
    val supported = PreferredLanguages.read(context).firstNotNullOfOrNull { tag ->
      when (tag.substringBefore('-').lowercase()) {
        "en" -> "en"
        "pt" -> if (enabled) "pt-BR" else null
        else -> null
      }
    } ?: "en"
    val update = { NativeText.publish(supported); ShareShortcut.publish(context) }
    if (Looper.myLooper() == Looper.getMainLooper()) update() else main.post { update() }
  }
}
