package expo.modules.wavenative.files

import expo.modules.wavenative.lyrics.Sidecars
import java.io.File
import java.io.IOException
import java.nio.file.AccessDeniedException
import java.nio.file.Files
import java.nio.file.NoSuchFileException

/** What became of a file Wave was asked to delete; `id` is what JS gets. */
enum class DeleteOutcome(val id: String) {
  DELETED("deleted"),
  /** It was already gone. */
  MISSING("missing"),
  /** Wave may not delete it (no all-files access, or the folder refuses it). */
  DENIED("denied"),
  /** Its storage is mounted read-only. */
  READ_ONLY("readOnly"),
  FAILED("failed"),
}

/**
 * Deletes a song's audio file and, once it is gone, its sidecar `.lrc` (see
 * [Sidecars]). A file that can't be deleted keeps its sidecar.
 * [isReadOnly] tells whether a file's storage is mounted read-only.
 */
class TrackFileDeleter(private val isReadOnly: (File) -> Boolean = { false }) {
  fun delete(audio: File): DeleteOutcome {
    if (!audio.isFile) return DeleteOutcome.MISSING
    if (isReadOnly(audio)) return DeleteOutcome.READ_ONLY
    try {
      Files.delete(audio.toPath())
    } catch (e: NoSuchFileException) {
      return DeleteOutcome.MISSING
    } catch (e: AccessDeniedException) {
      return DeleteOutcome.DENIED
    } catch (e: SecurityException) {
      return DeleteOutcome.DENIED
    } catch (e: IOException) {
      return DeleteOutcome.FAILED
    }
    // The song is gone either way; a sidecar left behind is only a stray text file.
    Sidecars.find(audio)?.let { runCatching { it.delete() } }
    return DeleteOutcome.DELETED
  }
}
