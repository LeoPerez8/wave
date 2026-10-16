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

  /** The service's move as an overlap starts, which the module reports as `crossfade`. */
  val handoff = CrossfadeHandoff()

  /** The module tells JS when the song fading out went silent or was cut off (wall-clock ms). */
  var onFadeEnded: ((Long) -> Unit)? = null
}

/**
 * The entry the service moved to as an overlap started, until the module hears
 * of the move over the controller, a little later. Moves heard before it (a
 * sync or playlist change still on its way) leave it waiting; one that never
 * arrives is forgotten after [WAIT_MS], so a later move to that entry isn't
 * taken for it. Times are elapsed-realtime ms.
 */
class CrossfadeHandoff {
  private var key: String? = null
  private var markedAtMs = 0L

  fun mark(key: String, nowMs: Long) {
    this.key = key
    markedAtMs = nowMs
  }

  /** Whether the move to [itemId] is the overlap's; true once per [mark]. */
  fun take(itemId: String?, nowMs: Long): Boolean {
    val waiting = key ?: return false
    if (nowMs - markedAtMs > WAIT_MS) {
      clear()
      return false
    }
    if (itemId != waiting) return false
    clear()
    return true
  }

  fun clear() {
    key = null
  }

  private companion object {
    /** Far longer than the controller takes to hear of a move. */
    const val WAIT_MS = 2000L
  }
}
