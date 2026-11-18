package expo.modules.wavenative.log

/**
 * How much memory Wave's process uses, in bytes, as the app log writes it (#450): the Java heap
 * used and its limit, the native heap allocated, and the process's PSS. Read on the phone by
 * [AndroidMemory]; JS reports the Hermes heap on its own ([JsHeap]).
 */
data class MemoryUse(val javaUsed: Long, val javaLimit: Long, val nativeHeap: Long, val pss: Long) {
  /** "Java heap 45/256 MB, native heap 80 MB, PSS 210 MB", then ", Hermes heap 31 MB" when JS reported it. */
  fun line(hermesHeap: Long? = null): String =
    "Java heap ${mb(javaUsed)}/${mb(javaLimit)} MB, native heap ${mb(nativeHeap)} MB, PSS ${mb(pss)} MB" +
      (hermesHeap?.let { ", Hermes heap ${mb(it)} MB" } ?: "")

  /** Memory counts in binary megabytes, as Android sizes a heap ("256m"). */
  private fun mb(bytes: Long): Long = Math.round(bytes / MB)

  private companion object {
    const val MB = 1_048_576.0
  }
}
