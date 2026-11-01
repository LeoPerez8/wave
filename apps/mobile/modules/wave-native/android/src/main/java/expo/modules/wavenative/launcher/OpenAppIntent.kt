package expo.modules.wavenative.launcher

import android.app.PendingIntent
import android.content.Context

/** Opens Wave: MainActivity rather than the launcher icon's alias, which a theme change can turn off. */
internal fun openAppIntent(context: Context): PendingIntent? {
  val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
  launch.component?.let { launch.component = LauncherIconSwitcher.launchTarget(context.packageManager, it) }
  return PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_IMMUTABLE)
}
