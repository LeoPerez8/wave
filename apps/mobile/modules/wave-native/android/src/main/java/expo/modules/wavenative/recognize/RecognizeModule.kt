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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Captures in memory; Core owns the source choice, listening schedule and outcome. */
class RecognizeModule : Module() {
  private val context: Context get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()
  private val main = Handler(Looper.getMainLooper())
  private var current: Pair<Int, RecognizeSession>? = null
  private var lastId = 0
  private var lastRequestCode = 17710
  private var pending: PendingStart? = null
  private var foreground = true

  private class PendingStart(val request: Int, val code: Int, val promise: Promise) {
    var cancelCapture: (() -> Unit)? = null
    var consent: Pair<Int, Intent>? = null
  }

  override fun definition() = ModuleDefinition {
    Name("WaveRecognize")
    Events(HEARD, CAPTURE_FAILED, "onRecognizeRequested")

    OnCreate { RecognizeInbox.onReceived = { sendEvent("onRecognizeRequested") } }
    Function("takeRequest") { RecognizeInbox.take() }

    AsyncFunction("playbackActivity") {
      val media = if (Build.VERSION.SDK_INT < 29) 0 else
        context.getSystemService(AudioManager::class.java).activePlaybackConfigurations.count {
          it.audioAttributes.usage in MEDIA_USAGES
        }
      mapOf("activeMediaPlayers" to media, "waveMediaPlayers" to ActiveWaveAudio.count())
    }.runOnQueue(Queues.MAIN)

    // A request id lets JS cancel even while start is waiting for Android's consent result.
    AsyncFunction("start") { source: String, request: Int, promise: Promise ->
      cancelPending()
      stopCurrent()
      try {
        require(source == "microphone" || source == "playback") { "Unknown source $source" }
        if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
          throw CodedException("ERR_RECOGNIZE_PERMISSION", "Wave may not capture audio", null)
        }
        if (source == "microphone") {
          promise.resolve(startAudio(MicrophoneAudio.open()))
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

    AsyncFunction("ask") Coroutine { id: Int, last: Boolean ->
      val session = session(id) ?: throw CodedException("ERR_RECOGNIZE_ENDED", "The session has ended", null)
      withContext(Dispatchers.IO) { session.ask(last).toMap() }
    }

    Function("stop") { id: Int ->
      synchronized(this@RecognizeModule) {
        if (current?.first == id) stopCurrent()
      }
    }

    OnActivityEntersForeground {
      foreground = true
      pending?.let(::startPlaybackWhenForeground)
    }

    OnActivityEntersBackground {
      foreground = false
      // Consent itself can pause the activity. Only cancel a start already binding its service.
      if (pending?.cancelCapture != null) cancelPending()
      val id = synchronized(this@RecognizeModule) { current?.first }
      stopCurrent()
      if (id != null) sendEvent(CAPTURE_FAILED, mapOf("session" to id))
    }

    OnDestroy {
      RecognizeInbox.onReceived = null
      main.post { cancelPending() }
      stopCurrent()
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
            start.promise.resolve(startAudio(audio))
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

  @Synchronized
  private fun startAudio(audio: RecognizeAudio): Int {
    val id = ++lastId
    val session = RecognizeSession(audio, recognize = ::recognize,
      onHeard = { ms, audible -> sendEvent(HEARD, mapOf("session" to id, "heardMs" to ms, "audible" to audible)) },
      onCaptureFailed = { sendEvent(CAPTURE_FAILED, mapOf("session" to id)) })
    current = id to session
    session.start()
    return id
  }

  @Synchronized
  private fun stopCurrent() {
    current?.second?.stop()
    current = null
  }

  @Synchronized
  private fun session(id: Int): RecognizeSession? = current?.takeIf { it.first == id }?.second

  private fun recognize(signature: ShazamSignature): RecognizeOutcome {
    val installId = ShazamInstallId(File(context.filesDir, "recognize/shazam-install-id")).get()
    return ShazamClient(UrlConnectionShazamHttp(), installId, Locale.getDefault(), TimeZone.getDefault().id)
      .recognize(signature)
  }

  private companion object {
    const val HEARD = "onRecognizeHeard"
    const val CAPTURE_FAILED = "onRecognizeCaptureFailed"
    val MEDIA_USAGES = setOf(AudioAttributes.USAGE_MEDIA, AudioAttributes.USAGE_GAME, AudioAttributes.USAGE_UNKNOWN)
  }
}
