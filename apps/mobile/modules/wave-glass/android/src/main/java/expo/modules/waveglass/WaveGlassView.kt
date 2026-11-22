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
 * When the backdrop view (found by its React `nativeID`) changed, this view's
 * pre-draw invalidates it, and its draw records the backdrop into a RenderNode —
 * which only references the backdrop's display lists, re-recorded by the window
 * just before, so it's cheap — offset so the part under this view lines up.
 * Recording waits for the draw so it runs inside the window's draw pass
 * ([BackdropRecording] says why: recording from the pre-draw crashed, #1432).
 * The node gets a RenderEffect: Gaussian blur, then
 * (API 33+, `refraction > 0`) an AGSL shader that bends the backdrop near the
 * rounded edge and adds a specular rim. A tint and a rim stroke are drawn on
 * top. All of it runs on the RenderThread.
 *
 * The view schedules no frames of its own beyond one: invalidating from the
 * pre-draw asks for the next frame too, which finds nothing changed and draws
 * nothing. So an idle screen renders no frames, and a scroll costs one re-record
 * per frame.
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
      recordPending = true
      if (value == null) node.discardDisplayList()
      invalidate()
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

  /** How strong the rim stroke is, in percent of the shipped one ([GlassRim]); 0 draws none. */
  var rimStrength = GlassRim.SHIPPED
    set(value) {
      if (field == value) return
      field = value
      updateRimShader()
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

  /** The coalesced recording this view draws ([SharedBackdrop]). */
  private var shared: SharedBackdrop? = null

  /** Where this view last recorded the backdrop from; null when it starts over. */
  private var recordedPlace: BackdropPlace? = null

  /** Set by a pre-draw that found the backdrop changed; this view's next draw records it. */
  private var recordPending = false

  /** Whether this view was shown at the last pre-draw. */
  private var shownBefore = false

  private val preDrawListener = ViewTreeObserver.OnPreDrawListener {
    // Now Playing hides or shows the screen under it first, whichever pre-draw runs first.
    WaveCoverView.refreshAll()
    // A glass that isn't shown (it or an ancestor not VISIBLE, as under a settled Now Playing)
    // draws nothing this frame, so it records nothing. Shown again, it records in its next draw.
    val shown = isShown
    if (shown && needsRecording()) {
      recordPending = true
      invalidate()
    }
    shownBefore = shown
    true
  }

  init {
    setWillNotDraw(false)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    shownBefore = false
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
    updateRimShader()
  }

  /** The rim's gradient, brighter at the top, at [rimStrength] down this view's height. */
  private fun updateRimShader() {
    rimPaint.shader = LinearGradient(
      0f,
      0f,
      0f,
      height.toFloat(),
      Color.argb(GlassRim.alpha(GlassRim.TOP_ALPHA, rimStrength), 255, 255, 255),
      Color.argb(GlassRim.alpha(GlassRim.BOTTOM_ALPHA, rimStrength), 255, 255, 255),
      Shader.TileMode.CLAMP,
    )
  }

  private fun findBackdrop(): View? {
    backdrop?.let { if (it.isAttachedToWindow) return it }
    val id = backdropNativeId ?: return null
    backdrop = findByNativeId(rootView, id)
    return backdrop
  }

  /** Where [target] lies relative to this view, with this view's size; null while this view is unsized. */
  private fun placeOver(target: View): BackdropPlace? {
    if (width == 0 || height == 0) return null
    getLocationInWindow(ownLocation)
    target.getLocationInWindow(backdropLocation)
    return BackdropPlace(
      backdropLocation[0] - ownLocation[0],
      backdropLocation[1] - ownLocation[1],
      width,
      height,
    )
  }

  /** From the pre-draw: whether this frame's draw should record the backdrop ([BackdropRecording]). */
  private fun needsRecording(): Boolean {
    if (width == 0 || height == 0) return false
    if (recordPending || effectDirty) return true
    val target = findBackdrop() ?: return false
    val place = placeOver(target) ?: return false
    val changed =
      if (coalesce) sharedFor(target).noteChanges(unwatched = !shownBefore) else target.isDirty
    val recorded = if (node.hasDisplayList()) recordedPlace else null
    return BackdropRecording.needed(shownBefore, changed, recorded, place)
  }

  /** From this view's draw, inside the window's draw pass: records the backdrop under this view. */
  private fun record() {
    recordPending = false
    val target = findBackdrop() ?: return
    val place = placeOver(target) ?: return
    if (coalesce) recordShared(target, place) else recordBackdrop(target, place)
  }

  private fun recordBackdrop(target: View, place: BackdropPlace) {
    node.setPosition(0, 0, width, height)
    val canvas = node.beginRecording(width, height)
    try {
      canvas.translate(place.dx.toFloat(), place.dy.toFloat())
      target.draw(canvas)
    } finally {
      node.endRecording()
    }
    recordedPlace = place
  }

  /**
   * The coalesced path: brings the shared recording up to date (at most once a
   * frame across the glass over the backdrop), then re-records this view's node,
   * which only offsets and references the shared one, when the offset or size
   * moved. Draws the same pixels as [recordBackdrop].
   */
  private fun recordShared(target: View, place: BackdropPlace) {
    val backdropRecording = sharedFor(target)
    if (!backdropRecording.update()) return
    if (node.hasDisplayList() && place == recordedPlace) return
    node.setPosition(0, 0, width, height)
    val canvas = node.beginRecording(width, height)
    try {
      canvas.translate(place.dx.toFloat(), place.dy.toFloat())
      canvas.drawRenderNode(backdropRecording.node)
    } finally {
      node.endRecording()
    }
    recordedPlace = place
  }

  /** The shared recording of [target], joining it (and leaving any other) on first use. */
  private fun sharedFor(target: View): SharedBackdrop {
    val current = shared
    if (current != null && current.target === target) return current
    releaseShared()
    return SharedBackdrop.acquire(target).also { shared = it }
  }

  private fun releaseShared() {
    val current = shared ?: return
    shared = null
    current.release()
    // The next coalesced recording starts over, whichever backdrop it draws.
    recordedPlace = null
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
    if (canvas.isHardwareAccelerated && width > 0 && height > 0) {
      if (effectDirty) updateEffect()
      if (recordPending || !node.hasDisplayList()) record()
    }
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

    if (rimStrength > 0f) {
      val stroke = GlassRim.widthDp(rimStrength) * density
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
