package expo.modules.wavenative.appearance

import android.app.UiModeManager
import android.content.Context

/**
 * Settings › Appearance › Appearance as Android's night mode for Wave alone
 * (`UiModeManager.setApplicationNightMode`). Android keeps it across restarts
 * and opens Wave in it, so the launch splash, the system bars and the
 * notification's resources match the chosen scheme before any JS runs. JS
 * switches its own styles at once (Uniwind) and sends the choice here on every
 * change and start.
 */
object AppearanceMode {
  /** JS's appearance (`system`, `light` or `dark`) as a `UiModeManager` night mode; null when unknown. */
  fun nightMode(appearance: String): Int? = when (appearance) {
    "system" -> UiModeManager.MODE_NIGHT_AUTO
    "light" -> UiModeManager.MODE_NIGHT_NO
    "dark" -> UiModeManager.MODE_NIGHT_YES
    else -> null
  }

  /** Has Android keep Wave in [appearance] from now on; false when it isn't one. */
  fun apply(context: Context, appearance: String): Boolean {
    val mode = nightMode(appearance) ?: return false
    context.getSystemService(UiModeManager::class.java)?.setApplicationNightMode(mode)
    return true
  }
}
