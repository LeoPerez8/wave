package expo.modules.wavenative.download

import android.content.Context
import android.media.MediaScannerConnection
import android.os.SystemClock
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * The process's one [MediaScanBatch] (#455): every path Wave hands Android's media scanner (a
 * download published, tags written, files deleted) goes through it, on a background thread of its
 * own, whether or not the download service runs.
 */
object AndroidMediaScans {
  @Volatile private var batch: MediaScanBatch? = null

  fun get(context: Context): MediaScanBatch =
    batch ?: synchronized(this) { batch ?: create(context.applicationContext).also { batch = it } }

  private fun create(app: Context): MediaScanBatch {
    val timer = Executors.newSingleThreadScheduledExecutor(BackgroundThreads("Wave media scans", daemon = true))
    return MediaScanBatch(
      clock = SystemClock::elapsedRealtime,
      later = { delay, run -> timer.schedule({ runCatching(run) }, delay, TimeUnit.MILLISECONDS) },
      // One request for the whole batch; a deleted file's path removes it from other apps' view.
      scan = { paths -> MediaScannerConnection.scanFile(app, paths.toTypedArray(), null, null) },
    )
  }
}
