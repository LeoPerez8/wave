package expo.modules.wavenative.artwork

import expo.modules.wavenative.Fixtures
import java.io.File
import org.junit.Assert.*
import org.junit.Test

class MediumCoverBackfillTest {
  private val a = "0123456789abcdef0123456789abcdef01234567"
  private val b = "1111111111111111111111111111111111111111"

  @Test fun processesAtMostOneOriginalPerTurnAndNeverTouchesTagsOrThumbnails() {
    val dir = Fixtures.tempDir()
    File(dir, "$a.png").writeText("first")
    File(dir, "$b.jpg").writeText("second")
    File(dir, "${a}_thumb.jpg").writeText("thumbnail")
    File(dir, "$a.palette").writeText("palette")
    val read = mutableListOf<String>()
    val job = MediumCoverBackfill(dir) { original, medium ->
      read += original.readText()
      medium.writeText("medium")
      true
    }
    assertFalse(job.step())
    assertEquals(1, read.size)
    assertFalse(job.step())
    assertEquals(setOf("first", "second"), read.toSet())
    assertTrue(job.step())
    assertEquals("thumbnail", File(dir, "${a}_thumb.jpg").readText())
    assertEquals("palette", File(dir, "$a.palette").readText())
    val again = MediumCoverBackfill(dir) { _, _ -> error("completed job must not encode again") }
    assertTrue(again.step())
  }

  @Test fun anInterruptedJobResumesAndSkipsExistingMediumCovers() {
    val dir = Fixtures.tempDir()
    File(dir, "$a.png").writeText("cover")
    File(dir, "${a}_medium.jpg").writeText("already made")
    val job = MediumCoverBackfill(dir) { _, _ -> error("must reuse medium") }
    while (!job.step()) { }
    assertEquals("already made", File(dir, "${a}_medium.jpg").readText())
  }

  @Test fun failedCoversAreRetriedNextLaunchWithoutHoldingUpOtherCovers() {
    val dir = Fixtures.tempDir()
    File(dir, "$a.png").writeText("cover")
    val failed = MediumCoverBackfill(dir) { _, _ -> throw java.io.IOException("disk full") }
    assertFalse(failed.step())
    assertTrue(failed.step())
    val retry = MediumCoverBackfill(dir) { _, medium -> medium.writeText("recovered"); true }
    assertFalse(retry.step())
    assertTrue(retry.step())
    assertEquals("recovered", File(dir, "${a}_medium.jpg").readText())
  }
}
