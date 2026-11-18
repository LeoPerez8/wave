package expo.modules.wavenative.download

import java.util.concurrent.ThreadFactory
import java.util.concurrent.atomic.AtomicInteger

/**
 * Threads for download work (#455): transfers, tagging, hashing, publication and the journal's
 * writes run at the device's background priority, so a big run yields to Wave's UI, playback and
 * other apps instead of competing with them. Each thread lowers itself ([lower]: on the phone,
 * `ThreadPriority.lower`) before it runs any work, and is named "[name] <n>", so a thread
 * inspection (`adb shell top -H -p <pid>`) shows them at nice 10.
 */
class BackgroundThreads(
  private val name: String,
  private val daemon: Boolean = false,
  private val lower: () -> Unit,
) : ThreadFactory {
  private val count = AtomicInteger()

  override fun newThread(work: Runnable): Thread =
    Thread({ runCatching(lower); work.run() }, "$name ${count.incrementAndGet()}").apply { isDaemon = daemon }
}
