package expo.modules.wavenative.download

import java.util.Collections
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Download work runs at Android's background thread priority (#455); what's around it keeps its own. */
class BackgroundThreadsTest {
  @Test fun everyThreadLowersItsPriorityBeforeItRunsAnyWork() {
    val lowered = Collections.synchronizedSet(HashSet<Thread>())
    val ranLowered = Collections.synchronizedList(ArrayList<Boolean>())
    val pool = Executors.newCachedThreadPool(BackgroundThreads("Wave download step", lower = { lowered += Thread.currentThread() }))
    try {
      repeat(3) { pool.execute { ranLowered += Thread.currentThread() in lowered } }
      pool.shutdown()
      assertTrue(pool.awaitTermination(10, TimeUnit.SECONDS))
      assertEquals(listOf(true, true, true), ranLowered.toList())
    } finally { pool.shutdownNow() }
  }

  @Test fun itsThreadsAreNamedForAThreadInspection() {
    val factory = BackgroundThreads("Wave download step", lower = {})
    assertEquals(listOf("Wave download step 1", "Wave download step 2"), List(2) { factory.newThread {}.name })
  }

  @Test fun workOnAnotherThreadRunsAtBackgroundPriorityAndGivesItsOwnBack() {
    var priority = 0
    val seen = BackgroundThreads.during(get = { priority }, set = { priority = it }) { priority }
    assertEquals(BackgroundThreads.BACKGROUND, seen)
    assertEquals(0, priority)
  }
}
