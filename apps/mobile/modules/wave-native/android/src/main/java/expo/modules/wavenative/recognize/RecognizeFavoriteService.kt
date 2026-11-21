package expo.modules.wavenative.recognize

import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import expo.modules.wavenative.player.JsRuntime

/**
 * Stars or unstars a recognized song from the match notification's star button, without
 * opening Wave. The button's PendingIntent starts it (a notification action may start a
 * service from the background); it holds the JS runtime (headless on a cold start) until JS
 * has answered every tap (`RecognizeModule`'s `tileFavoriteDone`), or a minute has gone by.
 */
class RecognizeFavoriteService : Service() {
  private val main = Handler(Looper.getMainLooper())
  private val giveUp = Runnable { stopSelf() }

  override fun onBind(intent: Intent): IBinder? = null

  /** A tap never outlives Wave's process, so Android shouldn't restart the service. */
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val match = intent?.getStringExtra(EXTRA_MATCH)
    if (match == null) {
      if (RecognizeFavoriteInbox.shared.done()) stopSelf()
      return START_NOT_STICKY
    }
    JsRuntime.ensureStarted(this, RUNTIME_OWNER)
    RecognizeFavoriteInbox.shared.add(match, intent.getBooleanExtra(EXTRA_ON, true))
    main.removeCallbacks(giveUp)
    main.postDelayed(giveUp, TIMEOUT_MS)
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    main.removeCallbacks(giveUp)
    RecognizeFavoriteInbox.shared.clear()
    JsRuntime.release(RUNTIME_OWNER)
    super.onDestroy()
  }

  companion object {
    private const val EXTRA_MATCH = "expo.modules.wavenative.recognize.FAVORITE_MATCH"
    private const val EXTRA_ON = "expo.modules.wavenative.recognize.FAVORITE_ON"
    private const val RUNTIME_OWNER = "recognizeFavorite"
    private const val TIMEOUT_MS = 60_000L

    /** The star button's tap: [on] stars the kept match's song, else unstars it. */
    fun tap(context: Context, kept: String, on: Boolean, generation: Int): PendingIntent =
      PendingIntent.getService(
        context,
        0,
        Intent(context, RecognizeFavoriteService::class.java)
          .setData(Uri.parse("wave-recognize://favorite/$generation"))
          .putExtra(EXTRA_MATCH, kept)
          .putExtra(EXTRA_ON, on),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )

    /** JS answered a tap; the service goes once none is left. */
    fun done(context: Context) {
      if (RecognizeFavoriteInbox.shared.done()) {
        context.stopService(Intent(context, RecognizeFavoriteService::class.java))
      }
    }
  }
}
