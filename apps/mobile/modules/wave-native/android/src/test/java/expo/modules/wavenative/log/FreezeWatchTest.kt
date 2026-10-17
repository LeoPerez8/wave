package expo.modules.wavenative.log

import java.io.File
import java.nio.file.Files
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test

/** A thread that stops responding for more than a few seconds goes in the app log as a freeze. */
class FreezeWatchTest {
  private val folder: File = Files.createTempDirectory("wave-log").toFile()
  private val file = AppLogFile(File(File(folder, "logs"), "wave.log"))

  // 2026-10-16T14:03:22.000Z; the log's clock and the watch's are the same here.
  private var now = 1_792_159_402_000L
  private val start = now

  /** Pings posted to the watched thread that it hasn't run yet. */
  private val queue = ArrayDeque<Runnable>()
  private var screen: String? = "/library/artists"

  private fun watch(thread: String, stack: () -> String? = { null }) = FreezeWatch(
    thread = thread,
    thresholdMs = 3_000,
    clock = { now },
    post = { queue.addLast(it); true },
    screen = { screen },
    stack = stack,
  )

  init {
    WaveLog.writeTo(file, clock = { now })
  }

  @After
  fun stop() = WaveLog.writeTo(null)

  /** The log once the entries queued so far are written. */
  private fun logged(): String {
    WaveLog.flush()
    return file.read()
  }

  /** The watched thread runs what was posted to it. */
  private fun threadRuns() {
    while (queue.isNotEmpty()) queue.removeFirst().run()
  }

  /** The watchdog ticks once a second until [until] ms from the start; the thread runs its queue only when [responsive]. */
  private fun ticks(watch: FreezeWatch, until: Long, responsive: Boolean) {
    while (now - start < until) {
      now += 1_000
      watch.tick()
      if (responsive) threadRuns()
    }
  }

  @Test
  fun aThreadThatKeepsAnsweringIsNotAFreeze() {
    val js = watch("JS")
    js.tick()
    ticks(js, until = 20_000, responsive = true)

    assertEquals("", logged())
  }

  @Test
  fun aStallOfFiveSecondsIsRecordedAsAFreezeWithItsScreen() {
    val js = watch("JS")
    js.tick()
    ticks(js, until = 5_000, responsive = false)
    screen = "/settings/developer"
    threadRuns()

    assertEquals(
      "2026-10-16T14:03:25.000Z W freeze: The JS thread has not responded for 3.0 s (screen: /library/artists)\n" +
        "2026-10-16T14:03:27.000Z W freeze: The JS thread responded again after 5.0 s (screen: /library/artists)\n",
      logged(),
    )
  }

  @Test
  fun aMainThreadStallCarriesWhatTheThreadWasDoing() {
    screen = null
    val main = watch("main", stack = { "at expo.modules.wavenative.scan.LibraryScanner.scan(LibraryScanner.kt:88)" })
    main.tick()
    ticks(main, until = 3_000, responsive = false)

    assertEquals(
      "2026-10-16T14:03:25.000Z W freeze: The main thread has not responded for 3.0 s\n" +
        "  at expo.modules.wavenative.scan.LibraryScanner.scan(LibraryScanner.kt:88)\n",
      logged(),
    )
  }

  @Test
  fun eachFreezeIsRecordedOnce() {
    val js = watch("JS")
    js.tick()
    ticks(js, until = 8_000, responsive = false)
    threadRuns()
    ticks(js, until = 12_000, responsive = true)
    ticks(js, until = 18_000, responsive = false)

    val lines = logged().lines().filter { it.isNotEmpty() }
    assertEquals(
      listOf(
        "2026-10-16T14:03:25.000Z W freeze: The JS thread has not responded for 3.0 s (screen: /library/artists)",
        "2026-10-16T14:03:30.000Z W freeze: The JS thread responded again after 8.0 s (screen: /library/artists)",
        "2026-10-16T14:03:38.000Z W freeze: The JS thread has not responded for 3.0 s (screen: /library/artists)",
      ),
      lines,
    )
  }

  @Test
  fun aWholeProcessPausedIsNotAFreeze() {
    // Android froze Wave in the background: the watchdog didn't tick either.
    val js = watch("JS")
    js.tick()
    now += 60_000
    js.tick()
    threadRuns()
    ticks(js, until = 70_000, responsive = true)

    assertEquals("", logged())
  }
}
