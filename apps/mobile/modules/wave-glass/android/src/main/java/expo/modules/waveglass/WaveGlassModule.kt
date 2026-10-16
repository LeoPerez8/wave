package expo.modules.waveglass

import android.graphics.Color
import android.os.Handler
import android.os.HandlerThread
import android.view.FrameMetrics
import android.view.Window
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The native glass view (the tab bar and mini player material) and a
 * frame-time meter used by the glass spike screen (issue #4).
 *
 * The meter listens to FrameMetrics for the current window, so it measures what
 * the RenderThread and GPU actually took per frame (where blur and shaders cost
 * time), not just the JS or UI thread. Every 500 ms it emits `onFrameStats`.
 */
class WaveGlassModule : Module() {
  private var metricsThread: HandlerThread? = null
  private var window: Window? = null
  private var listener: Window.OnFrameMetricsAvailableListener? = null

  override fun definition() = ModuleDefinition {
    Name("WaveGlass")

    Events("onFrameStats")

    Function("startFrameStats") { startFrameStats() }
    Function("stopFrameStats") { stopFrameStats() }

    // The glass probe the release runner launched Wave with (`am start --es`, issue #316).
    // Only a perf build's JS asks; null without a probe or before the activity is known.
    Function("perfGlassProbe") {
      appContext.currentActivity?.intent?.getStringExtra(GLASS_PROBE_EXTRA)
    }

    OnDestroy { stopFrameStats() }

    View(WaveGlassView::class) {
      Prop("backdropNativeId") { view: WaveGlassView, id: String? -> view.backdropNativeId = id }
      Prop("blurRadius") { view: WaveGlassView, radius: Float -> view.blurRadiusDp = radius }
      Prop("refraction") { view: WaveGlassView, amount: Float -> view.refractionDp = amount }
      Prop("cornerRadius") { view: WaveGlassView, radius: Float -> view.cornerRadiusDp = radius }
      Prop("tintColor") { view: WaveGlassView, color: Color? ->
        view.tintColor = color?.toArgb() ?: Color.TRANSPARENT
      }
      Prop("rim") { view: WaveGlassView, enabled: Boolean -> view.rimEnabled = enabled }
      Prop("coalesce") { view: WaveGlassView, enabled: Boolean -> view.coalesce = enabled }
    }

    View(WaveUnderlineView::class) {
      Name("WaveUnderline")
      Prop("color") { view: WaveUnderlineView, color: Color? ->
        view.color = color?.toArgb() ?: Color.TRANSPARENT
      }
      Prop("animating") { view: WaveUnderlineView, animating: Boolean -> view.animating = animating }
    }
  }

  private fun startFrameStats() {
    val activity = appContext.currentActivity ?: return
    activity.runOnUiThread {
      stopFrameStats()
      val thread = HandlerThread("wave-frame-stats").apply { start() }
      val refreshRate = activity.display?.refreshRate ?: 60f
      val window = activity.window
      val durations = ArrayList<Double>(256)
      var missed = 0
      var windowStart = System.nanoTime()
      val listener = Window.OnFrameMetricsAvailableListener { _, metrics, _ ->
        val total = metrics.getMetric(FrameMetrics.TOTAL_DURATION)
        val deadline = metrics.getMetric(FrameMetrics.DEADLINE)
        durations.add(total / 1_000_000.0)
        if (deadline > 0 && total > deadline) missed++
        val now = System.nanoTime()
        val elapsed = (now - windowStart) / 1_000_000_000.0
        if (elapsed >= 0.5) {
          val sorted = durations.sorted()
          sendEvent(
            "onFrameStats",
            mapOf(
              "fps" to durations.size / elapsed,
              "frames" to durations.size,
              "avgFrameMs" to durations.average(),
              "p95FrameMs" to sorted[((sorted.size - 1) * 0.95).toInt()],
              "maxFrameMs" to sorted.last(),
              "missedDeadlines" to missed,
              "refreshRate" to refreshRate.toDouble(),
            ),
          )
          durations.clear()
          missed = 0
          windowStart = now
        }
      }
      window.addOnFrameMetricsAvailableListener(listener, Handler(thread.looper))
      this.metricsThread = thread
      this.window = window
      this.listener = listener
    }
  }

  private fun stopFrameStats() {
    val window = window
    val listener = listener
    if (window != null && listener != null) {
      runCatching { window.removeOnFrameMetricsAvailableListener(listener) }
    }
    metricsThread?.quitSafely()
    metricsThread = null
    this.window = null
    this.listener = null
  }

  private companion object {
    /** Core's `GLASS_PROBE_EXTRA`. */
    const val GLASS_PROBE_EXTRA = "wave.perf.glass"
  }
}
