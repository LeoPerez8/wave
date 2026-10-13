package expo.modules.waveglass

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.drawable.AnimatedVectorDrawable
import android.graphics.drawable.Drawable
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

/**
 * The wavy underline under the playing song's title: the `wave_underline` tile
 * repeated across this view's width, sliding left while `animating`.
 *
 * The slide is an AnimatedVectorDrawable, which runs on the RenderThread. The
 * UI thread never traverses the view tree for it, so the glass views'
 * pre-draw listeners (WaveGlassView) don't fire and don't re-record and re-blur
 * their backdrops every frame (issue #93). A glass that covers the underline
 * still shows it moving: its layer takes the RenderThread damage like any other.
 */
class WaveUnderlineView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val tile =
    (context.getDrawable(R.drawable.wave_underline)!!.mutate() as AnimatedVectorDrawable).apply {
      setBounds(0, 0, intrinsicWidth, intrinsicHeight)
      callback = this@WaveUnderlineView
    }

  var color = Color.WHITE
    set(value) {
      field = value
      tile.setTint(value)
    }

  var animating = false
    set(value) {
      if (field == value) return
      field = value
      syncAnimation()
    }

  init {
    setWillNotDraw(false)
    tile.setTint(color)
  }

  override fun verifyDrawable(who: Drawable): Boolean = who === tile || super.verifyDrawable(who)

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    syncAnimation()
  }

  override fun onDetachedFromWindow() {
    tile.stop()
    super.onDetachedFromWindow()
  }

  private fun syncAnimation() {
    when {
      animating && isAttachedToWindow -> if (!tile.isRunning) tile.start()
      tile.isRunning -> tile.stop()
    }
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    val step = tile.intrinsicWidth
    if (step <= 0) return
    canvas.save()
    canvas.clipRect(0, 0, width, height)
    canvas.translate(0f, ((height - tile.intrinsicHeight) / 2).toFloat())
    var x = 0
    while (x < width) {
      tile.draw(canvas)
      canvas.translate(step.toFloat(), 0f)
      x += step
    }
    canvas.restore()
  }
}
