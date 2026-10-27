package expo.modules.wavenative.artwork

import kotlin.math.max
import kotlin.math.roundToInt

/** Dimensions shared by the scanner's thumbnail and medium-cover encoder. */
object ArtworkDimensions {
  const val MEDIUM_SIZE = 640

  fun fit(width: Int, height: Int, limit: Int): Pair<Int, Int> {
    require(width > 0 && height > 0 && limit > 0)
    val scale = minOf(1.0, limit.toDouble() / max(width, height))
    return max(1, (width * scale).roundToInt()) to max(1, (height * scale).roundToInt())
  }

  fun sampleSize(width: Int, height: Int, limit: Int): Int {
    require(width > 0 && height > 0 && limit > 0)
    var sample = 1
    while (max(width, height) / sample / 2 >= limit) sample *= 2
    return sample
  }
}
