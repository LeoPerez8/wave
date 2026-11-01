package expo.modules.wavenative.recognize

/**
 * The latest [capacity] samples a session has heard, in one array that never grows:
 * each sample past that takes the place of the oldest. Not thread-safe.
 */
class RecognizeWindow(private val capacity: Int) {
  private val ring = ShortArray(capacity)
  private var next = 0
  private var held = 0

  /** Takes the first [count] samples of [source]. */
  fun append(source: ShortArray, count: Int) {
    var position = maxOf(0, count - capacity)
    while (position < count) {
      val taken = minOf(capacity - next, count - position)
      source.copyInto(ring, next, position, position + taken)
      next = (next + taken) % capacity
      position += taken
    }
    held = minOf(capacity, held + count)
  }

  /** A copy of the latest [count] samples, oldest first, or of all it holds if that's fewer. */
  fun latest(count: Int): ShortArray {
    val length = minOf(count, held)
    val start = (next - length + capacity) % capacity
    val beforeWrap = minOf(length, capacity - start)
    val samples = ShortArray(length)
    ring.copyInto(samples, 0, start, start + beforeWrap)
    ring.copyInto(samples, beforeWrap, 0, length - beforeWrap)
    return samples
  }
}
