package expo.modules.waveglass

import android.graphics.RenderNode
import android.view.View
import java.util.WeakHashMap

/**
 * One recording of a backdrop view, shared by every coalescing glass view over it
 * (the glass probe's `coalesced`, issue #316; not the shipped default until a
 * phone measures it).
 *
 * The live glass has each glass view record the whole backdrop on every window
 * pre-draw: three glass views over the tabs make three recordings per frame,
 * even for a frame the backdrop had no part in (the mini player's own content,
 * an overlay). This records it once, and only when the backdrop is dirty, or on
 * its first use or a size change. Each glass view then draws this node by
 * reference, offset to line up.
 *
 * Why the skip is safe: a recording holds the backdrop's own drawing plus
 * references to its children's RenderNodes, never copies, so a child's new
 * display list or moved RenderNode shows through without a new recording. What a
 * recording copies changes only through the backdrop being drawn again, and any
 * invalidation of the backdrop or of anything inside it marks the backdrop dirty
 * (`View.isDirty`) until it's drawn. Recording draws it, which clears the flag, so
 * the first glass view to look in a frame records and the others reuse that.
 */
internal class SharedBackdrop private constructor(val target: View) {
  /** Not clipped to the backdrop, as the live glass's own recording isn't. */
  val node = RenderNode("WaveGlassSharedBackdrop").apply { setClipToBounds(false) }
  private var users = 0
  private var recordedWidth = -1
  private var recordedHeight = -1

  /** Records [target] if it changed since the last recording. False while there's nothing to draw. */
  fun update(): Boolean {
    val width = target.width
    val height = target.height
    if (width == 0 || height == 0) return false
    val current =
      node.hasDisplayList() && !target.isDirty && width == recordedWidth && height == recordedHeight
    if (current) return true
    node.setPosition(0, 0, width, height)
    val canvas = node.beginRecording(width, height)
    try {
      target.draw(canvas)
    } finally {
      node.endRecording()
    }
    recordedWidth = width
    recordedHeight = height
    return true
  }

  fun release() {
    users--
    if (users > 0) return
    shared.remove(target)
    node.discardDisplayList()
  }

  companion object {
    /** By backdrop view; main thread only, as every view callback is. */
    private val shared = WeakHashMap<View, SharedBackdrop>()

    /** The shared recording of [target], counting the caller as a user until it calls [release]. */
    fun acquire(target: View): SharedBackdrop =
      shared.getOrPut(target) { SharedBackdrop(target) }.also { it.users++ }
  }
}
