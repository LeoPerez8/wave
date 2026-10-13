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

  private fun downloader() = RangeDownload(chunkBytes = 4_096, attempts = 3, pause = {})

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
  fun aPartFileLeftFromBeforeIsStartedOver() {
    val target = target()
    target.writeBytes(ByteArray(500) { 7 })

    downloader().download(source(), remote.size.toLong(), target)

    assertArrayEquals(remote, target.readBytes())
  }
}
