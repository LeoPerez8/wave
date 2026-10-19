package android.util

/**
 * The JVM tests' stand-in for Android's SparseArray, whose framework stub does
 * nothing there, so Media3's real cache (YtAudioCacheTest) keeps its index.
 * Only what Media3's cache calls.
 */
class SparseArray<E> {
  private val values = sortedMapOf<Int, E>()

  fun get(key: Int): E? = values[key]

  fun put(key: Int, value: E) {
    values[key] = value
  }

  fun remove(key: Int) {
    values.remove(key)
  }

  fun size(): Int = values.size

  fun keyAt(index: Int): Int = values.keys.elementAt(index)

  fun valueAt(index: Int): E = values.values.elementAt(index)

  fun clear() = values.clear()
}

/** The JVM tests' stand-in for Android's SparseBooleanArray (see [SparseArray]). */
class SparseBooleanArray {
  private val values = sortedMapOf<Int, Boolean>()

  fun get(key: Int): Boolean = values[key] ?: false

  fun put(key: Int, value: Boolean) {
    values[key] = value
  }

  fun delete(key: Int) {
    values.remove(key)
  }

  fun size(): Int = values.size

  fun keyAt(index: Int): Int = values.keys.elementAt(index)

  fun clear() = values.clear()
}
