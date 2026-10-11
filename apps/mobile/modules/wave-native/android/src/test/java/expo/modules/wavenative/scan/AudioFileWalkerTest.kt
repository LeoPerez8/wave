package expo.modules.wavenative.scan

import expo.modules.wavenative.Fixtures
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Test

class AudioFileWalkerTest {
  private fun walk(roots: List<File>, excluded: List<File> = emptyList()): List<String> {
    val found = mutableListOf<String>()
    AudioFileWalker(roots, excluded).walk { found.add(it.path) }
    return found
  }

  private fun library(vararg paths: String): File {
    val root = Fixtures.tempDir().canonicalFile
    for (path in paths) File(root, path).apply { parentFile.mkdirs(); writeText("x") }
    return root
  }

  @Test
  fun findsAudioFilesOfEverySupportedFormatInSortedOrder() {
    val root = library(
      "B/2.flac",
      "A/1.mp3",
      "A/cover.jpg",
      "A/notes.txt",
      "C/x.M4A",
      "C/y.opus",
      "C/z.ogg",
      "C/w.wav",
      "C/v.aac",
    )
    assertEquals(
      listOf("A/1.mp3", "B/2.flac", "C/v.aac", "C/w.wav", "C/x.M4A", "C/y.opus", "C/z.ogg"),
      walk(listOf(root)).map { it.removePrefix("${root.path}/") },
    )
  }

  @Test
  fun skipsExcludedFoldersAndEverythingBelowThem() {
    val root = library("Keep/a.mp3", "Skip/b.mp3", "Skip/Deeper/c.mp3", "Skipper/d.mp3")
    assertEquals(
      listOf("Keep/a.mp3", "Skipper/d.mp3"),
      walk(listOf(root), excluded = listOf(File(root, "Skip"))).map { it.removePrefix("${root.path}/") },
    )
  }

  @Test
  fun skipsHiddenFilesAndFolders() {
    val root = library("a.mp3", ".hidden.mp3", ".thumbnails/b.mp3")
    assertEquals(listOf("a.mp3"), walk(listOf(root)).map { it.removePrefix("${root.path}/") })
  }

  @Test
  fun overlappingRootsReportEachFileOnce() {
    val root = library("Album/a.mp3", "b.mp3")
    assertEquals(2, walk(listOf(root, File(root, "Album"))).size)
  }

  @Test
  fun missingRootsAreIgnored() {
    assertEquals(emptyList<String>(), walk(listOf(File("/definitely/not/here"))))
  }

  @Test
  fun stopsWhenCancelled() {
    val root = library("a/1.mp3", "b/2.mp3", "c/3.mp3")
    val found = mutableListOf<File>()
    AudioFileWalker(listOf(root), emptyList()).walk(isCancelled = { found.isNotEmpty() }) { found.add(it) }
    assertEquals(1, found.size)
  }
}
