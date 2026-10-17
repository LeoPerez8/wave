package expo.modules.wavenative.log

import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Native entries are written by one thread of their own, so whoever logs never waits for the file. */
class AppLogWriterTest {
  private val written: MutableList<String> = Collections.synchronizedList(mutableListOf())

  /** Open until the test lets the file be written; a trim or JS reading the log holds it like this. */
  private val fileBusy = CountDownLatch(1)

  private var writer: AppLogWriter? = null

  private fun writer(capacity: Int = 1_000) = AppLogWriter(
    append = { text ->
      fileBusy.await()
      written.add(text)
    },
    capacity = capacity,
    dropped = { count -> "$count dropped\n" },
  ).also { writer = it }

  @After
  fun stop() {
    fileBusy.countDown()
    writer?.close()
  }

  @Test(timeout = 5_000)
  fun loggingDoesNotWaitForTheFile() {
    val log = writer()

    log.write { "first\n" }
    log.write { "second\n" }

    assertTrue("nothing was written while the file was busy", written.isEmpty())
    fileBusy.countDown()
    log.flush()
    assertEquals(listOf("first\n", "second\n"), written)
  }

  @Test(timeout = 5_000)
  fun theWriterWritesWithoutBeingFlushed() {
    val log = writer()
    fileBusy.countDown()

    log.write { "on its own\n" }

    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3)
    while (written.isEmpty() && System.nanoTime() < deadline) Thread.sleep(5)
    assertEquals(listOf("on its own\n"), written)
  }

  @Test(timeout = 5_000)
  fun flushWritesWhatEveryThreadQueuedInOrder() {
    val log = writer()
    val threads = (0 until 4).map { thread ->
      Thread { repeat(50) { i -> log.write { "$thread:$i\n" } } }
    }
    threads.forEach(Thread::start)
    threads.forEach(Thread::join)
    fileBusy.countDown()

    log.flush()

    assertEquals(200, written.size)
    for (thread in 0 until 4) {
      assertEquals((0 until 50).map { "$thread:$it\n" }, written.filter { it.startsWith("$thread:") })
    }
  }

  @Test(timeout = 5_000)
  fun pastItsCapacityEntriesAreDroppedAndCounted() {
    val log = writer(capacity = 3)

    repeat(10) { i -> log.write { "$i\n" } }
    fileBusy.countDown()
    log.flush()

    // The writer may have taken the first entry before the file was free; either way at most 4 got in.
    val kept = written.filterNot { it.endsWith("dropped\n") }
    assertTrue(written.toString(), kept.size in 3..4)
    assertEquals(kept, (0 until kept.size).map { "$it\n" })
    assertEquals("${10 - kept.size} dropped\n", written.last())
  }

  @Test(timeout = 5_000)
  fun anEntryThatFailsToFormatDoesNotStopTheOthers() {
    val log = writer()
    fileBusy.countDown()

    log.write { error("unformattable") }
    log.write { "after it\n" }
    log.flush()

    assertEquals(listOf("after it\n"), written)
  }
}
