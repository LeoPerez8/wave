package expo.modules.wavenative.yt

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.net.Uri
import android.os.SystemClock
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DefaultHttpDataSource
import expo.modules.wavenative.log.WaveLog
import expo.modules.wavenative.net.Connectivity
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import kotlin.concurrent.thread

/**
 * The Wi-Fi pre-download (docs/spec.md, YT Music, Wi-Fi pre-download): JS
 * hands over the day's list of songs (the start of each of Home's mixes,
 * Core's `mixPreDownload`) and a JobScheduler job ([PreDownloadJob]) fetches
 * them into the audio cache ([YtAudioCache]) on an unmetered network with
 * battery not low, stopping when either goes and going on when they're back.
 * The list is kept here, so the job runs without JS (and, persisted, after a
 * reboot); the audio cache's evictor reads it ([listed]) so songs fetched for
 * an earlier list leave before played ones. Silent: no notification, no UI,
 * one app log line per run ([PreDownloadRun.line]).
 */
object PreDownloads {
  private const val FILE = "wave_pre_download"
  private const val KEY_LIST = "videoIds"
  private const val KEY_DONE = "doneFor"

  /** The job's id in JobScheduler (one per app: a new list replaces the pending job). */
  private const val JOB_ID = 514_001

  internal const val TAG = "WavePreDownload"

  private val kept = PreDownloadList()

  private fun preferences(context: Context) =
    (context.applicationContext ?: context).getSharedPreferences(FILE, Context.MODE_PRIVATE)

  private fun list(context: Context): List<String> = kept.get { preferences(context).getString(KEY_LIST, null) }

  /** The videos the list has now: what the audio cache keeps of what was fetched ahead. */
  fun listed(context: Context): Set<String> = list(context).toSet()

  /**
   * Hands over [videoIds], the day's list in the order to fetch: the job is
   * (re)scheduled for it, unless it's the list handed over before and its
   * job is pending or has fetched it all. An empty list cancels the job.
   */
  @Synchronized
  fun schedule(context: Context, videoIds: List<String>) {
    val app = context.applicationContext ?: context
    val scheduler = app.getSystemService(JobScheduler::class.java) ?: return
    val joined = videoIds.joinToString(",")
    val preferences = preferences(app)
    if (videoIds == list(app) && (scheduler.getPendingJob(JOB_ID) != null || preferences.getString(KEY_DONE, null) == joined)) return
    kept.set(videoIds) { preferences.edit().putString(KEY_LIST, it).remove(KEY_DONE).apply() }
    if (videoIds.isEmpty()) {
      scheduler.cancel(JOB_ID)
      return
    }
    val job = JobInfo.Builder(JOB_ID, ComponentName(app, PreDownloadJob::class.java))
      .setRequiredNetworkType(JobInfo.NETWORK_TYPE_UNMETERED)
      .setRequiresBatteryNotLow(true)
      .setPersisted(true)
      .build()
    try {
      scheduler.schedule(job)
    } catch (e: RuntimeException) {
      WaveLog.w(TAG, "Couldn't schedule the Wi-Fi pre-download", e)
    }
  }

  /**
   * One run of the job, on its own thread, until the list is fetched or
   * [stop] (the job stopped: off Wi-Fi, battery low, out of time, a new
   * list). Whether it should run again.
   */
  @OptIn(UnstableApi::class)
  internal fun run(context: Context, stop: AtomicBoolean): Boolean {
    val videoIds = list(context)
    if (videoIds.isEmpty() || !YtClient.get(context).enabled) return false
    val audio = YtAudioCache.get(context) ?: return false
    val connectivity = Connectivity(context)
    val networkBytes = AtomicLong()
    val startedAt = SystemClock.elapsedRealtime()
    val outcome = PreDownloadRun(
      cached = { audio.wholeKey(it) != null },
      fetch = { videoId, stopped -> fetch(context, audio, videoId, stopped) { networkBytes.addAndGet(it) } },
      // A double check: the job's constraints stop it too, a moment later.
      stopped = { stop.get() || connectivity.onMobileData() },
    ).run(videoIds)
    WaveLog.i(PreDownloadRun.LOG_TAG, PreDownloadRun.line(outcome, networkBytes.get(), SystemClock.elapsedRealtime() - startedAt))
    synchronized(this) {
      if (!outcome.again && videoIds == list(context)) {
        preferences(context).edit().putString(KEY_DONE, videoIds.joinToString(",")).apply()
      }
    }
    return outcome.again
  }

  /** Reads [videoId]'s audio to its end (or until [stopped]) through the cache, as the player would, marked as fetched ahead. */
  @OptIn(UnstableApi::class)
  private fun fetch(context: Context, audio: YtAudioCache, videoId: String, stopped: () -> Boolean, counted: (Long) -> Unit) {
    val network = DefaultHttpDataSource.Factory().setAllowCrossProtocolRedirects(true).createDataSource()
    val source = YtDataSource(
      network,
      client = { YtClient.get(context) },
      audioCache = { audio },
      onLoaded = { _, fromNetwork, _ -> counted(fromNetwork) },
      ahead = true,
    )
    val buffer = ByteArray(64 * 1024)
    try {
      source.open(DataSpec(Uri.parse(YtMedia.uriOf(videoId))))
      while (!stopped()) {
        if (source.read(buffer, 0, buffer.size) == C.RESULT_END_OF_INPUT) break
      }
    } finally {
      source.close()
    }
  }
}

/**
 * The Wi-Fi pre-download's JobScheduler job ([PreDownloads]): runs on an
 * unmetered network with battery not low; Android stops it when either goes
 * (or its time is up), and it's rescheduled to go on.
 */
class PreDownloadJob : JobService() {
  @Volatile private var stop: AtomicBoolean? = null

  override fun onStartJob(params: JobParameters): Boolean {
    val stop = AtomicBoolean().also { this.stop = it }
    thread(isDaemon = true, name = "Wave pre-download") {
      val again = try {
        PreDownloads.run(applicationContext, stop)
      } catch (e: Exception) {
        WaveLog.w(PreDownloads.TAG, "The Wi-Fi pre-download failed", e)
        false
      }
      if (!stop.get()) jobFinished(params, again)
    }
    return true
  }

  override fun onStopJob(params: JobParameters): Boolean {
    stop?.set(true)
    return true
  }
}

/**
 * The day's list as [PreDownloads] keeps it: read from where it's kept the
 * first time it's asked for, then remembered. Reads and hand-overs take one
 * lock: the job's thread, the audio cache's loaders and JS all read it, and
 * a first read finishing after a new list was handed over mustn't put the
 * old one back (the job would fetch it, the evictor drop the new one's songs).
 */
internal class PreDownloadList {
  private var memo: List<String>? = null

  /** The list, read with [stored] (the ids joined by commas) the first time. */
  @Synchronized
  fun get(stored: () -> String?): List<String> =
    memo ?: stored().orEmpty().split(',').filter(String::isNotEmpty).also { memo = it }

  /** Keeps [videoIds] as the list, [store]d first (joined by commas). */
  @Synchronized
  fun set(videoIds: List<String>, store: (String) -> Unit) {
    store(videoIds.joinToString(","))
    memo = videoIds
  }
}
