package expo.modules.wavenative.launcher

import android.app.Activity
import android.app.ActivityManager
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.drawable.AdaptiveIconDrawable
import android.graphics.drawable.Drawable
import android.os.SystemClock
import android.util.Log
import java.lang.ref.WeakReference
import java.util.concurrent.Executors
import kotlin.math.max

/**
 * Shows the stored launcher icon in Recents. Recents takes a task's icon from
 * its task description, and Pixel's (Launcher3's `TaskIconCache`) reads only a
 * bitmap there; without one it draws the activity's own icon, the manifest's
 * white waves. It treats that bitmap as a legacy icon: shrunk onto a ground of
 * the task's primary colour, or white when that isn't opaque. So Wave hands it
 * the alias's waves alone, cropped to their bounds so they come out as large
 * as they can, with the icon's black as the primary colour.
 * Drawing runs off the main thread; only handing it to Android runs on it.
 */
class TaskIcon(private val context: Context) {
  private val packageManager: PackageManager = context.packageManager
  private val worker = Executors.newSingleThreadExecutor()

  /** The alias whose icon Recents shows; null for the activity's own (the manifest's). */
  @Volatile private var alias: String? = null
  @Volatile private var wanted = false

  /** The activity and alias last handed to Android, so a resume that changes nothing does nothing. */
  private var shown: Pair<WeakReference<Activity>, String?>? = null

  /** The last bitmap drawn, by alias; read and written on [worker]. */
  private var drawn: Pair<String, Bitmap>? = null

  /** Shows [alias]'s icon in Recents (null: the manifest's) on [activity] and every later one. */
  fun show(alias: String?, activity: Activity?) {
    this.alias = alias
    wanted = true
    activity?.let(::apply)
  }

  /** Gives [activity]'s task the icon last asked for; nothing before the first [show]. */
  fun apply(activity: Activity) {
    if (!wanted) return
    val alias = alias
    worker.execute {
      val bitmap = alias?.let(::bitmap)
      if (alias != null && bitmap == null) return@execute
      activity.runOnUiThread {
        if (this.alias != alias || activity.isDestroyed) return@runOnUiThread
        val last = shown
        if (last != null && last.first.get() === activity && last.second == alias) return@runOnUiThread
        @Suppress("DEPRECATION")
        activity.setTaskDescription(
          if (bitmap == null) {
            ActivityManager.TaskDescription()
          } else {
            ActivityManager.TaskDescription(null, bitmap, ICON_GROUND)
          },
        )
        shown = WeakReference(activity) to alias
      }
    }
  }

  private fun bitmap(alias: String): Bitmap? {
    drawn?.let { (name, bitmap) -> if (name == alias) return bitmap }
    val started = SystemClock.elapsedRealtimeNanos()
    val bitmap = runCatching {
      val component = ComponentName(context.packageName, "${context.packageName}.$alias")
      val icon = packageManager
        .getActivityInfo(component, PackageManager.MATCH_DISABLED_COMPONENTS)
        .loadUnbadgedIcon(packageManager)
      val art = (icon as? AdaptiveIconDrawable)?.foreground ?: icon
      val size = context.getSystemService(ActivityManager::class.java).launcherLargeIconSize
      cropped(art, size * 2)
    }.onFailure { Log.w(TAG, "Couldn't draw the icon of $alias", it) }.getOrNull() ?: return null
    Log.d(TAG, "Drew $alias for Recents in ${(SystemClock.elapsedRealtimeNanos() - started) / 1000} µs")
    drawn = alias to bitmap
    return bitmap
  }

  /** [art] drawn [size] px square, then cut to a square round what it paints, centred. */
  private fun cropped(art: Drawable, size: Int): Bitmap {
    val full = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    art.setBounds(0, 0, size, size)
    art.draw(Canvas(full))
    val pixels = IntArray(size * size).also { full.getPixels(it, 0, size, 0, 0, size, size) }
    var left = size
    var top = size
    var right = -1
    var bottom = -1
    for (y in 0 until size) for (x in 0 until size) {
      if (Color.alpha(pixels[y * size + x]) == 0) continue
      if (x < left) left = x
      if (x > right) right = x
      if (y < top) top = y
      if (y > bottom) bottom = y
    }
    if (right < 0) return full
    val side = max(right - left, bottom - top) + 1
    val square = Bitmap.createBitmap(side, side, Bitmap.Config.ARGB_8888)
    Canvas(square).drawBitmap(
      full,
      (side - (right - left + 1)) / 2f - left,
      (side - (bottom - top + 1)) / 2f - top,
      null,
    )
    full.recycle()
    return square
  }

  private companion object {
    const val TAG = "WaveTaskIcon"

    /** The launcher icon's ground, as Recents' ground for its waves. */
    const val ICON_GROUND = Color.BLACK
  }
}
