package expo.modules.wavenative.normalize

import java.util.Collections
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SongMeterTest {
  private val thread = Executors.newSingleThreadExecutor()
  private val job = Executors.newSingleThreadExecutor()
  private val measuring = Collections.synchronizedList(mutableListOf<String>())
  private val loud = FileLoudness.Outcome.Measured(-8.0, 1.0)

  // Files named "slow…" are measured until they're cancelled or [release]d.
  private val started = mutableMapOf<String, CountDownLatch>()
  private val release = CountDownLatch(1)

  private val meter = SongMeter(
    measure = { path, isCancelled ->
      measuring += path
      started[path]?.countDown()
      if (path.startsWith("slow")) {
        while (!isCancelled() && !release.await(1, TimeUnit.MILLISECONDS)) Unit
        if (isCancelled()) FileLoudness.Outcome.Cancelled else loud
      } else {
        loud
      }
    },
    thread = thread,
  )

  @After
  fun stop() {
    release.countDown()
    thread.shutdownNow()
    job.shutdownNow()
  }

  private fun startedOn(path: String) = CountDownLatch(1).also { started[path] = it }

  @Test
  fun theQueuesMeasurementStopsTheLibrarysAndGoesFirst() {
    val libraryStarted = startedOn("slow library")
    val library = job.submit<FileLoudness.Outcome?> { meter.forLibrary("slow library") { false } }
    assertTrue(libraryStarted.await(5, TimeUnit.SECONDS))
    val answers = ArrayBlockingQueue<FileLoudness.Outcome>(1)
    meter.forQueue("queue") { answers.put(it) }
    // Stopped for the queue: to be measured again, so nothing of it is kept.
    assertNull(library.get(5, TimeUnit.SECONDS))
    assertEquals(loud, answers.poll(5, TimeUnit.SECONDS))
    assertEquals(listOf("slow library", "queue"), measuring.toList())
    assertEquals(loud, meter.forLibrary("library") { false })
  }

  @Test
  fun aLibraryFileWaitsForTheQueuesMeasurementsAskedBeforeIt() {
    val queueStarted = startedOn("slow queue")
    val answers = ArrayBlockingQueue<FileLoudness.Outcome>(2)
    meter.forQueue("slow queue") { answers.put(it) }
    meter.forQueue("queue") { answers.put(it) }
    assertTrue(queueStarted.await(5, TimeUnit.SECONDS))
    val library = job.submit<FileLoudness.Outcome?> { meter.forLibrary("library") { false } }
    release.countDown()
    assertEquals(loud, library.get(5, TimeUnit.SECONDS))
    assertEquals(listOf("slow queue", "queue", "library"), measuring.toList())
  }

  @Test
  fun theJobStoppingStopsItsMeasurement() {
    val libraryStarted = startedOn("slow library")
    val stop = CountDownLatch(1)
    val library = job.submit<FileLoudness.Outcome?> { meter.forLibrary("slow library") { stop.count == 0L } }
    assertTrue(libraryStarted.await(5, TimeUnit.SECONDS))
    stop.countDown()
    assertEquals(FileLoudness.Outcome.Cancelled, library.get(5, TimeUnit.SECONDS))
  }

  @Test
  fun cancellingTheQueuesMeasurementStopsIt() {
    val queueStarted = startedOn("slow queue")
    val answers = ArrayBlockingQueue<FileLoudness.Outcome>(1)
    meter.forQueue("slow queue") { answers.put(it) }
    assertTrue(queueStarted.await(5, TimeUnit.SECONDS))
    meter.cancelQueue()
    assertEquals(FileLoudness.Outcome.Cancelled, answers.poll(5, TimeUnit.SECONDS))
  }
}
