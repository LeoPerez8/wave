package expo.modules.wavenative.normalize

import java.io.File
import java.io.RandomAccessFile
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class LibraryToMeasureTest {
  @get:Rule
  val folder = TemporaryFolder()

  private fun song(id: Long, sizeBytes: Long = 1_000) = LibrarySong(id, "/Music/$id.flac", sizeBytes, 1)

  private fun open() = LibraryToMeasure(folder.root)

  private fun LibraryToMeasure.measured(id: Long) = record(song(id), LibraryResult.Kind.MEASURED, -10.0, 0.9)

  @Test
  fun theJobWorksThroughTheListInItsOrder() {
    val list = open()
    list.replace(listOf(song(3), song(1), song(2)))
    assertEquals(song(3), list.next())
    list.measured(3)
    assertEquals(song(1), list.next())
    assertEquals(2, list.left())
    list.record(song(1), LibraryResult.Kind.UNMEASURABLE, 0.0, 0.0)
    list.measured(2)
    assertNull(list.next())
    assertEquals(0, list.left())
    assertEquals(listOf(1L, 2L, 3L), list.results(10).map { it.seq })
    assertEquals(LibraryResult(1, song(3), LibraryResult.Kind.MEASURED, -10.0, 0.9), list.results(10).first())
  }

  @Test
  fun theListAndItsResultsOutliveTheProcess() {
    open().apply {
      replace(listOf(song(1), song(2)))
      measured(1)
    }
    val again = open()
    assertEquals(song(2), again.next())
    assertEquals(listOf(song(1)), again.results(10).map { it.song })
  }

  @Test
  fun aResultCutOffMidWriteIsDroppedAndTheOnesBeforeItKept() {
    open().apply {
      replace(listOf(song(1), song(2), song(3)))
      measured(1)
      measured(2)
    }
    val journal = File(folder.root, LibraryToMeasure.RESULTS_FILE)
    RandomAccessFile(journal, "rw").use { it.setLength(it.length() - 3) }
    val again = open()
    assertEquals(listOf(song(1)), again.results(10).map { it.song })
    assertEquals(song(2), again.next())
    // Results kept after the cut read back whole.
    again.measured(2)
    assertEquals(listOf(song(1), song(2)), open().results(10).map { it.song })
  }

  @Test
  fun resultsTheAppTookInLeaveTheListWithTheirSongs() {
    val list = open()
    list.replace(listOf(song(1), song(2), song(3)))
    list.measured(1)
    list.record(song(2), LibraryResult.Kind.UNREADABLE, 0.0, 0.0)
    list.forget(2)
    assertEquals(emptyList<LibraryResult>(), list.results(10))
    assertEquals(song(3), list.next())
    assertEquals(1, list.left())
    assertEquals(song(3), open().next())
    assertEquals(1, open().left())
  }

  @Test
  fun aNewListKeepsTheResultsNotTakenInAndDoesntMeasureTheirSongsAgain() {
    val list = open()
    list.replace(listOf(song(1), song(2)))
    list.measured(1)
    // The app's new list still has song 1 (it hasn't taken its result in), a changed file and a new one.
    list.replace(listOf(song(1), song(2, sizeBytes = 2_000), song(4)))
    assertEquals(song(2, sizeBytes = 2_000), list.next())
    assertEquals(2, list.left())
    assertEquals(listOf(song(1)), list.results(10).map { it.song })
  }

  @Test
  fun anEmptyListLeavesNothingToMeasure() {
    val list = open()
    list.replace(listOf(song(1)))
    list.replace(emptyList())
    assertNull(list.next())
    assertNull(open().next())
  }

  @Test
  fun resultsAreHandedOverAFewAtATime() {
    val list = open()
    list.replace((1L..5L).map { song(it) })
    (1L..5L).forEach { list.measured(it) }
    assertEquals(listOf(1L, 2L), list.results(2).map { it.seq })
    list.forget(2)
    assertEquals(listOf(3L, 4L), list.results(2).map { it.seq })
  }

  @Test
  fun aResultsPlaceKeepsGrowingOnceItsEarlierOnesAreForgotten() {
    open().apply {
      replace(listOf(song(1), song(2)))
      measured(1)
      forget(1)
    }
    val again = open()
    // A place the app forgot through never comes back for a new result.
    assertEquals(2L, again.measured(2).seq)
  }
}
