package expo.modules.wavenative.download

import android.os.Process
import java.util.concurrent.ThreadFactory
import java.util.concurrent.atomic.AtomicInteger

/**
 * Threads for download work (#455): transfers, tagging, hashing, publication and the journal's
 * writes run at Android's background thread priority, so a big run yields to Wave's UI, playback
 * and other apps instead of competing with them. Each thread lowers itself ([lower]) before it
 * runs any work, and is named "[name] <n>", so a thread inspection (`adb shell top -H -p <pid>`)
 * shows them at nice 10.
 */
class BackgroundThreads(
  private val name: String,
  private val daemon: Boolean = false,
  private val lower: () -> Unit = ::lowerThisThread,
) : ThreadFactory {
  private val count = AtomicInteger()

  override fun newThread(work: Runnable): Thread =
    Thread({ runCatching(lower); work.run() }, "$name ${count.incrementAndGet()}").apply { isDaemon = daemon }

  companion object {
    /** Android's background thread priority (a nice value). */
    const val BACKGROUND = Process.THREAD_PRIORITY_BACKGROUND

    fun lowerThisThread() = Process.setThreadPriority(BACKGROUND)

    /**
     * Runs [work] at background priority on a thread download work borrows (a module's queue,
     * writing a song's lyrics and genre), then gives the thread its own priority back.
     */
    fun <T> during(
      get: () -> Int = { Process.getThreadPriority(Process.myTid()) },
      set: (Int) -> Unit = { Process.setThreadPriority(it) },
      work: () -> T,
    ): T {
      val own = runCatching(get).getOrNull()
      runCatching { set(BACKGROUND) }
      try {
        return work()
      } finally {
        if (own != null) runCatching { set(own) }
      }
    }
  }
}
