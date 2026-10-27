package expo.modules.wavenative.player

import java.io.File
import java.nio.file.Files
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ResumeFilesTest {
  private val dir: File = Files.createTempDirectory("resume").toFile()

  private val snapshot = ResumeSnapshot(
    items = listOf(
      ResumeItem("k1", "/music/One.flac", "One", "Artist", "Album", null),
      ResumeItem("k2", "/music/Two.mp3", "Two", "Artist", null, null),
      ResumeItem("k3", "/music/Three.mp3", "Three", "Artist", null, null),
    ),
    index = 0,
    positionMs = 12_000,
    shuffle = false,
    repeat = "off",
    source = "phone",
    queueJson = """{"entries":[],"index":0}""",
    queueIndex = 0,
    queueMetadata = """{"repeat":"off"}""",
  )

  @After fun cleanUp() {
    dir.deleteRecursively()
  }

  private fun file(name: String) = File(dir, name)

  @Test
  fun `a written snapshot reads back the same after a kill`() {
    ResumeFiles(dir).write(snapshot, withItems = true)

    assertEquals(snapshot, ResumeFiles(dir).read())
  }

  @Test
  fun `a skip and position saves leave the items alone`() {
    val files = ResumeFiles(dir)
    files.write(snapshot, withItems = true)
    val items = file("resume-items.txt").readText()
    file("resume-items.txt").setLastModified(0)

    val skipped = snapshot.copy(index = 1, positionMs = 0, queueIndex = 1)
    files.write(skipped, withItems = false)
    files.write(skipped.copy(positionMs = 10_000), withItems = false)

    assertEquals(0L, file("resume-items.txt").lastModified())
    assertEquals(items, file("resume-items.txt").readText())
    assertEquals(skipped.copy(positionMs = 10_000), ResumeFiles(dir).read())
  }

  @Test
  fun `new items are written with their place`() {
    val files = ResumeFiles(dir)
    files.write(snapshot, withItems = true)
    val longer = snapshot.copy(items = snapshot.items + ResumeItem("k4", "/music/Four.mp3", "Four", "Artist", null, null))

    files.write(longer, withItems = true)

    assertEquals(longer, ResumeFiles(dir).read())
  }

  @Test
  fun `a snapshot an earlier Wave wrote still resumes, and moves to the split files`() {
    val legacy = listOf(
      "wave-resume 1",
      "index\t2",
      "position\t40000",
      "shuffle\tfalse",
      "repeat\tone",
      "source\tauto",
      "queue\t{\"entries\":[],\"index\":2}",
      "item\tk1\t/music/One.flac\tOne\tArtist\tAlbum\t\\N",
      "item\tk2\t/music/Two.mp3\tTwo\tArtist\t\\N\t\\N",
      "item\tk3\t/music/Three.mp3\tThree\tArtist\t\\N\t\\N",
    ).joinToString("\n", postfix = "\n")
    file("resume-snapshot.txt").writeText(legacy)
    val old = snapshot.copy(
      index = 2,
      positionMs = 40_000,
      repeat = "one",
      source = "auto",
      queueJson = """{"entries":[],"index":2}""",
      queueIndex = null,
      queueMetadata = null,
    )

    val files = ResumeFiles(dir)
    assertEquals(old, files.read())

    // The first save of a process writes the items too, whatever changed.
    files.write(old.copy(positionMs = 50_000), withItems = false)

    assertFalse(file("resume-snapshot.txt").exists())
    assertEquals(old.copy(positionMs = 50_000), ResumeFiles(dir).read())
  }

  @Test
  fun `items without their place fall back to the earlier snapshot`() {
    file("resume-snapshot.txt").writeText(
      "wave-resume 1\nindex\t0\nposition\t0\nshuffle\tfalse\nrepeat\toff\nsource\tphone\nqueue\t\\N\n",
    )
    file("resume-items.txt").writeText(snapshot.encodeItems())

    val read = ResumeFiles(dir).read()

    assertTrue(read != null && read.items.isEmpty())
  }

  @Test
  fun `nothing saved reads as none`() {
    assertNull(ResumeFiles(dir).read())
  }
}
