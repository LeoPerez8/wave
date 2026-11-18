package expo.modules.wavenative.download

import expo.modules.wavenative.Fixtures
import java.io.ByteArrayInputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.util.concurrent.CancellationException
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/** Downloads a made-up remote file in byte ranges into a part file. */
class RangeDownloadTest {
  private val remote = ByteArray(10_000) { (it * 31 % 251).toByte() }
  private val requested = mutableListOf<LongRange>()

  private fun target(): File = File(Fixtures.tempDir(), ".song.part.m4a")

  /** Serves [remote]'s bytes in [range]; [failAfter] bytes into a request it breaks off, once per entry. */
  private fun source(failures: MutableList<Int> = mutableListOf(), short: Int? = null) =
    RangeSource { start, end ->
      requested += start..end
      val until = minOf(end + 1, remote.size.toLong(), start + (short ?: remote.size)).toInt()
      val bytes = remote.copyOfRange(start.toInt(), until)
      val failAfter = failures.removeFirstOrNull()
      if (failAfter == null) ByteArrayInputStream(bytes) else BreakingStream(bytes, failAfter)
    }

  private class BreakingStream(bytes: ByteArray, private val failAfter: Int) : InputStream() {
    private val inner = ByteArrayInputStream(bytes)
    private var read = 0

    override fun read(): Int {
      if (read >= failAfter) throw IOException("connection reset")
      read += 1
      return inner.read()
    }
  }

  private fun downloader() = RangeDownload(chunkBytes = 4_096, attempts = 3, pause = {}, overlapBytes = 1_024)

  @Test
  fun downloadsTheFileInRangesOfTheChunkSize() {
    val target = target()
    val progress = mutableListOf<Long>()

    downloader().download(source(), remote.size.toLong(), target, onProgress = { progress += it })

    assertArrayEquals(remote, target.readBytes())
    assertEquals(listOf(0L..4_095L, 4_096L..8_191L, 8_192L..9_999L), requested)
    assertEquals(progress.sorted(), progress)
    assertEquals(10_000L, progress.last())
  }

  @Test
  fun aBrokenRequestIsTriedAgainFromWhereItStopped() {
    val target = target()

    downloader().download(source(failures = mutableListOf(1_000)), remote.size.toLong(), target)

    assertArrayEquals(remote, target.readBytes())
    assertEquals(1_000L..4_095L, requested[1])
  }

  @Test
  fun aShortAnswerIsFollowedByARequestForTheRest() {
    val target = target()

    downloader().download(source(short = 3_000), remote.size.toLong(), target)

    assertArrayEquals(remote, target.readBytes())
    assertEquals(3_000L..4_095L, requested[1])
  }

  @Test
  fun givesUpAfterTooManyFailuresInARowAndLeavesNoFile() {
    val target = target()

    assertThrows(IOException::class.java) {
      downloader().download(source(failures = mutableListOf(10, 0, 0)), remote.size.toLong(), target)
    }

    assertFalse(target.exists())
  }

  @Test
  fun aStepForwardResetsTheFailureCount() {
    val target = target()

    downloader().download(source(failures = mutableListOf(100, 100, 100, 100)), remote.size.toLong(), target)

    assertArrayEquals(remote, target.readBytes())
  }

  @Test
  fun cancellingStopsTheDownloadAndLeavesNoFile() {
    val target = target()
    var cancelled = false

    assertThrows(CancellationException::class.java) {
      downloader().download(
        source(),
        remote.size.toLong(),
        target,
        onProgress = { if (it >= 4_096) cancelled = true },
        isCancelled = { cancelled },
      )
    }

    assertFalse(target.exists())
    assertTrue(requested.size < 3)
  }

  @Test
  fun aSourceThatChangesStartsTheFileOverAtItsNewLength() {
    val target = target()
    val replacement = ByteArray(6_000) { (it * 17 % 241).toByte() }
    var changed = false
    val progress = mutableListOf<Long>()
    val source = RangeSource { start, end ->
      requested += start..end
      if (changed) {
        ByteArrayInputStream(replacement.copyOfRange(start.toInt(), minOf(end + 1, 6_000L).toInt()))
      } else if (start >= 4_096) {
        // The first stream is refused halfway; the one that replaces it is another file.
        changed = true
        throw RangeSourceChanged(replacement.size.toLong())
      } else {
        ByteArrayInputStream(remote.copyOfRange(start.toInt(), (end + 1).toInt()))
      }
    }

    downloader().download(source, remote.size.toLong(), target, onProgress = { progress += it })

    assertArrayEquals(replacement, target.readBytes())
    assertEquals(listOf(0L..4_095L, 4_096L..8_191L, 0L..4_095L, 4_096L..5_999L), requested)
    assertEquals(6_000L, progress.last())
  }

