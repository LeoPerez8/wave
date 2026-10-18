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

  /** Whether [file] is one of Wave's own part files, as [partFileFor] names them for a job. */
  fun isWavePartFile(file: File): Boolean = file.name.startsWith(".wave-") && file.name.contains(".part.")

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

  /** [target], or the first of "Name (2).m4a", "Name (3).m4a"… that nothing holds. */
  fun freeName(target: File): File {
    if (!target.exists()) return target
    var number = 2
    while (true) {
      val candidate = File(target.parentFile, "${target.nameWithoutExtension} ($number).${target.extension}")
      if (!candidate.exists()) return candidate
      number += 1
    }
  }

  /**
   * Whether [error], writing a download in [folder], is a storage problem: full storage, or a
   * folder Wave can't write to (permission denied, read-only). Anything else (a file the tagger
   * can't handle, a scanner that throws) is not, however it surfaces as an IOException.
   */
  fun storageProblem(error: Throwable, folder: File?): Boolean {
    val chain = generateSequence(error) { it.cause?.takeIf { cause -> cause !== it } }.take(8).toList()
    if (chain.any { it is java.nio.file.AccessDeniedException || it is java.nio.file.ReadOnlyFileSystemException }) return true
    if (chain.any { cause -> STORAGE_ERRORS.any { cause.message?.contains(it, ignoreCase = true) == true } }) return true
    // A write that failed with almost no room left failed for want of it, whatever it said.
    return folder != null && folder.isDirectory && folder.usableSpace < MIN_FREE_BYTES
  }

  /** What Android's and the JVM's file errors say for full storage and an unwritable folder. */
  private val STORAGE_ERRORS = listOf("ENOSPC", "No space left", "EDQUOT", "EROFS", "Read-only file system", "EACCES", "Permission denied")
  /** Less free space than this beside the download means a write failed for want of room. */
  const val MIN_FREE_BYTES = 8L shl 20
}
