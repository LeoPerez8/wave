package expo.modules.wavenative.recognize

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.projection.MediaProjectionConfig
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.wavenative.player.ActiveWaveAudio
import java.io.File
import java.util.Locale
import java.util.TimeZone
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Captures in memory; Core owns the source choice, listening schedule and outcome. */
class RecognizeModule : Module() {
  private val context: Context get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()
  private val main = Handler(Looper.getMainLooper())
  private val sessions = RecognizeSessions(::recognize,
    onHeard = { id, ms, audible -> sendEvent(HEARD, mapOf("session" to id, "heardMs" to ms, "audible" to audible)) },
    onCaptureFailed = { id -> sendEvent(CAPTURE_FAILED, mapOf("session" to id)) })
  /** Kept from the first start, so an ask never needs the React context. */
  private var installId: ShazamInstallId? = null
  private var lastRequestCode = 17710
  private var pending: PendingStart? = null
  private var foreground = true
  private val tile = RecognizeTileRun.shared

  private class PendingStart(val request: Int, val code: Int, val promise: Promise) {
    var cancelCapture: (() -> Unit)? = null
    var consent: Pair<Int, Intent>? = null
  }

  override fun definition() = ModuleDefinition {
    Name("WaveRecognize")
    Events(HEARD, CAPTURE_FAILED, "onRecognizeRequested", TILE_REQUESTED, TILE_CANCELLED)

    OnCreate {
      RecognizeInbox.onReceived = { sendEvent("onRecognizeRequested") }
      tile.onRequested = { sendEvent(TILE_REQUESTED) }
      tile.onCancelled = { tap -> sendEvent(TILE_CANCELLED, mapOf("tap" to tap)) }
    }
    Function("takeRequest") { RecognizeInbox.take() }

    Function("takeTileRequest") { tile.take() }
    Function("setCardSession") { running: Boolean -> tile.cardRunning = running }
    Function("tileListeningEnded") { tap: Int -> tile.ended(tap) }
    // A tap may have come in the meantime, and it needs the service.
    Function("tileFinished") { if (!tile.listening) RecognizeListeningService.stop(context) }
    Function("notifyTileMatch") { title: String, text: String, coverUrl: String? ->
      RecognizeNotifications.postMatch(context, title, text, coverUrl)
    }
    Function("notifyTileNoMatch") { title: String, text: String ->
      RecognizeNotifications.postNoMatch(context, title, text)
    }

    AsyncFunction("playbackActivity") {
      val media = if (Build.VERSION.SDK_INT < 29) 0 else
        context.getSystemService(AudioManager::class.java).activePlaybackConfigurations.count {
          it.audioAttributes.usage in MEDIA_USAGES
        }
      mapOf("activeMediaPlayers" to media, "waveMediaPlayers" to ActiveWaveAudio.count())
    }.runOnQueue(Queues.MAIN)

    // A request id lets JS cancel even while start is waiting for Android's consent result.
    // It is also the session's id, so JS knows it before any event names it.
    AsyncFunction("start") { source: String, request: Int, promise: Promise ->
      begin(source, request, promise, detached = false)
    }.runOnQueue(Queues.MAIN)

    // The tile's session, which doesn't end with Wave's screen. Its foreground service
    // (RecognizeListeningService) is what lets it keep the microphone in the background.
    AsyncFunction("startDetached") { request: Int, promise: Promise ->
      begin("microphone", request, promise, detached = true)
    }.runOnQueue(Queues.MAIN)

    OnActivityResult { _, result ->
      val start = pending
      if (start != null && result.requestCode == start.code) {
        val data = result.data
        if (result.resultCode != Activity.RESULT_OK || data == null) {
          pending = null
          start.promise.reject("ERR_RECOGNIZE_CONSENT", "Phone audio access declined", null)
        } else {
          start.consent = result.resultCode to data
          startPlaybackWhenForeground(start)
        }
      }
    }

    Function("cancelStart") { request: Int ->
      main.post { if (pending?.request == request) cancelPending() }
    }

    // ERR_RECOGNIZE_ENDED: the session is gone (its capture is over). ERR_RECOGNIZE_ASK:
    //  anything else kept the request from going, which says nothing about the capture.
    AsyncFunction("ask") Coroutine { id: Int, last: Boolean, windowMs: Int ->
      try {
        withContext(Dispatchers.IO) { sessions.ask(id, last, windowMs).toMap() }
      } catch (_: RecognizeSessionEnded) {
        throw CodedException("ERR_RECOGNIZE_ENDED", "The session has ended", null)
      } catch (e: CancellationException) {
        throw e
      } catch (e: Exception) {
        throw CodedException("ERR_RECOGNIZE_ASK", e.message, e)
      }
    }

    Function("stop") { id: Int -> sessions.stop(id) }

    OnActivityEntersForeground {
      foreground = true
      pending?.let(::startPlaybackWhenForeground)
    }

    OnActivityEntersBackground {
      foreground = false
      // Consent itself can pause the activity. Only cancel a start already binding its service.
      if (pending?.cancelCapture != null) cancelPending()
      // Wave's own stop, not a capture failure: JS cancels the session when it sees the background.
      sessions.stopScreenSession()
    }

    OnDestroy {
      RecognizeInbox.onReceived = null
      tile.onRequested = null
      tile.onCancelled = null
      tile.cardRunning = false
      main.post { cancelPending() }
      sessions.stopAll()
    }
  }

