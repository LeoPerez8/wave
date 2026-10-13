package expo.modules.wavenative.launcher

/** One activity alias turned on or off. */
data class AliasChange(val alias: String, val enabled: Boolean)

/**
 * Wave's launcher icons are activity aliases of MainActivity, one per primary ×
 * secondary (the `launcherIcons` config plugin declares them). Exactly one is
 * on at a time, so Wave shows once in the app drawer.
 */
object LauncherAliases {
  /**
   * The changes that leave [target] the only alias of [aliases] that is on:
   * [target] first, so Wave is never without a launcher entry, then every other
   * one that [isEnabled]. Empty when it's already so, or when [target] isn't one
   * of [aliases].
   */
  fun plan(target: String, aliases: List<String>, isEnabled: (String) -> Boolean): List<AliasChange> {
    if (target !in aliases) return emptyList()
    val changes = mutableListOf<AliasChange>()
    if (!isEnabled(target)) changes += AliasChange(target, enabled = true)
    for (alias in aliases) {
      if (alias != target && isEnabled(alias)) changes += AliasChange(alias, enabled = false)
    }
    return changes
  }
}
