package expo.modules.wavenative.log

import android.content.ComponentCallbacks2

/**
 * Android's memory warnings (`onTrimMemory`, `onLowMemory`) as app log warnings (#450): each level
 * is written once per change, with Wave's [memory], so a kill can be matched to the warnings before
 * it. At every warning, repeated or not, JS is told to write the entries it holds at once
 * ([warned]), since a kill may follow. Wave leaving the screen (`TRIM_MEMORY_UI_HIDDEN`) isn't a
 * warning: it writes nothing, but the next warning counts as a change, so each stay in the
 * background writes its own.
 */
@Suppress("DEPRECATION")
class MemoryWarnings(
  private val memory: () -> MemoryUse,
  private val warn: (String) -> Unit,
  private val warned: () -> Unit,
) {
  private var last: Int? = null

  fun trimmed(level: Int) {
    val changed = synchronized(this) {
      if (level == ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN) { last = null; return }
      (level != last).also { last = level }
    }
    if (changed) warn("Android warned that memory is short: ${name(level)}; ${memory().line()}")
    warned()
  }

  /** Android's older call, sent when the whole phone runs low: as the last level. */
  fun lowMemory() = trimmed(ComponentCallbacks2.TRIM_MEMORY_COMPLETE)

  /** Why the last [checked] found memory short (empty: it wasn't). */
  private var shortBecause: List<String> = emptyList()

  /**
   * The download service's own check, about once a minute ([use], and whether Android says the
   * phone is low on memory, [phoneLow]): since Android 14 the running levels and `onLowMemory`
   * never arrive, so a queue running while memory runs short would write nothing. Memory is short
   * when the phone is low or Wave's Java heap is past [HEAP_SHORT] of its limit; it's written once
   * per change, and JS writes what it holds at every check while it's short.
   */
  fun checked(use: MemoryUse, phoneLow: Boolean) {
    val because = listOfNotNull(
      "the phone is low on memory".takeIf { phoneLow },
      "Wave's Java heap is near its limit".takeIf { use.javaLimit > 0 && use.javaUsed >= use.javaLimit * HEAP_SHORT },
    )
    val changed = synchronized(this) { (because != shortBecause).also { shortBecause = because } }
    if (because.isEmpty()) return
    if (changed) warn("Memory is short: ${because.joinToString(" and ")}; ${use.line()}")
    warned()
  }

  private fun name(level: Int): String = when (level) {
    ComponentCallbacks2.TRIM_MEMORY_RUNNING_MODERATE -> "running moderate (level $level)"
    ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW -> "running low (level $level)"
    ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL -> "running critical (level $level)"
    ComponentCallbacks2.TRIM_MEMORY_BACKGROUND -> "background (level $level)"
    ComponentCallbacks2.TRIM_MEMORY_MODERATE -> "moderate (level $level)"
    ComponentCallbacks2.TRIM_MEMORY_COMPLETE -> "complete (level $level)"
    else -> "level $level"
  }

  private companion object {
    /** The share of its limit past which Wave's Java heap counts as short. */
    const val HEAP_SHORT = 0.85
  }
}
