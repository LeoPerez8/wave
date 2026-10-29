package expo.modules.wavenative.locale

import android.app.LocaleManager
import android.content.ComponentCallbacks
import android.content.Context
import android.content.res.Configuration
import android.content.res.Resources
import android.os.Build
import android.os.LocaleList

/**
 * The phone's preferred languages for Wave, as BCP 47 tags in order: the language picked for
 * Wave in Android's per-app list (13+) when there is one, else the system's list. Read from
 * Android rather than Hermes' default `Intl` locale, which needn't follow the per-app choice.
 */
object PreferredLanguages {
  fun read(context: Context): List<String> {
    val app =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        context.getSystemService(LocaleManager::class.java)?.applicationLocales
      } else {
        null
      }
    val locales = if (app != null && !app.isEmpty) app else Resources.getSystem().configuration.locales
    return tags(locales)
  }

  private fun tags(list: LocaleList): List<String> = (0 until list.size()).map { list[it].toLanguageTag() }
}

/** Observes handled configuration changes; foreground refresh catches changes made while away. */
class PreferredLanguageObserver(context: Context, private val changed: () -> Unit) : ComponentCallbacks {
  private val application = context.applicationContext
  private var languages = PreferredLanguages.read(application)

  init {
    application.registerComponentCallbacks(this)
  }

  fun refresh() {
    val next = PreferredLanguages.read(application)
    if (next == languages) return
    languages = next
    changed()
  }

  override fun onConfigurationChanged(newConfig: Configuration) = refresh()

  override fun onLowMemory() = Unit

  fun close() {
    application.unregisterComponentCallbacks(this)
  }
}
