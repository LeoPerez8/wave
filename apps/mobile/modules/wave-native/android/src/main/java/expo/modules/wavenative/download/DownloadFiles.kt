package expo.modules.wavenative.download

import java.io.File
import java.io.IOException
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.UUID

/**
 * Where a download lives until it's finished, and how it becomes a Library
 * file: written and tagged as a hidden part file beside its target (scans skip
 * hidden files), then renamed into place in one step, so a scan, a crash or
 * another app never sees half a song.
 */
object DownloadFiles {
  /** `.08 Song.part.m4a` beside `08 Song.m4a`: hidden, on the same storage, still an `.m4a` for the tagger. */
  fun partFileFor(target: File, jobId: String? = null): File =
    File(target.parentFile, if (jobId == null) ".${target.nameWithoutExtension}.part.${target.extension}"
      else ".wave-${UUID.nameUUIDFromBytes(jobId.toByteArray(Charsets.UTF_8))}.part.${target.extension}")

  /**
   * Moves the finished [part] file to [target], creating its folders. A file
   * already there is never replaced: the download gets the first free
   * "Name (2).m4a". Returns where it went.
   */
  fun moveIntoPlace(part: File, target: File): File {
    val folder = target.parentFile ?: throw IOException("No folder for ${target.path}")
    if (!folder.isDirectory && !folder.mkdirs() && !folder.isDirectory) {
      throw IOException("Couldn't create ${folder.path}")
    }
    val destination = freeName(target)
    try {
      Files.move(part.toPath(), destination.toPath(), StandardCopyOption.ATOMIC_MOVE)
    } catch (e: AtomicMoveNotSupportedException) {
      Files.move(part.toPath(), destination.toPath())
    }
    return destination
  }

  private fun freeName(target: File): File {
    if (!target.exists()) return target
    var number = 2
    while (true) {
      val candidate = File(target.parentFile, "${target.nameWithoutExtension} ($number).${target.extension}")
      if (!candidate.exists()) return candidate
      number += 1
    }
  }
}