  private fun begin(source: String, request: Int, promise: Promise, detached: Boolean) {
    cancelPending()
    sessions.stopAll()
    try {
      require(source == "microphone" || source == "playback") { "Unknown source $source" }
      if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
        throw CodedException("ERR_RECOGNIZE_PERMISSION", "Wave may not capture audio", null)
      }
      if (installId == null) installId = ShazamInstallId(File(context.filesDir, "recognize/shazam-install-id"))
      if (source == "microphone") {
        sessions.start(request, MicrophoneAudio.open(), detached) { promise.resolve(it) }
      } else {
        check(Build.VERSION.SDK_INT >= 29) { "Phone audio capture requires Android 10" }
        val activity = appContext.currentActivity ?: throw Exceptions.MissingActivity()
        val manager = context.getSystemService(MediaProjectionManager::class.java)
        // Capture across the phone, rather than the single-app default on Android 14+.
        val intent = if (Build.VERSION.SDK_INT >= 34)
          manager.createScreenCaptureIntent(MediaProjectionConfig.createConfigForDefaultDisplay())
        else manager.createScreenCaptureIntent()
        val start = PendingStart(request, ++lastRequestCode, promise)
        pending = start
        activity.startActivityForResult(intent, start.code)
      }
    } catch (e: Exception) {
      pending = null
      promise.reject("ERR_RECOGNIZE_CAPTURE", e.message, e)
    }
  }

  /** Activity results can precede onResume; capture waits for Wave to be visible again. */
  private fun startPlaybackWhenForeground(start: PendingStart) {
    if (!foreground || pending !== start || start.cancelCapture != null) return
    val (code, data) = start.consent ?: return
    start.consent = null
    try {
      start.cancelCapture = openPlaybackCapture(context, code, data,
        opened = { audio ->
          if (pending !== start) audio.release() else {
            pending = null
            sessions.start(start.request, audio) { start.promise.resolve(it) }
          }
        },
        failed = { error ->
          if (pending === start) {
            pending = null
            start.promise.reject("ERR_RECOGNIZE_CAPTURE", error.message, error)
          }
        })
    } catch (e: Exception) {
      pending = null
      start.promise.reject("ERR_RECOGNIZE_CAPTURE", e.message, e)
    }
  }

  private fun cancelPending() {
    val start = pending ?: return
    pending = null
    start.cancelCapture?.invoke()
    start.promise.reject("ERR_RECOGNIZE_ENDED", "The session has ended", null)
  }

  private fun recognize(signature: ShazamSignature): RecognizeOutcome {
    val installId = checkNotNull(installId) { "Recognize asked before any start" }.get()
    return ShazamClient(UrlConnectionShazamHttp(), installId, Locale.getDefault(), TimeZone.getDefault().id)
      .recognize(signature)
  }

  private companion object {
    const val HEARD = "onRecognizeHeard"
    const val CAPTURE_FAILED = "onRecognizeCaptureFailed"
    const val TILE_REQUESTED = "onRecognizeTileRequested"
    const val TILE_CANCELLED = "onRecognizeTileCancelled"
    val MEDIA_USAGES = setOf(AudioAttributes.USAGE_MEDIA, AudioAttributes.USAGE_GAME, AudioAttributes.USAGE_UNKNOWN)
  }
}
