package expo.modules.wavenative.launcher

import android.content.Context
import android.content.SharedPreferences

/**
 * What [LauncherIconSwitcher] records once it has left an alias on: the alias,
 * and the install it reconciled (the package's `lastUpdateTime`). Each Wave
 * with the switcher writes it on every switch, so after an update it still
 * names the icon the phone shows, which JS keeps on that update
 * (Core's `launcherIconOnStart`).
 */
object LauncherIconRecord {
  private const val PREFS = "launcherIcon"
  private const val ALIAS = "appliedAlias"
  private const val INSTALLED_AT = "installedAt"

  fun preferences(context: Context): SharedPreferences =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  /**
   * The alias this install left on, so a switch to it needs no reads; null
   * after an update, whose manifest may turn other aliases on.
   */
  fun reconciled(preferences: SharedPreferences, installedAt: Long): String? =
    if (preferences.getLong(INSTALLED_AT, -1) == installedAt) preferences.getString(ALIAS, null) else null

  /** The alias last left on, by whichever build; null when none was, or a switch broke off. */
  fun lastApplied(preferences: SharedPreferences): String? = preferences.getString(ALIAS, null)

  /** Forgets the alias before a switch changes PackageManager, so an interrupted one retries. */
  fun clear(preferences: SharedPreferences): Boolean = preferences.edit().remove(ALIAS).commit()

  /** Records [alias] as left on by the install [installedAt]. */
  fun save(preferences: SharedPreferences, installedAt: Long, alias: String): Boolean =
    preferences.edit().putLong(INSTALLED_AT, installedAt).putString(ALIAS, alias).commit()
}
