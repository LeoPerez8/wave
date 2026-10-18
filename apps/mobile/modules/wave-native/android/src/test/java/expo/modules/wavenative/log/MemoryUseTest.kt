package expo.modules.wavenative.log

import org.junit.Assert.assertEquals
import org.junit.Test

/** How the app log writes Wave's memory (#450). */
class MemoryUseTest {
  private val mb = 1L shl 20

  @Test fun saysTheJavaHeapUsedAndItsLimitTheNativeHeapAndThePssInMb() {
    assertEquals(
      "Java heap 45/256 MB, native heap 80 MB, PSS 210 MB",
      MemoryUse(javaUsed = 45 * mb, javaLimit = 256 * mb, nativeHeap = 80 * mb, pss = 210 * mb).line(),
    )
  }

  @Test fun addsTheHermesHeapWhenJsReportedIt() {
    assertEquals(
      "Java heap 45/256 MB, native heap 80 MB, PSS 210 MB, Hermes heap 31 MB",
      MemoryUse(45 * mb, 256 * mb, 80 * mb, 210 * mb).line(hermesHeap = 31 * mb),
    )
  }

  @Test fun roundsToTheNearestMb() {
    assertEquals(
      "Java heap 1/512 MB, native heap 0 MB, PSS 2 MB",
      MemoryUse(javaUsed = mb / 2, javaLimit = 512 * mb, nativeHeap = mb / 3, pss = 3 * mb / 2).line(),
    )
  }
}
