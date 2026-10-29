package expo.modules.wavenative.share

import expo.modules.wavenative.locale.NativeText
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import expo.modules.wavenative.launcher.LauncherIconSwitcher
import expo.modules.wavenative.log.WaveLog

/**
 * The NativeText.get("importWave") sharing shortcut (#205): a dynamic shortcut in the share target's
 * category, so the share sheet shows Wave in its direct-share row for shared text. Picking
 * it sends the share target's SEND intent to MainActivity, which [SharedTextInbox] takes
 * like any other share. The share target is in the shortcuts file the `shareShortcut`
 * config plugin writes.
 */
object ShareShortcut {
  /** One id, so publishing again replaces the shortcut rather than adding a second. */
  private const val ID = "import_to_wave"

  /** The share target's category: `SHARE_TARGET_CATEGORY` in plugins/shareShortcut.ts. */
  private const val CATEGORY = "dev.leoperez.wave.category.IMPORT_SHARED_LINK"

  /**
   * Publishes the shortcut, or replaces it with an up-to-date one, off the main thread.
   * It belongs to the launcher icon that is on, with its icon, so call this again after
   * the icon is switched: Android drops a shortcut whose launcher entry is turned off.
   */
  fun publish(context: Context) {
    val app = context.applicationContext
    Thread({
      runCatching { push(app) }.onFailure { WaveLog.w("WaveShareShortcut", "Couldn't publish the share shortcut", it) }
    }, "wave-share-shortcut").start()
  }

  private fun push(context: Context) {
    val packageManager = context.packageManager
    val launcher = packageManager.getLaunchIntentForPackage(context.packageName)?.component ?: return
    val icon = packageManager.getActivityInfo(launcher, 0).iconResource
    // The static entry stays disabled: its resource locale cannot follow the preview gate.
    val mic = context.resources.getIdentifier("ic_recognize_shortcut", "mipmap", context.packageName)
    val recognize = ShortcutInfoCompat.Builder(context, "wave_recognize_song")
      .setShortLabel(NativeText.get("recognize"))
      .setIcon(IconCompat.createWithResource(context, mic))
      .setActivity(launcher)
      .setIntent(Intent("dev.leoperez.wave.action.RECOGNIZE").setClassName(context, "expo.modules.wavenative.recognize.RecognizeShortcutActivity"))
      .build()
    ShortcutManagerCompat.pushDynamicShortcut(context, recognize)
    val shortcut = ShortcutInfoCompat.Builder(context, ID)
      .setShortLabel(NativeText.get("importWave"))
      .setIcon(IconCompat.createWithResource(context, icon))
      .setActivity(launcher)
      // Required, but the share sheet sends the share target's SEND intent instead.
      .setIntent(
        Intent(Intent.ACTION_MAIN).setComponent(LauncherIconSwitcher.launchTarget(packageManager, launcher)),
      )
      .setCategories(setOf(CATEGORY))
      .setLongLived(true)
      .apply {
        // Kept out of the long-press menu on Wave's icon. Before Android 13 AndroidX doesn't
        // publish a shortcut excluded from the launcher at all, so there it's in both.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          setExcludedFromSurfaces(ShortcutInfoCompat.SURFACE_LAUNCHER)
        }
      }
      .build()
    ShortcutManagerCompat.pushDynamicShortcut(context, shortcut)
  }
}
