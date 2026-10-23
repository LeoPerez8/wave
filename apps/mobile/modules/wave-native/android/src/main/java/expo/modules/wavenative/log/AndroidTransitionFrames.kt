package expo.modules.wavenative.log

import android.content.Context
import android.hardware.display.DisplayManager
import android.os.Handler
import android.os.Looper
import android.view.Choreographer
import android.view.Display
import java.util.concurrent.ConcurrentHashMap

/** No Choreographer callback is installed at rest. Commands capture their time before main queues them. */
class AndroidTransitionFrames(private val context: () -> Context) {
  private val main = Handler(Looper.getMainLooper())
  private val endings = ConcurrentHashMap<Int, Double>()
  private var active: Int? = null
  @Volatile private var foreground = true
  private val frames = TransitionFrames(::intervalMs) { callback ->
    val expected = active
    val choreographer = Choreographer.getInstance()
    val frame = Choreographer.FrameCallback { nanos ->
      val end = expected?.let { endings[it] }
      val at = nanos / 1_000_000.0
      // The JS settled signal can arrive while main is blocked. Ignore callbacks beyond it.
      if (end == null || at <= end) callback(at)
    }
    choreographer.postFrameCallback(frame)
    ({ choreographer.removeFrameCallback(frame) })
  }

  fun intervalMs(): Double {
    val display = context().getSystemService(DisplayManager::class.java)?.getDisplay(Display.DEFAULT_DISPLAY)
    val hz = display?.refreshRate?.toDouble() ?: return 0.0
    return if (hz > 0) 1000.0 / hz else 0.0
  }

  fun start(id: Int, ageMs: Double) {
    val at = System.nanoTime() / 1_000_000.0 - ageMs
    main.post {
      if (!foreground) return@post
      active = id
      frames.start(id, at)
    }
  }

  fun stop(id: Int, report: (FrameTotals?) -> Unit) {
    val at = System.nanoTime() / 1_000_000.0
    endings[id] = at
    main.post {
      val result = frames.stop(id, at)
      if (active == id) active = null
      endings.remove(id)
      report(result)
    }
  }

  /** Called on main by Expo lifecycle events, independently of a delayed JS AppState callback. */
  fun foreground() { foreground = true }

  fun background() {
    foreground = false
    clear()
  }

  fun clear() {
    active = null
    frames.clear()
    endings.clear()
  }
}
