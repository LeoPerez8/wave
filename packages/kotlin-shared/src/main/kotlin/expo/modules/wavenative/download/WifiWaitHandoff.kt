package expo.modules.wavenative.download

/**
 * How the Wi-Fi job (`WifiWaitJob`) hands the songs that waited for Wi-Fi over (#1502), kept free of
 * Android for JDK tests. The job waiting for an unmetered network is cancelled only once Android
 * accepted the download service: refused (Wave in the background), the running job is left to run
 * the downloads itself. And once Android stopped the job, it starts no work after.
 */
object WifiWaitHandoff {
  /**
   * Asks for the download service ([start], which throws when Android refuses it), then cancels
   * the wait ([cancelWait]) once it's accepted. Null when accepted, else Android's refusal.
   */
  fun startService(start: () -> Unit, cancelWait: () -> Unit): Exception? {
    try {
      start()
    } catch (refusal: Exception) {
      return refusal
    }
    cancelWait()
    return null
  }

  /** One run of the Wi-Fi job: the work it starts, and Android stopping it. */
  class JobRun {
    private var stopped = false

    /** Android stopped the job (its time, or the network became metered). */
    @Synchronized fun stopped() {
      stopped = true
    }

    /**
     * Starts [work] under the job unless Android stopped it already; whether it did. A stop that
     * comes meanwhile waits for the work to start, so it stops it.
     */
    @Synchronized fun startWork(work: () -> Unit): Boolean {
      if (stopped) return false
      work()
      return true
    }
  }
}
