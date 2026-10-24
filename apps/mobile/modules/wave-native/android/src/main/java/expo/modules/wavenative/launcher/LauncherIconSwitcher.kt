package expo.modules.wavenative.launcher

import android.app.Activity
import android.app.Application
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.PowerManager
import android.util.Log
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicReference

/**
 * Switches Wave's launcher icon (an activity alias, see [LauncherAliases]).
 *
 * Turning off the alias Wave's task was opened from can make the system remove
 * that task, so the switch waits until Wave leaves the screen: it's asked for
 * with [request] and applied when Wave's activity stops, unless the screen
 * just went off (Wave is still what shows on unlock) or [isBusy] (a file
 * picker Wave opened is over it). [PackageManager.DONT_KILL_APP] keeps the process,
 * and with it playback, running. [onSwitched] runs after an icon was switched.
 */
class LauncherIconSwitcher(
  private val context: Context,
  private val isBusy: () -> Boolean,
  private val onSwitched: () -> Unit = {},
) : Application.ActivityLifecycleCallbacks {
  private val packageManager: PackageManager = context.packageManager

  private val pending = AtomicReference<Pair<String, List<String>>?>(null)
  private val worker = Executors.newSingleThreadExecutor()

  // Read on the worker, once per process. An app update invalidates the saved reconciliation:
  // newly shipped aliases may have manifest defaults that must be checked too.
  private val preferences by lazy { context.getSharedPreferences("launcherIcon", Context.MODE_PRIVATE) }
  private val installedAt by lazy {
    @Suppress("DEPRECATION")
    packageManager.getPackageInfo(context.packageName, 0).lastUpdateTime
  }
  private var appliedAlias: String? = null
  private var restored = false

  /** Makes [alias] (of [aliases], simple names) the launcher icon once Wave leaves the screen. */
  fun request(alias: String, aliases: List<String>) {
    pending.set(alias to aliases)
  }

  /** Queues reconciliation off the activity thread; requests are applied in stop order. */
  fun applyPending() {
    val request = pending.getAndSet(null) ?: return
    worker.execute {
      try {
        apply(request.first, request.second)
      } catch (error: Exception) {
        // The next theme request reconciles a partial switch, including after a restart.
        appliedAlias = null
        Log.w("WaveLauncherIcon", "Couldn't switch launcher icon", error)
      }
    }
  }

  private fun apply(target: String, aliases: List<String>) {
    if (!restored) {
      if (preferences.getLong("installedAt", -1) == installedAt) {
        appliedAlias = preferences.getString("appliedAlias", null)
      }
      restored = true
    }
    if (target == appliedAlias || target !in aliases) return
    val changes = LauncherAliases.plan(target, aliases, appliedAlias) { isEnabled(component(it)) }
    // Clear the durable marker before changing PackageManager, so an interrupted switch retries.
    check(preferences.edit().remove("appliedAlias").commit())
    appliedAlias = null
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
    check(preferences.edit().putLong("installedAt", installedAt).putString("appliedAlias", target).commit())
    appliedAlias = target
    if (changes.isNotEmpty()) onSwitched()
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
