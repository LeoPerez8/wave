package expo.modules.wavenative.player

import android.content.Context
import android.content.SharedPreferences

/**
 * What [PlaybackService]'s [Crossfade] and [WavePlayerModule] share, in one
 * process, on the main thread: the overlap JS chose, kept on disk so the
 * service fades without JS (a cold start from Auto or the media controls),
 * and what the module tells JS about an overlap.
 */
object CrossfadeLink {
  private const val PREFS = "wave_crossfade"
  private const val OVERLAP_KEY = "overlapMs"

  private var prefs: SharedPreferences? = null

  fun init(context: Context) {
    if (prefs == null) prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
  }

  /** The overlap JS last chose, in ms (Core's `crossfadeDuration`); 0 is off. */
  val overlapMs: Long
    get() = prefs?.getLong(OVERLAP_KEY, 0L) ?: 0L

  /** The service follows the overlap while it runs. */
  var onOverlapChanged: ((Long) -> Unit)? = null

  fun setOverlap(ms: Long) {
    val overlap = ms.coerceAtLeast(0L)
    prefs?.edit()?.putLong(OVERLAP_KEY, overlap)?.apply()
    onOverlapChanged?.invoke(overlap)
  }

  /**
   * The entry the service moved to as an overlap started; the module reports
   * the move as `crossfade`, not as a seek, and clears it.
   */
  var handoffKey: String? = null

  /** The module tells JS when the song fading out went silent or was cut off (wall-clock ms). */
  var onFadeEnded: ((Long) -> Unit)? = null
}
