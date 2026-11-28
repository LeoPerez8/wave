package expo.modules.wavenative.log

/** Core's lateFrame rule in Kotlin. Counts late callbacks, not estimated missing vsync slots. */
fun lateFrame(gapMs: Double, intervalMs: Double): Boolean =
  gapMs.isFinite() && intervalMs.isFinite() && intervalMs > 0 && gapMs > 1.5 * intervalMs

/**
 * [motion]: the gaps that began at or after the transition's motion started, when it started
 * after the screen's first frame (a tab's slide, #1536); null when nothing marked it.
 */
data class FrameTotals(val count: Int, val longestGapMs: Double, val motion: FrameTotals? = null)

/** Main-thread collector. Android supplies Choreographer and the current display interval. */
class TransitionFrames(
  private val intervalMs: () -> Double,
  private val request: ((Double) -> Unit) -> (() -> Unit),
) {
  private var id: Int? = null
  private var previous = 0.0
  private var count = 0
  private var longest = 0.0
  private var cancel: (() -> Unit)? = null
  private var motionFrom: Double? = null
  // Each gap's start, length and lateness: the motion's mark comes from JS, after frames past it.
  private val gaps = ArrayList<Gap>()

  private data class Gap(val from: Double, val ms: Double, val late: Boolean)

  fun start(nextId: Int, at: Double) {
    clear()
    id = nextId
    previous = at
    count = 0
    longest = 0.0
    schedule(nextId)
  }

  /** The transition's motion started at [at] (the UI frame's time), after its first frame. */
  fun mark(expected: Int, at: Double) {
    if (id == expected) motionFrom = at
  }

  private fun schedule(expected: Int) {
    cancel = request { at ->
      if (id == expected) {
        sample(at)
        schedule(expected)
      }
    }
  }

  private fun sample(at: Double) {
    if (at < previous) return
    val gap = at - previous
    val late = lateFrame(gap, intervalMs())
    if (late) {
      count++
    }
    longest = maxOf(longest, gap)
    gaps.add(Gap(previous, gap, late))
    previous = at
  }

  fun stop(expected: Int, at: Double): FrameTotals? {
    if (id != expected) return null
    sample(at)
    val motion = motionFrom?.let { from ->
      val moving = gaps.filter { it.from >= from }
      FrameTotals(moving.count { it.late }, moving.maxOfOrNull { it.ms } ?: 0.0)
    }
    val result = FrameTotals(count, longest, motion)
    clear()
    return result
  }

  fun clear() {
    id = null
    cancel?.invoke()
    cancel = null
    motionFrom = null
    gaps.clear()
  }
}
