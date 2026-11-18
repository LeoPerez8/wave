package expo.modules.wavenative.download

import org.junit.Assert.assertEquals
import org.junit.Test

/** Download work on a borrowed thread runs at Android's background priority (#455); the thread keeps its own. */
class ThreadPriorityTest {
  @Test fun workOnAnotherThreadRunsAtBackgroundPriorityAndGivesItsOwnBack() {
    var priority = 0
    val seen = ThreadPriority.during(get = { priority }, set = { priority = it }) { priority }
    assertEquals(ThreadPriority.BACKGROUND, seen)
    assertEquals(0, priority)
  }
}
