package expo.modules.waveglass

import android.content.Context
import android.view.ViewTreeObserver
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import kotlin.math.abs
import kotlin.math.min

/**
 * Clips its content to its bounds and fades it out at the left and right
 * edges, for Now Playing's scrolling lines (Core's `marquee.ts`). It uses
 * Android's own fading edges, which mask what was drawn (the Now Playing
 * ground shows through), so it needs no colour to fade into.
 *
 * [fixedEdge] fades all the time, at rest too: the end the text runs off.
 * The other edge fades only while the content (its first child, moved by a
 * Reanimated transform) is away from rest, by how far it is from either end
 * of its [travel]: so the fade grows as the line starts and shrinks as the
 * text's start comes back round. A transform alone doesn't redraw this view,
 * so while the line can move it checks the child's offset before each frame
 * the window draws, and redraws only when it moved; a line that can't move
 * (it fits, or [travel] is 0) listens to nothing.
 */
class WaveFadeEdgesView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val density = resources.displayMetrics.density

  /** "left", "right" or "none" (a line that fits fades nowhere). */
  var fixedEdge = "none"
    set(value) {
      field = value
      invalidate()
    }

  /** How far the content moves in one loop, in dp; 0 while it doesn't move. */
  var travelDp = 0f
    set(value) {
      field = value
      followOffset()
      invalidate()
    }

  var fadeLengthDp = 24f
    set(value) {
      field = value
      setFadingEdgeLength((value * density).toInt())
      invalidate()
    }

  private var lastOffset = 0f

  /** The tree observer [onPreDraw] is registered with, while it is. */
  private var observer: ViewTreeObserver? = null

  private val onPreDraw = ViewTreeObserver.OnPreDrawListener {
    val offset = contentOffset()
    if (offset != lastOffset) {
      lastOffset = offset
      invalidate()
    }
    true
  }

  init {
    setWillNotDraw(false)
    clipChildren = true
    isHorizontalFadingEdgeEnabled = true
    setFadingEdgeLength((fadeLengthDp * density).toInt())
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    followOffset()
  }

  override fun onDetachedFromWindow() {
    stopFollowing()
    super.onDetachedFromWindow()
  }

  /** Listens before each frame only while attached and able to move. */
  private fun followOffset() {
    val follow = isAttachedToWindow && travelDp > 0f
    if (!follow) {
      stopFollowing()
      return
    }
    if (observer != null) return
    observer = viewTreeObserver.also { it.addOnPreDrawListener(onPreDraw) }
  }

  private fun stopFollowing() {
    observer?.let { if (it.isAlive) it.removeOnPreDrawListener(onPreDraw) }
    observer = null
    lastOffset = 0f
  }

  private fun contentOffset(): Float = getChildAt(0)?.translationX ?: 0f

  /** The moving edge's strength: 0 at rest, full a fade's length into the loop and until a fade's length before its end. */
  private fun movingStrength(): Float {
    val travel = travelDp * density
    val fade = fadeLengthDp * density
    if (travel <= 0f || fade <= 0f) return 0f
    val offset = abs(contentOffset())
    return (min(offset, travel - offset) / fade).coerceIn(0f, 1f)
  }

  private fun strength(edge: String): Float =
    when {
      fixedEdge == "none" -> 0f
      fixedEdge == edge -> 1f
      else -> movingStrength()
    }

  override fun getLeftFadingEdgeStrength(): Float = strength("left")

  override fun getRightFadingEdgeStrength(): Float = strength("right")
}
