package expo.modules.wavenative.launcher

import android.app.Activity
import android.app.Application
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.PowerManager

/**
 * Switches Wave's launcher icon (an activity alias, see [LauncherAliases]).
 *
 * Turning off the alias Wave's task was opened from can make the system remove
 * that task, so the switch waits until Wave leaves the screen: it's asked for
 * with [request] and applied when Wave's activity stops, unless the screen
 * just went off (Wave is still what shows on unlock) or [isBusy] (a file
 * picker Wave opened is over it). [PackageManager.DONT_KILL_APP] keeps the process,
 * and with it playback, running.
 */
class LauncherIconSwitcher(
  private val context: Context,
  private val isBusy: () -> Boolean,
) : Application.ActivityLifecycleCallbacks {
  private val packageManager: PackageManager = context.packageManager

  @Volatile private var pending: Pair<String, List<String>>? = null

  /** Makes [alias] (of [aliases], simple names) the launcher icon once Wave leaves the screen. */
  fun request(alias: String, aliases: List<String>) {
    pending = alias to aliases
  }

  /** Applies the requested icon now. */
  fun applyPending() {
    val (target, aliases) = pending ?: return
    pending = null
    val changes = LauncherAliases.plan(target, aliases) { isEnabled(component(it)) }
    for (change in changes) {
      packageManager.setComponentEnabledSetting(
        component(change.alias),
        if (change.enabled) {
          PackageManager.COMPONENT_ENABLED_STATE_ENABLED
        } else {
          PackageManager.COMPONENT_ENABLED_STATE_DISABLED
        },
        PackageManager.DONT_KILL_APP,
      )
    }
  }

  override fun onActivityStopped(activity: Activity) {
    if (activity.isChangingConfigurations || isBusy()) return
    val power = context.getSystemService(PowerManager::class.java)
    if (power != null && !power.isInteractive) return
    applyPending()
  }

  private fun component(alias: String) = ComponentName(context.packageName, "${context.packageName}.$alias")

  /** On or off, falling back to the manifest's `android:enabled` until Wave first switched it. */
  private fun isEnabled(component: ComponentName): Boolean =
    when (packageManager.getComponentEnabledSetting(component)) {
      PackageManager.COMPONENT_ENABLED_STATE_ENABLED -> true
      PackageManager.COMPONENT_ENABLED_STATE_DEFAULT ->
        runCatching {
          packageManager.getActivityInfo(component, PackageManager.MATCH_DISABLED_COMPONENTS).enabled
        }.getOrDefault(false)
      else -> false
    }

  override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
  override fun onActivityStarted(activity: Activity) = Unit
  override fun onActivityResumed(activity: Activity) = Unit
  override fun onActivityPaused(activity: Activity) = Unit
  override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
  override fun onActivityDestroyed(activity: Activity) = Unit

  companion object {
    /**
     * The activity that [launchComponent] opens: MainActivity behind a launcher
     * alias. Notifications point at it, so they keep opening Wave after the
     * alias they were made with is turned off.
     */
    fun launchTarget(packageManager: PackageManager, launchComponent: ComponentName): ComponentName {
      val target = runCatching {
        packageManager.getActivityInfo(launchComponent, PackageManager.MATCH_DISABLED_COMPONENTS).targetActivity
      }.getOrNull() ?: return launchComponent
      return ComponentName(launchComponent.packageName, target)
    }
  }
}
