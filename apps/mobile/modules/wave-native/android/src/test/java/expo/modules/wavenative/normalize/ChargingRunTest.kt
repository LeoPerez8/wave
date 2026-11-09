package expo.modules.wavenative.normalize

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class ChargingRunTest {
  @get:Rule
  val folder = TemporaryFolder()

  private fun song(id: Long) = LibrarySong(id, "/Music/$id.flac", 1_000, 1)

  /** A phone on its charger with the Library files [ids] to measure, each taking a minute. */
  private inner class Phone(ids: List<Long>) {
    val list = LibraryToMeasure(folder.root).apply { replace(ids.map(::song)) }
    val measured = mutableListOf<String>()
    val kept = mutableListOf<Long>()
    var clockMs = 0L
    var plugged = true
    var unplugDuring: String? = null
    var queueTakesOver: MutableSet<String> = mutableSetOf()
    var outcomeOf: (String) -> FileLoudness.Outcome = { FileLoudness.Outcome.Measured(-10.0, 0.9) }

    fun run(budgetMs: Long = 60 * 60_000L) = ChargingRun(
      list = list,
      measure = { path, stop ->
        measured += path
        clockMs += 60_000
        if (path == unplugDuring) plugged = false
        when {
          stop() -> FileLoudness.Outcome.Cancelled
          queueTakesOver.remove(path) -> null
          else -> outcomeOf(path)
        }
      },
      stopped = { !plugged },
      now = { clockMs },
      budgetMs = budgetMs,
      kept = { kept += it.song.id },
    ).run()
  }

  @Test
  fun aRunMeasuresEveryFileInTheListAndKeepsWhatEachGave() {
    val phone = Phone(listOf(1, 2, 3))
    phone.outcomeOf = { if (it == "/Music/2.flac") FileLoudness.Outcome.Unmeasurable("broken") else FileLoudness.Outcome.Measured(-10.0, 0.9) }
    val summary = phone.run()
    assertEquals(ChargingRun.Summary(measured = 2, unmeasurable = 1, unreadable = 0, left = 0, ended = ChargingRun.Ended.DONE), summary)
    assertFalse(summary.again)
    assertEquals(listOf(1L, 2L, 3L), phone.kept)
    assertEquals(
      listOf(LibraryResult.Kind.MEASURED, LibraryResult.Kind.UNMEASURABLE, LibraryResult.Kind.MEASURED),
      phone.list.results(10).map { it.kind },
    )
  }

  @Test
  fun unpluggingStopsTheRunMidFileKeepingTheFilesItFinished() {
    val phone = Phone(listOf(1, 2, 3))
    phone.unplugDuring = "/Music/2.flac"
    val summary = phone.run()
    assertEquals(ChargingRun.Summary(measured = 1, unmeasurable = 0, unreadable = 0, left = 2, ended = ChargingRun.Ended.STOPPED), summary)
    assertEquals(listOf(song(1)), phone.list.results(10).map { it.song })
    // Plugged in again: the next run picks up with the file it stopped in.
    phone.plugged = true
    phone.unplugDuring = null
    phone.measured.clear()
    assertEquals(ChargingRun.Ended.DONE, phone.run().ended)
    assertEquals(listOf("/Music/2.flac", "/Music/3.flac"), phone.measured)
  }

  @Test
  fun aRunEndsWhenItsShareOfTimeIsUpAndTheNextGoesOn() {
    val phone = Phone(listOf(1, 2, 3, 4, 5))
    val summary = phone.run(budgetMs = 2 * 60_000L)
    assertEquals(ChargingRun.Summary(measured = 2, unmeasurable = 0, unreadable = 0, left = 3, ended = ChargingRun.Ended.OUT_OF_TIME), summary)
    assertTrue(summary.again)
    phone.measured.clear()
    phone.clockMs = 0
    assertEquals(3, phone.run().measured)
    assertEquals(listOf("/Music/3.flac", "/Music/4.flac", "/Music/5.flac"), phone.measured)
  }

  @Test
  fun aFileTheQueuesMeasurementStoppedIsMeasuredAgainAfterIt() {
    val phone = Phone(listOf(1, 2))
    phone.queueTakesOver = mutableSetOf("/Music/1.flac")
    assertEquals(2, phone.run().measured)
    assertEquals(listOf("/Music/1.flac", "/Music/1.flac", "/Music/2.flac"), phone.measured)
  }

  @Test
  fun aFileItCantOpenWaitsForTheNextListAndTheRunGoesOn() {
    val phone = Phone(listOf(1, 2))
    phone.outcomeOf = { if (it == "/Music/1.flac") FileLoudness.Outcome.Unreadable else FileLoudness.Outcome.Measured(-10.0, 0.9) }
    assertEquals(ChargingRun.Summary(measured = 1, unmeasurable = 0, unreadable = 1, left = 0, ended = ChargingRun.Ended.DONE), phone.run())
  }

  @Test
  fun withOnlyFilesItCantOpenLeftItGoesIdleUntilTheAppHandsThemOverAgain() {
    val phone = Phone(listOf(1, 2))
    phone.outcomeOf = { FileLoudness.Outcome.Unreadable }
    val first = phone.run()
    assertEquals(ChargingRun.Summary(measured = 0, unmeasurable = 0, unreadable = 2, left = 0, ended = ChargingRun.Ended.DONE), first)
    assertFalse(first.again)
    // Nothing to schedule a job for, before and after the app takes the results in.
    assertEquals(null, phone.list.next())
    phone.list.forget(2)
    assertEquals(null, phone.list.next())
    assertEquals(ChargingRun.Summary(0, 0, 0, 0, ChargingRun.Ended.DONE), phone.run())
    assertEquals(listOf("/Music/1.flac", "/Music/2.flac"), phone.measured)
    // After the next scan or launch the app hands them over again, and they're tried again.
    phone.list.replace(listOf(song(1), song(2)))
    phone.outcomeOf = { FileLoudness.Outcome.Measured(-10.0, 0.9) }
    assertEquals(2, phone.run().measured)
  }

  @Test
  fun aRunWritesOneLineSayingHowManySongsItMeasuredAndNoneOfThem() {
    assertEquals(
      "Charging run measured 12 songs, 1 unmeasurable; 340 left (time's up, going on in the next run)",
      ChargingRun.line(ChargingRun.Summary(12, 1, 0, 340, ChargingRun.Ended.OUT_OF_TIME)),
    )
    assertEquals(
      "Charging run measured 1 song, 2 unreadable; 0 left (nothing left to measure)",
      ChargingRun.line(ChargingRun.Summary(1, 0, 2, 0, ChargingRun.Ended.DONE)),
    )
    assertEquals(
      "Charging run measured 0 songs; 7 left (unplugged)",
      ChargingRun.line(ChargingRun.Summary(0, 0, 0, 7, ChargingRun.Ended.STOPPED), stopped = "unplugged"),
    )
  }
}
