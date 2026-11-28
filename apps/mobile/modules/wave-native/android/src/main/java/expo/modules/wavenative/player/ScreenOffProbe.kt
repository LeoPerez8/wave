package expo.modules.wavenative.player

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Handler
import android.os.SystemClock
import android.view.Choreographer
import androidx.core.content.ContextCompat
import expo.modules.wavenative.log.WaveLog

/**
 * [DEBUG-5d1a] Temporary diagnosis: does a phone with the screen off still give
 * Wave's process frames (React Native fires JS timers on Choreographer frames),
 * does the WaveService headless task still run, and do JS timers still tick
 * (`debugJsHeartbeat`, every 30 s from `src/log/startAppLog.ts`)? A Magic Queue
 * batch on a user's phone waited 10 minutes with the screen off while playback
 * held the runtime. Remove this file, its uses and the JS heartbeat once answered.
 *
 * Main thread only, apart from [jsHeartbeat].
 */
class ScreenOffProbe(
  private val context: Context,
  private val main: Handler,
  /** The player's and the runtime's state now, for each line. */
  private val state: () -> String,
) {
  private var offAtMs: Long? = null
  private var framesThisMinute = 0
  private var minutes = 0

  private val frames = object : Choreographer.FrameCallback {
    override fun doFrame(frameTimeNanos: Long) {
      if (offAtMs == null) return
      framesThisMinute++
      Choreographer.getInstance().postFrameCallback(this)
    }
  }

  private val tick = object : Runnable {
    override fun run() {
      val off = offAtMs ?: return
      minutes++
      // Every minute for the first 10, then every 10 minutes.
      if (minutes <= 10 || minutes % 10 == 0) {
        val sinceMs = SystemClock.elapsedRealtime() - off
        log("Screen off ${PauseLog.duration(sinceMs)}: $framesThisMinute frames in the last minute, ${heartbeat()}, ${state()}")
      }
      framesThisMinute = 0
      main.postDelayed(this, 60_000L)
    }
  }

  private val receiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      when (intent.action) {
        Intent.ACTION_SCREEN_OFF -> screenOff()
        Intent.ACTION_SCREEN_ON -> screenOn()
      }
    }
  }

  fun start() {
    val filter = IntentFilter().apply {
      addAction(Intent.ACTION_SCREEN_OFF)
      addAction(Intent.ACTION_SCREEN_ON)
    }
    ContextCompat.registerReceiver(context, receiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
  }

  fun stop() {
    runCatching { context.unregisterReceiver(receiver) }
    stopWatching()
  }

  private fun screenOff() {
    if (offAtMs != null) return
    offAtMs = SystemClock.elapsedRealtime()
    framesThisMinute = 0
    minutes = 0
    log("Screen off: ${heartbeat()}, ${state()}")
    Choreographer.getInstance().postFrameCallback(frames)
    main.postDelayed(tick, 60_000L)
  }

  private fun screenOn() {
    val off = offAtMs ?: return
    log("Screen on after ${PauseLog.duration(SystemClock.elapsedRealtime() - off)}: ${heartbeat()}, ${state()}")
    stopWatching()
  }

  private fun stopWatching() {
    offAtMs = null
    main.removeCallbacks(tick)
    Choreographer.getInstance().removeFrameCallback(frames)
  }

  private fun heartbeat(): String {
    val at = jsBeatAtMs
    return if (at == 0L) "no JS heartbeat yet" else "JS heartbeat ${PauseLog.duration(SystemClock.elapsedRealtime() - at)} ago"
  }

  private fun log(text: String) = WaveLog.i(LOG_TAG, "[DEBUG-5d1a] $text")

  companion object {
    private const val LOG_TAG = "WaveDebug"

    @Volatile
    private var jsBeatAtMs = 0L

    /** A JS timer fired: called from `debugJsHeartbeat`. */
    fun jsHeartbeat() {
      jsBeatAtMs = SystemClock.elapsedRealtime()
    }
  }
}
