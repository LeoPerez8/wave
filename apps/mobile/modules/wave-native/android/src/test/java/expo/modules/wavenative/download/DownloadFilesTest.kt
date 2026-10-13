package expo.modules.wavenative.download

import expo.modules.wavenative.Fixtures
import expo.modules.wavenative.scan.AudioFileWalker
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DownloadFilesTest {
  @Test
  fun aPartFileSitsBesideItsTargetHiddenFromScansButKeepsItsFormat() {
    val root = Fixtures.tempDir()
    val target = File(root, "YT Music/Daft Punk/RAM/08 Get Lucky.m4a")
    val part = DownloadFiles.partFileFor(target)
    assertEquals(target.parentFile, part.parentFile)
    assertEquals("m4a", part.extension)
    part.parentFile.mkdirs()
    part.writeText("audio")

    val found = mutableListOf<File>()
    AudioFileWalker(listOf(root), emptyList()).walk { found += it }
    assertEquals(emptyList<File>(), found)
  }

  @Test
  fun movesTheFinishedFileIntoPlaceCreatingItsFolders() {
    val root = Fixtures.tempDir()
    val part = File(root, ".08 Get Lucky.part.m4a").apply { writeText("audio") }
    val target = File(root, "YT Music/Daft Punk/RAM/08 Get Lucky.m4a")

    val saved = DownloadFiles.moveIntoPlace(part, target)

    assertEquals(target, saved)
    assertEquals("audio", saved.readText())
    assertFalse(part.exists())
  }

  @Test
  fun neverReplacesAFileThatIsAlreadyThere() {
    val folder = Fixtures.tempDir()
    val target = File(folder, "08 Get Lucky.m4a").apply { writeText("mine") }
    File(folder, "08 Get Lucky (2).m4a").writeText("also mine")
    val part = File(folder, ".08 Get Lucky.part.m4a").apply { writeText("download") }

    val saved = DownloadFiles.moveIntoPlace(part, target)

    assertEquals("08 Get Lucky (3).m4a", saved.name)
    assertEquals("download", saved.readText())
    assertEquals("mine", target.readText())
    assertTrue(File(folder, "08 Get Lucky (2).m4a").readText() == "also mine")
  }
}
