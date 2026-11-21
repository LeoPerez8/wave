package expo.modules.waveglass

/**
 * The glass rim's stroke at a strength, in percent of the rim as shipped
 * (Core `GLASS_SETTINGS.rim`): 100 is the shipped stroke, 0 is none. A fainter
 * rim is the same hairline at a lower alpha; a stronger one is brighter and,
 * as the top of the gradient nears opaque, wider too, so the steps above the
 * shipped rim still read apart.
 */
internal object GlassRim {
  const val SHIPPED = 100f

  /** The shipped gradient's alpha (0 to 255) at the top and bottom of the glass. */
  const val TOP_ALPHA = 150
  const val BOTTOM_ALPHA = 30

  /** [shipped] alpha scaled to [strength], held to 0..255. */
  fun alpha(shipped: Int, strength: Float): Int =
    Math.round(shipped * held(strength) / SHIPPED).coerceIn(0, 255)

  /** The stroke width in dp: 1 up to the shipped rim, then a quarter dp more per 50 percent. */
  fun widthDp(strength: Float): Float = 1f + maxOf(0f, held(strength) - SHIPPED) / 200f

  private fun held(strength: Float): Float = if (strength.isNaN()) SHIPPED else maxOf(0f, strength)
}
