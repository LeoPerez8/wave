package expo.modules.wavenative.download

import org.junit.Assert.*
import org.junit.Test

/** JS hears of journal changes only when there's something new, and at a bounded rate. */
class JournalNoticesTest {
  private var now = 1_000L
  private var revision = 1L
  private var told = 0
  private val held = mutableListOf<Pair<Long, () -> Unit>>()
  private val notices = JournalNotices(
    revision = { revision }, clock = { now }, intervalMs = 500,
    later = { delay, run -> held += delay to run }, notify = { told++ },
  )

  @Test fun nothingNewIsNeverTold() {
    notices.changed()
    assertEquals(1, told)
    // The deadline thread and the worker call this twice a second; the journal didn't change.
    repeat(10) { now += 500; notices.changed() }
    assertEquals(1, told)
    assertTrue(held.isEmpty())
  }

  @Test fun changesInQuickSuccessionAreToldOnceThenOnceMoreAfterTheInterval() {
    notices.changed()
    repeat(20) { now += 10; revision++; notices.changed() }
    assertEquals(1, told)
    // The last change isn't lost: it's told once the interval is over.
    assertEquals(listOf(490L), held.map { it.first })
    now += 300; held.removeAt(0).second()
    assertEquals(2, told)
    now += 100; revision++; notices.changed()
    assertEquals(2, told)
    assertEquals(1, held.size)
  }
}
