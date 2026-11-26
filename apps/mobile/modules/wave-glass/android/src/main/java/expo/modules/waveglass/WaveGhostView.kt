package expo.modules.waveglass

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.drawable.AnimatedVectorDrawable
import android.graphics.drawable.Drawable
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

/**
 * The mini player's ghost wave (#1498): while the network holds the playing
 * song up, a faint segment of wave sweeps along the pill's bottom edge and
 * fades (`wave_ghost_offline` every 2.4 s, `wave_ghost_slow` every 3.6 s).
 * Still (reduce motion), it's drawn about a third of the way along.
 *
 * The sweep is an AnimatedVectorDrawable, which runs on the RenderThread, as
 * the wavy underline's ripple does (WaveUnderlineView): the UI thread draws no
 * frames for it, so the glass views don't re-record and re-blur their
 * backdrops (issue #93).
 */
class WaveGhostView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private var ghost = ghostFor(OFFLINE)

  var color = Color.WHITE
    set(value) {
      field = value
      ghost.setTint(value)
      invalidate()
    }

  /** `offline` (the default) or `slow`: which period it runs on. */
  var period = OFFLINE
    set(value) {
      if (field == value) return
      field = value
      ghost.stop()
      ghost.callback = null
      ghost = ghostFor(value).apply { setTint(color) }
      syncAnimation()
      invalidate()
    }

  var animating = false
    set(value) {
      if (field == value) return
      field = value
      syncAnimation()
      invalidate()
    }

  private fun ghostFor(period: String): AnimatedVectorDrawable {
    val drawable = if (period == SLOW) R.drawable.wave_ghost_slow else R.drawable.wave_ghost_offline
    return (context.getDrawable(drawable)!!.mutate() as AnimatedVectorDrawable).apply {
      setBounds(0, 0, intrinsicWidth, intrinsicHeight)
      callback = this@WaveGhostView
    }
  }

  init {
    setWillNotDraw(false)
    ghost.setTint(color)
  }

  override fun verifyDrawable(who: Drawable): Boolean = who === ghost || super.verifyDrawable(who)

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    syncAnimation()
  }

  override fun onDetachedFromWindow() {
    ghost.stop()
    super.onDetachedFromWindow()
  }

  private fun syncAnimation() {
    when {
      animating && isAttachedToWindow -> if (!ghost.isRunning) ghost.start()
      ghost.isRunning -> ghost.stop()
    }
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    canvas.save()
    canvas.clipRect(0, 0, width, height)
    canvas.translate(0f, ((height - ghost.intrinsicHeight) / 2).toFloat())
    // Stopped, the drawable shows its start, just left of the view: move it a third of the way in.
    if (!animating) canvas.translate(width / 3f + SEGMENT_DP * resources.displayMetrics.density / 2, 0f)
    ghost.draw(canvas)
    canvas.restore()
  }

  private companion object {
    const val OFFLINE = "offline"
    const val SLOW = "slow"
    /** The segment's length (Core's MINI_GHOST_WAVE.length). */
    const val SEGMENT_DP = 60f
  }
}
