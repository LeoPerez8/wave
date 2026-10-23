package expo.modules.wavenative.log

/** Core's lateFrame rule in Kotlin. Counts late callbacks, not estimated missing vsync slots. */
fun lateFrame(gapMs: Double, intervalMs: Double): Boolean =
  gapMs.isFinite() && intervalMs.isFinite() && intervalMs > 0 && gapMs > 1.5 * intervalMs

data class FrameTotals(val count: Int, val longestGapMs: Double)

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

  fun start(nextId: Int, at: Double) {
    clear()
    id = nextId
    previous = at
    count = 0
    longest = 0.0
    schedule(nextId)
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
    if (lateFrame(gap, intervalMs())) {
      count++
    }
    longest = maxOf(longest, gap)
    previous = at
  }

  fun stop(expected: Int, at: Double): FrameTotals? {
    if (id != expected) return null
    sample(at)
    val result = FrameTotals(count, longest)
    clear()
    return result
  }

  fun clear() {
    id = null
    cancel?.invoke()
    cancel = null
  }
}
