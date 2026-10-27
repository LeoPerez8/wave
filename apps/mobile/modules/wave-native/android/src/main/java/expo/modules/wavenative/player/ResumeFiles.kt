package expo.modules.wavenative.player

import java.io.File

/**
 * The [ResumeSnapshot]'s files in [dir]: the items part, rewritten only when
 * the items or JS's queue change, and the small place part, rewritten on every
 * save. Each is replaced whole (written aside, then renamed), items first, so
 * a kill between the two leaves a place that is at worst one save old. The
 * one-file snapshot earlier versions wrote is read until the split files
 * replace it. Not thread-safe: [ResumeStore] calls it from its one thread.
 */
class ResumeFiles(private val dir: File) {
  private val items = File(dir, "resume-items.txt")
  private val place = File(dir, "resume-place.txt")
  private val legacy = File(dir, "resume-snapshot.txt")

  // The first save of a process writes the items too: the files may be from an earlier version.
  private var itemsWritten = false

  /** Writes the place part, and the items part when [withItems] (or not yet this process). */
  fun write(snapshot: ResumeSnapshot, withItems: Boolean) {
    if (withItems || !itemsWritten) {
      replace(items, snapshot.encodeItems())
      itemsWritten = true
    }
    replace(place, snapshot.encodePlace())
    if (legacy.exists()) legacy.delete()
  }

  /** The last snapshot written, from the split files or else an earlier version's one file. */
  fun read(): ResumeSnapshot? {
    if (items.exists() && place.exists()) {
      ResumeSnapshot.decode(items.readText(), place.readText())?.let { return it }
    }
    return if (legacy.exists()) ResumeSnapshot.decode(legacy.readText()) else null
  }

  private fun replace(target: File, text: String) {
    val temp = File(dir, "${target.name}.tmp")
    temp.writeText(text)
    if (!temp.renameTo(target)) error("Couldn't replace $target")
  }
}
