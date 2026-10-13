package expo.modules.wavenative.launch

import android.app.Activity
import android.content.Context
import android.content.SharedPreferences
import android.content.res.Resources
import android.os.Build

/**
 * Keeps the [LaunchTheme] in SharedPreferences, where native code can read it
 * on a cold start before any JS runs. JS saves it whenever the theme changes
 * (and on every start). On Android 13+ it also tells Android which splash
 * style to open Wave with next time; Android 12 can't switch it and keeps the
 * manifest's, which has the shipped grounds.
 */
object LaunchThemeStore {
  private const val PREFS = "wave.launch"

  /** The splash style last handed to Android in this process; [UNSET] before the first. */
  private var appliedSplash: Any? = UNSET

  private object UNSET

  private fun prefs(context: Context): SharedPreferences =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun save(context: Context, theme: LaunchTheme) {
    val editor = prefs(context).edit().clear()
    for ((key, value) in theme.toEntries()) {
      when (value) {
        is Int -> editor.putInt(key, value)
        is String -> editor.putString(key, value)
      }
    }
    editor.apply()
  }

  /** The saved launch theme; null until JS first saved one (the shipped theme). */
  fun load(context: Context): LaunchTheme? = LaunchTheme.fromEntries(prefs(context).all)

  /**
   * Makes Android 13+ open Wave on [theme]'s splash from the next cold start;
   * no theme, or a style this build doesn't ship, puts the manifest's back.
   * Android persists the choice itself, so this only calls it when it changes.
   */
  @Synchronized
  fun applySplash(activity: Activity, theme: LaunchTheme?) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
    val name = theme?.splashTheme
    if (appliedSplash == name) return
    val styleId = name
      ?.let { activity.resources.getIdentifier(it, "style", activity.packageName) }
      ?: Resources.ID_NULL
    activity.splashScreen.setSplashScreenTheme(styleId)
    appliedSplash = name
  }
}
