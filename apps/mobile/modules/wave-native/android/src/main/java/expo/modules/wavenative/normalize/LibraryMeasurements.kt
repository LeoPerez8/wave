package expo.modules.wavenative.normalize

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.os.SystemClock
import android.util.Log
import expo.modules.wavenative.download.BackgroundThreads
import expo.modules.wavenative.log.WaveLog
import expo.modules.wavenative.player.NormalizeVolume
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/**
 * Normalize Volume's measurement of the rest of the Library (docs/spec.md, "Normalize Volume"):
 * the app hands over the Library files without a value ([hand], the Library store's list), and a
 * JobScheduler job ([LibraryMeasureJob]) measures them only while the phone charges, with Wave
 * closed too, in runs of a few minutes ([ChargingRun]) that pick up where the last one stopped.
 * Results wait in [LibraryToMeasure]'s journal until the app takes them into the Library store,
 * which stays the schema's only owner ([results], [forget]); while JS is there it hears of each
 * one ([onKept]). The job stops while the switch is off ([switched]) and goes idle once nothing is
 * left. Silent: no notification, no UI, one app log line per run ([ChargingRun.line]).
 */
object LibraryMeasurements {
  /** The job's id in JobScheduler (the Wi-Fi pre-download's is 514001). */
  private const val JOB_ID = 514_002
  private const val DIR = "normalize-volume"

  /** A run's share of Android's 10 minutes for a job, with room to finish its file. */
  private const val RUN_MS = 5 * 60_000L

  /** The meter thread the queue's measurements and the job share, the queue's first. */
  val meter: SongMeter by lazy {
    SongMeter(FileLoudness::measure, Executors.newSingleThreadExecutor(BackgroundThreads("wave-meter", daemon = true)))
  }

  /** Called as the job keeps each result, while JS is there to take it in (`onLibraryMeasured`). */
  @Volatile
  var onKept: (() -> Unit)? = null

  private var list: LibraryToMeasure? = null

  // Hands its work off the caller's thread: the switch is set on the main one.
  private val worker = Executors.newSingleThreadExecutor(BackgroundThreads("wave-meter-list", daemon = true))

  @Synchronized
  private fun list(context: Context): LibraryToMeasure =
    list ?: LibraryToMeasure(File(context.applicationContext.noBackupFilesDir, DIR)).also { list = it }

  /** The Library files to measure, in place of the list before; the job is scheduled for them, or goes idle without any. */
  fun hand(context: Context, songs: List<LibrarySong>) {
    list(context).replace(songs)
    schedule(context, replace = false)
  }

  /** The first [limit] results the job keeps. */
  fun results(context: Context, limit: Int): List<LibraryResult> = list(context).results(limit)

  /** The app kept the results through [seq]: they're forgotten, and their songs leave the list. */
  fun forget(context: Context, seq: Long) = list(context).forget(seq)

  /** Normalize Volume was turned on or off: off stops the job, on schedules it for what's left. */
  fun switched(context: Context, on: Boolean) {
    val app = context.applicationContext
    if (!on) {
      app.getSystemService(JobScheduler::class.java)?.cancel(JOB_ID)
      return
    }
    worker.execute { runCatching { schedule(app, replace = false) } }
  }

  /**
   * Schedules the job when the switch is on and files are left, unless it's pending already
   * ([replace]: a new one in its place, for a run that just ended); cancels it otherwise.
   */
  @Synchronized
  internal fun schedule(context: Context, replace: Boolean) {
    val app = context.applicationContext
    val scheduler = app.getSystemService(JobScheduler::class.java) ?: return
    NormalizeVolume.init(app)
    if (!NormalizeVolume.on || list(app).next() == null) {
      scheduler.cancel(JOB_ID)
      return
    }
    if (!replace && scheduler.getPendingJob(JOB_ID) != null) return
    val job = JobInfo.Builder(JOB_ID, ComponentName(app, LibraryMeasureJob::class.java))
      .setRequiresCharging(true)
      .setPersisted(true)
      .build()
    try {
      scheduler.schedule(job)
    } catch (e: RuntimeException) {
      WaveLog.w(NormalizeVolume.LOG_TAG, "Couldn't schedule the charging measurement", e)
    }
  }

  /** One run of the job, on its thread, until it's done, out of time or [stopped]. */
  internal fun run(context: Context, stopped: () -> Boolean): ChargingRun.Summary =
    ChargingRun(
      list = list(context),
      measure = { path, stop ->
        meter.forLibrary(path, stop)?.also { outcome ->
          if (outcome != FileLoudness.Outcome.Cancelled) runCatching { Log.i(NormalizeVolume.LOG_TAG, FileLoudness.describe(outcome)) }
        }
      },
      stopped = stopped,
      now = SystemClock::elapsedRealtime,
      budgetMs = RUN_MS,
      kept = { onKept?.invoke() },
    ).run()
}

/**
 * Normalize Volume's charging job ([LibraryMeasurements]): runs while the phone charges; Android
 * stops it when the phone is unplugged (or its time is up), and reschedules it, so the next run
 * picks up with the file this one stopped in.
 */
class LibraryMeasureJob : JobService() {
  @Volatile private var stop: AtomicBoolean? = null

  @Volatile private var stopReason: Int? = null

  override fun onStartJob(params: JobParameters): Boolean {
    NormalizeVolume.init(applicationContext)
    if (!NormalizeVolume.on) return false
    val stop = AtomicBoolean().also { this.stop = it }
    stopReason = null
    thread(isDaemon = true, name = "Wave charging measurement") {
      val summary = try {
        LibraryMeasurements.run(applicationContext) { stop.get() || !NormalizeVolume.on }
      } catch (e: Exception) {
        WaveLog.w(NormalizeVolume.LOG_TAG, "The charging measurement failed", e)
        null
      }
      if (summary != null) WaveLog.i(NormalizeVolume.LOG_TAG, ChargingRun.line(summary, why()))
      // A stopped job is Android's to reschedule. One that ended gives way to a new one for what's
      // left (out of time, or a list handed over as it ended), or to none.
      if (!stop.get()) {
        jobFinished(params, false)
        LibraryMeasurements.schedule(applicationContext, replace = true)
      }
    }
    return true
  }

  override fun onStopJob(params: JobParameters): Boolean {
    stopReason = params.stopReason
    stop?.set(true)
    return NormalizeVolume.on
  }

  /** Why a stopped run stopped, in its log line. */
  private fun why(): String = when {
    !NormalizeVolume.on -> "Normalize Volume is off"
    else -> when (stopReason) {
      JobParameters.STOP_REASON_CONSTRAINT_CHARGING -> "unplugged"
      JobParameters.STOP_REASON_TIMEOUT -> "Android's time limit"
      JobParameters.STOP_REASON_CANCELLED_BY_APP -> "cancelled by Wave"
      null -> "stopped"
      else -> "stopped by Android ($stopReason)"
    }
  }
}
