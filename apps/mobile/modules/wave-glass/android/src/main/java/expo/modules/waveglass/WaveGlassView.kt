package expo.modules.waveglass

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.RenderEffect
import android.graphics.RenderNode
import android.graphics.RuntimeShader
import android.graphics.Shader
import android.os.Build
import android.view.View
import android.view.ViewTreeObserver
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

/**
 * A glass surface drawn from the views behind it (the tab bar and mini player;
 * chosen in the spike, issue #4, see docs/glass-spike.md).
 *
 * Whenever the window draws a frame, the backdrop view (found by its React
 * `nativeID`) is recorded into a RenderNode — which only references the
 * backdrop's existing display lists, so it's cheap — offset so the part under
 * this view lines up. The node gets a RenderEffect: Gaussian blur, then
 * (API 33+, `refraction > 0`) an AGSL shader that bends the backdrop near the
 * rounded edge and adds a specular rim. A tint and a rim stroke are drawn on
 * top. All of it runs on the RenderThread.
 *
 * The view never schedules frames itself: this view's display list only
 * references the node, and the RenderThread syncs the node's new recording with
 * whatever frame the window is drawing anyway (a scroll, an image loading). So
 * an idle screen renders no frames, and a scroll costs one re-record per frame.
 * A glass that isn't shown skips its recording, as under a settled Now Playing
 * ([WaveCoverView], issue #721). With [coalesce] (a glass probe,
 * issue #316), the glass over one backdrop share one recording ([SharedBackdrop]).
 */
