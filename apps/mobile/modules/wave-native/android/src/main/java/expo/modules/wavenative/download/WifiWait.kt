package expo.modules.wavenative.download

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import expo.modules.wavenative.log.WaveLog
import kotlin.concurrent.thread

/**
 * Download only on Wi-Fi (#1502): while songs wait for Wi-Fi and nothing else downloads, the
 * download service stops (no notification for the wait) and a JobScheduler job waits for an
 * unmetered network ([WifiWaitJob]), so the songs start with the screen off and after Wave's
 * process is gone, and across a reboot. While Wave runs, [AndroidDownloads] also hears the network
 * change itself. Android doesn't let the job start the service with Wave in the background, so
 * then the job runs the downloads itself while it may ([AndroidDownloads.startUnderJob]), with no
 * notification, and JobScheduler runs it again after Android stops it.
 */
object WifiWait {
  /** The job's id in JobScheduler (the Wi-Fi pre-download's is 514001, Normalize Volume's 514002). */
  private const val JOB_ID = 514_003
  private const val TAG = "WaveDownloads"

  /** Waits for an unmetered network, unless a job does already. */
  fun schedule(context: Context) {
    val app = context.applicationContext ?: context
    val scheduler = app.getSystemService(JobScheduler::class.java) ?: return
    if (scheduler.getPendingJob(JOB_ID) != null) return
    val job = JobInfo.Builder(JOB_ID, ComponentName(app, WifiWaitJob::class.java))
      .setRequiredNetworkType(JobInfo.NETWORK_TYPE_UNMETERED)
      .setPersisted(true)
      .build()
    try {
      scheduler.schedule(job)
    } catch (e: RuntimeException) {
      WaveLog.w(TAG, "Couldn't wait for Wi-Fi in the background; the downloads wait for Wave's next launch", e)
    }
  }

  /** Nothing waits for Wi-Fi any more. */
  fun cancel(context: Context) {
    (context.applicationContext ?: context).getSystemService(JobScheduler::class.java)?.cancel(JOB_ID)
  }
}

/**
 * Runs once an unmetered network is back ([WifiWait]): the songs waiting for Wi-Fi start, in the
 * download service, or under this job when Android won't start the service from the background.
 */
class WifiWaitJob : JobService() {
  private val finished = java.util.concurrent.atomic.AtomicBoolean()

  override fun onStartJob(params: JobParameters): Boolean {
    finished.set(false)
    val downloads = AndroidDownloads.get(applicationContext)
    thread(isDaemon = true, name = "Wave Wi-Fi wait") {
      val served = try {
        downloads.wifiBack()
      } catch (e: Exception) {
        WaveLog.w("WaveDownloads", "The downloads waiting for Wi-Fi couldn't start", e)
        true
      }
      if (served) finish(params)
      else downloads.startUnderJob(
        onIdle = {
          // Nothing left to download now: done, or waiting for Wi-Fi again (a new job waits for it).
          downloads.stop(downloads.jobs.idleStop())
          finish(params)
          downloads.awaitWifi()
        },
        takenOver = { finish(params) },
      )
    }
    return true
  }

  private fun finish(params: JobParameters) {
    if (finished.compareAndSet(false, true)) jobFinished(params, false)
  }

  /** Android stopped the job (its time, or the network became metered): its songs go back in line, and it runs again. */
  override fun onStopJob(params: JobParameters): Boolean {
    finished.set(true)
    AndroidDownloads.get(applicationContext).stopUnderJob()
    return true
  }
}
