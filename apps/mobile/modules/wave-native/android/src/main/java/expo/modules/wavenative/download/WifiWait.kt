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
 * change itself. If Android won't let the job start the service from the background, the songs
 * wait for Wave's next launch, as a refused sticky restart's do.
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

/** Runs once an unmetered network is back ([WifiWait]): the songs waiting for Wi-Fi start. */
class WifiWaitJob : JobService() {
  override fun onStartJob(params: JobParameters): Boolean {
    thread(isDaemon = true, name = "Wave Wi-Fi wait") {
      try {
        AndroidDownloads.get(applicationContext).wifiBack()
      } catch (e: Exception) {
        WaveLog.w("WaveDownloads", "The downloads waiting for Wi-Fi couldn't start", e)
      }
      jobFinished(params, false)
    }
    return true
  }

  override fun onStopJob(params: JobParameters): Boolean = false
}
