package expo.modules.waveglass

import android.content.Context
import android.view.View
import android.view.ViewTreeObserver
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

/**
 * Lets Now Playing stop paying for the screen under it (issue #721). It fills the
 * sheet, draws nothing and takes no touches. While JS says the sheet settled open
 * ([settled]) and the sheet lies over every pixel of the screen under it
 * ([coveredNativeId]), that screen is `INVISIBLE`: Android neither records nor draws
 * it, and the glass inside it (the tab bar, the Search pill, the mini player), no
 * longer shown, records no backdrop and blurs nothing ([WaveGlassView]).
 *
 * The check runs on every window pre-draw, after the frame's animations and
 * gestures have placed the sheet. So the frame in which the sheet first moves (a
 * drag down, a closing spring), however late JS hears of it, draws the screen
 * again, its glass recording first. Each glass view runs the check too before it
 * decides whether to record ([refreshAll]), so the order of pre-draw listeners
 * never leaves a glass a frame behind. Showing the screen again needs no layout:
 * it stayed laid out and mounted while hidden, and only what changed meanwhile
 * records anew.
 */
class WaveCoverView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  /** `nativeID` of the screen the sheet covers. */
  var coveredNativeId: String? = null
    set(value) {
      if (field == value) return
      show()
      field = value
      covered = null
      refresh()
    }

  /** JS's word that the sheet settled open over the screen; false keeps it drawn. */
  var settled = false
    set(value) {
      field = value
      refresh()
    }

  /** The screen found for [coveredNativeId]; [hidden] while this made it invisible. */
  private var covered: View? = null
  private var hidden: View? = null
  private val location = IntArray(2)

  private val preDrawListener = ViewTreeObserver.OnPreDrawListener {
    refresh()
    true
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    viewTreeObserver.addOnPreDrawListener(preDrawListener)
    attached.add(this)
  }

  override fun onDetachedFromWindow() {
    attached.remove(this)
    viewTreeObserver.removeOnPreDrawListener(preDrawListener)
    show()
    covered = null
    super.onDetachedFromWindow()
  }

  /** Hides or shows the covered screen for where the sheet is now. */
  private fun refresh() {
    // The common case, Now Playing closed or moving: nothing to look up.
    if (!settled) return show()
    val target = findCovered()
    val sheet = if (isShown) boundsOf(this) else null
    val under = target?.let { if (it.isAttachedToWindow) boundsOf(it) else null }
    if (target != null && NowPlayingCover.hides(settled, sheet, under)) hide(target) else show()
  }

  private fun findCovered(): View? {
    covered?.let { if (it.isAttachedToWindow) return it }
    val id = coveredNativeId ?: return null
    covered = findByNativeId(rootView, id)
    return covered
  }

  private fun boundsOf(view: View): WindowBounds {
    view.getLocationInWindow(location)
    return WindowBounds(
      location[0],
      location[1],
      location[0] + view.width,
      location[1] + view.height,
    )
  }

  private fun hide(target: View) {
    if (hidden === target) return
    show()
    // Something else hid it: it isn't this view's to show again.
    if (target.visibility != View.VISIBLE) return
    target.visibility = View.INVISIBLE
    hidden = target
  }

  private fun show() {
    val view = hidden ?: return
    hidden = null
    view.visibility = View.VISIBLE
  }

  companion object {
    /** Every cover in a window; main thread only, as every view callback is. */
    private val attached = mutableSetOf<WaveCoverView>()

    /** Brings each cover up to date for this frame (a glass view asks before it records). */
    internal fun refreshAll() {
      for (cover in attached) cover.refresh()
    }
  }
}
