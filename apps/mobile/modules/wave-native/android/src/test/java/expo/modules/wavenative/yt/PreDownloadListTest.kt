package expo.modules.wavenative.yt

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PreDownloadListTest {
  @Test
  fun theListIsReadFromWhereItsKeptOnceThenAsItWasLastHandedOver() {
    val list = PreDownloadList()
    var reads = 0
    val stored = { reads += 1; "a,b" }
    assertEquals(listOf("a", "b"), list.get(stored))
    assertEquals(listOf("a", "b"), list.get(stored))
    assertEquals(1, reads)
    var kept: String? = null
    list.set(listOf("c", "d")) { kept = it }
    assertEquals("c,d", kept)
    assertEquals(listOf("c", "d"), list.get(stored))
    assertEquals(listOf<String>(), PreDownloadList().get { null })
  }

  @Test
  fun aListHandedOverWhileTheOldOneIsBeingReadIsntPutBackByThatRead() {
    val list = PreDownloadList()
    val reading = CountDownLatch(1)
    val goOn = CountDownLatch(1)
    // A cold process: the job's thread reads the list kept before.
    val job = thread {
      list.get {
        reading.countDown()
        goOn.await(5, TimeUnit.SECONDS)
        "old"
      }
    }
    assertTrue(reading.await(5, TimeUnit.SECONDS))
    // Meanwhile JS hands over the day's new list.
    val js = thread { list.set(listOf("new")) {} }
    val waitedUntil = System.nanoTime() + TimeUnit.SECONDS.toNanos(1)
    while (js.state != Thread.State.BLOCKED && js.isAlive && System.nanoTime() < waitedUntil) Thread.sleep(1)
    goOn.countDown()
    job.join(5_000)
    js.join(5_000)
    assertEquals(listOf("new"), list.get { "read again" })
  }
}
