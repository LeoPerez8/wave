package expo.modules.wavenative

import java.io.File
import java.nio.file.Files

/** Test fixtures from `src/test/resources/fixtures` (see `src/test/fixtures-src/generate.sh`). */
object Fixtures {
  fun file(name: String): File {
    val url = javaClass.getResource("/fixtures/$name") ?: error("Missing fixture $name")
    return File(url.toURI())
  }

  /** The teal 32×32 PNG embedded in most tagged fixtures. */
  fun cover(): ByteArray {
    val url = javaClass.getResource("/fixtures/cover.png") ?: error("Missing cover.png")
    return File(url.toURI()).readBytes()
  }

  fun tempDir(): File = Files.createTempDirectory("wave-test").toFile().apply { deleteOnExit() }

  /** Copies fixtures into a fresh folder, under the given relative paths. */
  fun libraryOf(vararg entries: Pair<String, String>): File {
    val root = tempDir()
    for ((fixture, target) in entries) {
      val destination = File(root, target)
      destination.parentFile.mkdirs()
      file(fixture).copyTo(destination)
    }
    return root
  }
}