  @Test
  fun aPartFileLeftFromBeforeIsStartedOver() {
    val target = target()
    target.writeBytes(ByteArray(500) { 7 })

    downloader().download(source(), remote.size.toLong(), target)

    assertArrayEquals(remote, target.readBytes())
  }

  // Resuming: a YouTube attempt goes on in the part file the attempt before it left.

  @Test
  fun resumingGoesOnFromThePartFilesLastByteAndTheFileComesOutWhole() {
    val target = target()
    target.writeBytes(remote.copyOfRange(0, 5_000))
    val resumedAt = mutableListOf<Long>()
    val progress = mutableListOf<Long>()

    downloader().download(source(), remote.size.toLong(), target, onProgress = { progress += it }, resume = true, onResume = { resumedAt += it })

    assertArrayEquals(remote, target.readBytes())
    assertEquals(listOf(5_000L), resumedAt)
    // Only a little before the kept bytes' end is asked for again, to check they're this file's.
    assertTrue(requested.none { it.first == 0L })
    assertEquals(10_000L, progress.last())
    assertTrue(progress.all { it >= 5_000L })
  }

  @Test
  fun resumingAPartFileThatHoldsAnotherFileStartsItOver() {
    val target = target()
    target.writeBytes(ByteArray(5_000) { (it % 13).toByte() })
    val resumedAt = mutableListOf<Long>()

    downloader().download(source(), remote.size.toLong(), target, resume = true, onResume = { resumedAt += it })

    assertArrayEquals(remote, target.readBytes())
    assertEquals(listOf(0L), resumedAt)
  }

  @Test
  fun resumingAPartFileAlreadyAsLongAsTheFileStartsItOver() {
    val target = target()
    target.writeBytes(ByteArray(remote.size) { 7 })

    downloader().download(source(), remote.size.toLong(), target, resume = true)

    assertArrayEquals(remote, target.readBytes())
    assertEquals(0L, requested.first().first)
  }

  @Test
  fun whenResumingAFailureKeepsTheBytesThatArrivedForTheNextAttempt() {
    val target = target()

    assertThrows(IOException::class.java) {
      downloader().download(source(failures = mutableListOf(0, 1_000, 0, 0)), remote.size.toLong(), target, resume = true)
    }

    // 1,000 bytes arrived before the connection went for good.
    assertArrayEquals(remote.copyOfRange(0, 1_000), target.readBytes())
    downloader().download(source(), remote.size.toLong(), target, resume = true)
    assertArrayEquals(remote, target.readBytes())
  }

  @Test
  fun whenResumingACancellationKeepsTheBytesThatArrived() {
    val target = target()
    var cancelled = false

    assertThrows(CancellationException::class.java) {
      downloader().download(source(), remote.size.toLong(), target, onProgress = { if (it >= 4_096) cancelled = true }, isCancelled = { cancelled }, resume = true)
    }

    assertArrayEquals(remote.copyOfRange(0, 4_096), target.readBytes())
  }

  @Test
  fun aPauseCutShortByACancelIsACancellation() {
    val target = target()
    val interrupted = RangeDownload(chunkBytes = 4_096, attempts = 3, pause = { throw InterruptedException() })

    assertThrows(CancellationException::class.java) {
      interrupted.download(source(failures = mutableListOf(0)), remote.size.toLong(), target, resume = true)
    }
  }

  @Test
  fun aRequestBrokenByACancelIsACancellationNotAFailure() {
    val target = target()
    var cancelled = false
    val breaking = RangeSource { _, _ -> cancelled = true; throw IOException("Socket closed") }

    assertThrows(CancellationException::class.java) {
      downloader().download(breaking, remote.size.toLong(), target, isCancelled = { cancelled }, resume = true)
    }
  }
}
