package expo.modules.wavenative.download

import android.os.Process

/** Android's thread priorities for download work (#455): what [BackgroundThreads] lower to. */
object ThreadPriority {
  /** Android's background thread priority (a nice value). */
  const val BACKGROUND = Process.THREAD_PRIORITY_BACKGROUND

  /** Lowers the calling thread to [BACKGROUND]. */
  fun lower() = Process.setThreadPriority(BACKGROUND)

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
