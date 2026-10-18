package expo.modules.wavenative.log

import android.content.ComponentCallbacks2
import org.junit.Assert.assertEquals
import org.junit.Test

/** Android's memory warnings (`onTrimMemory`) in the app log, and JS writing what it holds (#450). */
@Suppress("DEPRECATION")
class MemoryWarningsTest {
  private val mb = 1L shl 20
  private val lines = mutableListOf<String>()
  private var flushes = 0
  private val warnings = MemoryWarnings(
    memory = { MemoryUse(45 * mb, 256 * mb, 80 * mb, 210 * mb) },
    warn = { lines += it },
    warned = { flushes++ },
  )

  @Test fun aWarningIsWrittenWithWavesMemoryAndJsWritesWhatItHolds() {
    warnings.trimmed(ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW)
    assertEquals(
      listOf("Android warned that memory is short: running low (level 10); Java heap 45/256 MB, native heap 80 MB, PSS 210 MB"),
      lines,
    )
    assertEquals(1, flushes)
  }

  @Test fun eachLevelIsWrittenOncePerChange() {
    warnings.trimmed(ComponentCallbacks2.TRIM_MEMORY_RUNNING_MODERATE)
    warnings.trimmed(ComponentCallbacks2.TRIM_MEMORY_RUNNING_MODERATE)
    warnings.trimmed(ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL)
    warnings.trimmed(ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL)
    warnings.trimmed(ComponentCallbacks2.TRIM_MEMORY_RUNNING_MODERATE)
    assertEquals(
      listOf("running moderate (level 5)", "running critical (level 15)", "running moderate (level 5)"),
      lines.map { it.substringAfter(": ").substringBefore(";") },
    )
    // JS writes at every warning, repeated or not: a kill may follow any of them.
    assertEquals(5, flushes)
  }

  @Test fun wavesLeavingTheScreenIsntAWarningButStartsTheCountOver() {
    warnings.trimmed(ComponentCallbacks2.TRIM_MEMORY_BACKGROUND)
    warnings.trimmed(ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN)
    warnings.trimmed(ComponentCallbacks2.TRIM_MEMORY_BACKGROUND)
    assertEquals(listOf("background (level 40)", "background (level 40)"), lines.map { it.substringAfter(": ").substringBefore(";") })
    assertEquals(2, flushes)
  }

  @Test fun androidsLowMemoryCallReadsAsTheLastLevel() {
    warnings.trimmed(ComponentCallbacks2.TRIM_MEMORY_MODERATE)
    warnings.lowMemory()
    warnings.trimmed(ComponentCallbacks2.TRIM_MEMORY_COMPLETE)
    assertEquals(listOf("moderate (level 60)", "complete (level 80)"), lines.map { it.substringAfter(": ").substringBefore(";") })
  }

  @Test fun aLevelAndroidAddsLaterIsWrittenByItsNumber() {
    warnings.trimmed(70)
    assertEquals(listOf("level 70"), lines.map { it.substringAfter(": ").substringBefore(";") })
  }

  /**
   * Since Android 14 the running levels and `onLowMemory` never arrive, so the download service's
   * minute tick checks for itself: the phone low on memory, or Wave's Java heap near its limit.
   */
  @Test fun theMinuteCheckWarnsOncePerChangeAndJsWritesWhileMemoryIsShort() {
    val fine = MemoryUse(45 * mb, 256 * mb, 80 * mb, 210 * mb)
    val fullHeap = MemoryUse(230 * mb, 256 * mb, 80 * mb, 400 * mb)
    warnings.checked(fine, phoneLow = false)
    warnings.checked(fine, phoneLow = true)
    warnings.checked(fine, phoneLow = true)
    warnings.checked(fullHeap, phoneLow = true)
    warnings.checked(fine, phoneLow = false)
    warnings.checked(fullHeap, phoneLow = false)
    assertEquals(
      listOf(
        "Memory is short: the phone is low on memory; Java heap 45/256 MB, native heap 80 MB, PSS 210 MB",
        "Memory is short: the phone is low on memory and Wave's Java heap is near its limit; Java heap 230/256 MB, native heap 80 MB, PSS 400 MB",
        "Memory is short: Wave's Java heap is near its limit; Java heap 230/256 MB, native heap 80 MB, PSS 400 MB",
      ),
      lines,
    )
    // At every check while it's short, as at every warning: a kill may follow.
    assertEquals(4, flushes)
  }
}
