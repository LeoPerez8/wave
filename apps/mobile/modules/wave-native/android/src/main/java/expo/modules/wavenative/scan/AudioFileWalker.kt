package expo.modules.wavenative.scan

import java.io.File
import java.io.IOException

/** File extensions Wave indexes. */
object AudioFormats {
  val EXTENSIONS = setOf("mp3", "flac", "m4a", "aac", "ogg", "oga", "opus", "wav")

  fun isAudio(file: File): Boolean = file.extension.lowercase() in EXTENSIONS
}

/**
 * Walks the scan roots minus the excluded folders and reports every audio file
 * once. Hidden files and folders (dot-prefixed) are skipped, symlink loops and
 * overlapping roots are visited only once, and unreadable folders are ignored.
 */
class AudioFileWalker(roots: List<File>, excluded: List<File>) {
  private val roots = roots.map(::canonical)
  private val excluded = excluded.map { canonical(it).path }

  fun walk(isCancelled: () -> Boolean = { false }, onFile: (File) -> Unit) {
    val visitedFolders = HashSet<String>()
    val seenFiles = HashSet<String>()
    val stack = ArrayDeque<File>()
    // Reverse so the first root is walked first.
    roots.asReversed().forEach(stack::addLast)
    while (stack.isNotEmpty()) {
      if (isCancelled()) return
      val folder = stack.removeLast()
      val path = folder.path
      if (isExcluded(path) || !visitedFolders.add(path)) continue
      val children = folder.listFiles() ?: continue
      // Sorted so scans are deterministic: same order of batches for the same tree.
      children.sortBy { it.name }
      val subfolders = ArrayList<File>()
      for (child in children) {
        if (child.name.startsWith(".")) continue
        if (child.isDirectory) {
          subfolders.add(canonical(child))
        } else if (child.isFile && AudioFormats.isAudio(child)) {
          val file = canonical(child)
          if (seenFiles.add(file.path)) onFile(file)
        }
      }
      subfolders.asReversed().forEach(stack::addLast)
    }
  }

  private fun isExcluded(path: String): Boolean =
    excluded.any { path == it || path.startsWith("$it/") }

  private fun canonical(file: File): File =
    try {
      file.canonicalFile
    } catch (e: IOException) {
      file.absoluteFile
    }
}