class WaveGlassView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val density = resources.displayMetrics.density

  /** Null draws the tint and rim alone, recording nothing (the glass probe's `off`). */
  var backdropNativeId: String? = null
    set(value) {
      field = value
      backdrop = null
      releaseShared()
      if (value == null) {
        node.discardDisplayList()
        invalidate()
      }
    }
  var blurRadiusDp = 24f
    set(value) {
      field = value
      effectDirty = true
    }
  var refractionDp = 12f
    set(value) {
      field = value
      effectDirty = true
    }

  /** Share one backdrop recording with the other glass over it ([SharedBackdrop]). */
  var coalesce = false
    set(value) {
      if (field == value) return
      field = value
      releaseShared()
      node.discardDisplayList()
      invalidate()
    }
  var cornerRadiusDp = 32f
    set(value) {
      field = value
      effectDirty = true
      invalidate()
    }
  var tintColor = Color.argb(40, 255, 255, 255)
    set(value) {
      field = value
      invalidate()
    }
  var rimEnabled = true
    set(value) {
      field = value
      invalidate()
    }

  private val node = RenderNode("WaveGlassBackdrop")
  private var backdrop: View? = null
  private var effectDirty = true
  private val clipPath = Path()
  private val bounds = RectF()
  private val tintPaint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val rimPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
  private val ownLocation = IntArray(2)
  private val backdropLocation = IntArray(2)

  /** The coalesced recording this view draws, and where it last drew it from. */
  private var shared: SharedBackdrop? = null
  private var sharedDx = 0
  private var sharedDy = 0
  private var sharedWidth = -1
  private var sharedHeight = -1

  private val preDrawListener = ViewTreeObserver.OnPreDrawListener {
    // Now Playing hides or shows the screen under it first, whichever pre-draw runs first.
    WaveCoverView.refreshAll()
    // A glass that isn't shown (it or an ancestor not VISIBLE, as under a settled Now Playing)
    // draws nothing this frame, so its recording would go unused. Shown again, the next
    // pre-draw records before it draws.
    if (isShown) {
      val hadContent = node.hasDisplayList()
      val recorded = if (coalesce) recordShared() else recordBackdrop()
      // Only the first recording needs a redraw of this view, to put the node in its display list.
      if (recorded && !hadContent) invalidate()
    }
    true
  }

  init {
    setWillNotDraw(false)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    viewTreeObserver.addOnPreDrawListener(preDrawListener)
  }

  override fun onDetachedFromWindow() {
    viewTreeObserver.removeOnPreDrawListener(preDrawListener)
    backdrop = null
    releaseShared()
    super.onDetachedFromWindow()
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    effectDirty = true
    rimPaint.shader = LinearGradient(
      0f,
      0f,
      0f,
      h.toFloat(),
      Color.argb(150, 255, 255, 255),
      Color.argb(30, 255, 255, 255),
      Shader.TileMode.CLAMP,
    )
  }

  private fun findBackdrop(): View? {
    backdrop?.let { if (it.isAttachedToWindow) return it }
    val id = backdropNativeId ?: return null
    backdrop = findByNativeId(rootView, id)
    return backdrop
  }

  /** Re-records the backdrop under this view. Returns false when there's nothing to draw. */
  private fun recordBackdrop(): Boolean {
    val target = findBackdrop() ?: return false
    if (width == 0 || height == 0) return false
    getLocationInWindow(ownLocation)
    target.getLocationInWindow(backdropLocation)
    node.setPosition(0, 0, width, height)
    if (effectDirty) updateEffect()
    val canvas = node.beginRecording(width, height)
    try {
      canvas.translate(
        (backdropLocation[0] - ownLocation[0]).toFloat(),
        (backdropLocation[1] - ownLocation[1]).toFloat(),
      )
      target.draw(canvas)
    } finally {
      node.endRecording()
    }
    return true
  }

  /**
   * The coalesced path: brings the shared recording up to date (at most once a
   * frame across the glass over the backdrop), then re-records this view's node,
   * which only offsets and references the shared one, when the offset or size
   * moved. Draws the same pixels as [recordBackdrop].
   */
  private fun recordShared(): Boolean {
    val target = findBackdrop() ?: return false
    if (width == 0 || height == 0) return false
    val current = shared
    val backdropRecording =
      if (current != null && current.target === target) {
        current
      } else {
        releaseShared()
        SharedBackdrop.acquire(target).also { shared = it }
      }
    if (!backdropRecording.update()) return false
    getLocationInWindow(ownLocation)
    target.getLocationInWindow(backdropLocation)
    val dx = backdropLocation[0] - ownLocation[0]
    val dy = backdropLocation[1] - ownLocation[1]
    if (effectDirty) updateEffect()
    val moved = dx != sharedDx || dy != sharedDy || width != sharedWidth || height != sharedHeight
    if (node.hasDisplayList() && !moved) return true
    node.setPosition(0, 0, width, height)
    val canvas = node.beginRecording(width, height)
    try {
      canvas.translate(dx.toFloat(), dy.toFloat())
      canvas.drawRenderNode(backdropRecording.node)
    } finally {
      node.endRecording()
    }
    sharedDx = dx
    sharedDy = dy
    sharedWidth = width
    sharedHeight = height
    return true
  }

  private fun releaseShared() {
    val current = shared ?: return
    shared = null
    current.release()
    // The next coalesced recording starts over, whichever backdrop it draws.
    sharedWidth = -1
    sharedHeight = -1
  }

  private fun updateEffect() {
    effectDirty = false
    val radius = blurRadiusDp * density
    val blur =
      if (radius > 0f) RenderEffect.createBlurEffect(radius, radius, Shader.TileMode.CLAMP) else null
    val refraction =
      if (refractionDp > 0f && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        RuntimeShader(REFRACTION_SHADER).run {
          setFloatUniform("size", width.toFloat(), height.toFloat())
          setFloatUniform("radius", minOf(cornerRadiusDp * density, minOf(width, height) / 2f))
          setFloatUniform("refraction", refractionDp * density)
          setFloatUniform("edge", 16f * density)
          RenderEffect.createRuntimeShaderEffect(this, "content")
        }
      } else {
        null
      }
    node.setRenderEffect(
      when {
        blur != null && refraction != null -> RenderEffect.createChainEffect(refraction, blur)
        else -> refraction ?: blur
      },
    )
  }

  override fun draw(canvas: Canvas) {
    val radius = minOf(cornerRadiusDp * density, minOf(width, height) / 2f)
    bounds.set(0f, 0f, width.toFloat(), height.toFloat())
    clipPath.reset()
    clipPath.addRoundRect(bounds, radius, radius, Path.Direction.CW)

    canvas.save()
    canvas.clipPath(clipPath)
    if (canvas.isHardwareAccelerated && node.hasDisplayList()) canvas.drawRenderNode(node)
    tintPaint.color = tintColor
    canvas.drawRect(bounds, tintPaint)
    canvas.restore()

    if (rimEnabled) {
      val stroke = density
      rimPaint.strokeWidth = stroke
      bounds.inset(stroke / 2, stroke / 2)
      canvas.drawRoundRect(bounds, radius, radius, rimPaint)
    }
    super.draw(canvas)
  }

  private companion object {
    /** Lens-like refraction at the rounded edge plus a specular rim, lit from the top left. */
    const val REFRACTION_SHADER = """
      uniform shader content;
      uniform float2 size;
      uniform float radius;
      uniform float refraction;
      uniform float edge;

      float roundRect(float2 p, float2 b, float r) {
        float2 q = abs(p) - b + r;
        return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
      }

      half4 main(float2 coord) {
        float2 halfSize = size * 0.5;
        float2 p = coord - halfSize;
        float d = roundRect(p, halfSize, radius);
        // 0 inside, rising to 1 at the rim.
        float t = clamp(1.0 + d / edge, 0.0, 1.0);
        float2 e = float2(1.0, 0.0);
        float2 n = float2(
          roundRect(p + e.xy, halfSize, radius) - roundRect(p - e.xy, halfSize, radius),
          roundRect(p + e.yx, halfSize, radius) - roundRect(p - e.yx, halfSize, radius));
        n = n / max(length(n), 0.0001);
        half4 color = content.eval(coord - n * (t * t * t * refraction));
        float light = clamp(dot(n, normalize(float2(-0.5, -1.0))), 0.0, 1.0);
        color.rgb += half3(pow(t, 8.0) * light * 0.35);
        return color;
      }
    """
  }
}
