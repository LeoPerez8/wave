package expo.modules.wavenative.player

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import com.facebook.react.ReactApplication
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext

/**
 * Keeps Wave's React Native runtime running for Android Auto, with or without
 * the Activity.
 *
 * [ensureStarted] starts the app's (single, lazy) `ReactHost` if it isn't
 * running, so a cold start from Auto loads the JS bundle headless. The Activity
 * opening later attaches to the same host, so there is one JS runtime and one
 * set of app services. It then holds the `WaveService` headless task, whose JS
 * side starts the app services (`apps/mobile/index.ts`). While a headless task
 * runs, React Native keeps JS timers going without a resumed Activity; Wave's
 * queue and play history rely on them. [release] ends the task; the runtime
 * itself is never torn down here.
 *
 * Main thread only.
 */
object JsRuntime {
  const val TASK_KEY = "WaveService"
  const val LOG_TAG = "WaveAuto"

  private val main = Handler(Looper.getMainLooper())
  private var taskId: Int? = null
  private var taskContext: ReactContext? = null
  private val owners = RuntimeOwners()
  private var listening = false

  private val listener = object : ReactInstanceEventListener {
    override fun onReactContextInitialized(context: ReactContext) {
      Log.i(LOG_TAG, "JS runtime ready at ${SystemClock.elapsedRealtime()} ms")
      if (owners.isWanted()) startTask(context)
    }
  }

  /** Starts the runtime (if needed) and holds the headless task. */
  fun ensureStarted(context: Context, owner: String = "auto") {
    check(Looper.myLooper() == Looper.getMainLooper()) { "JsRuntime is main-thread only" }
    owners.acquire(owner)
    val host = (context.applicationContext as? ReactApplication)?.reactHost ?: run {
      Log.w(LOG_TAG, "No ReactHost: can't start JS for Auto")
      return
    }
    val current = host.currentReactContext
    if (current != null && current.hasActiveReactInstance()) {
      startTask(current)
      return
    }
    if (!listening) {
      listening = true
      host.addReactInstanceEventListener(listener)
    }
    Log.i(LOG_TAG, "Starting JS runtime headless at ${SystemClock.elapsedRealtime()} ms")
    // Idempotent: a host that is already starting returns the same task.
    host.start()
  }

  /** Ends the headless task, e.g. when Auto disconnects or the service is destroyed. */
  fun release(owner: String = "auto") {
    check(Looper.myLooper() == Looper.getMainLooper()) { "JsRuntime is main-thread only" }
    owners.release(owner)
    if (owners.isWanted()) return
    val id = taskId ?: return
    val context = taskContext
    taskId = null
    taskContext = null
    if (context != null) {
      val tasks = HeadlessJsTaskContext.getInstance(context)
      if (tasks.isTaskRunning(id)) tasks.finishTask(id)
    }
  }

  /** Starts the task unless it already runs in [context]. */
  private fun startTask(context: ReactContext) {
    // Posted so a start from React Native's own callback doesn't re-enter it.
    main.post {
      val tasks = HeadlessJsTaskContext.getInstance(context)
      val running = taskId
      if (!owners.isWanted() || (running != null && taskContext === context && tasks.isTaskRunning(running))) {
        return@post
      }
      Log.i(LOG_TAG, "Starting the $TASK_KEY headless task")
      taskId = tasks.startTask(
        HeadlessJsTaskConfig(
          TASK_KEY,
          Arguments.createMap(),
          /* timeout = */ 0,
          /* isAllowedInForeground = */ true,
        ),
      )
      taskContext = context
    }
  }
}
