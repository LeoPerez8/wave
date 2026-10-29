package expo.modules.wavenative.recognize

import java.io.File
import java.util.Locale
import java.util.UUID

/**
 * The random id this install sends Shazam with every request, made on first use and
 * kept in [file]. It names no person or account: a reinstall gets a new one. Once
 * read or made it stays in memory, and an id that can't be saved (a full disk) is
 * still sent for the rest of the run, so storage never fails a recognition.
 */
class ShazamInstallId(private val file: File) {
  private var id: String? = null

  @Synchronized
  fun get(): String = id ?: (read() ?: make()).also { id = it }

  private fun read(): String? =
    runCatching { file.readText().trim() }.getOrNull()?.takeIf { UUID_TEXT.matches(it) }

  private fun make(): String {
    val id = UUID.randomUUID().toString().uppercase(Locale.ROOT)
    runCatching {
      file.parentFile?.mkdirs()
      val temporary = File(file.path + ".tmp")
      temporary.writeText(id)
      if (!temporary.renameTo(file)) {
        file.delete()
        temporary.renameTo(file)
      }
    }
    return id
  }

  private companion object {
    val UUID_TEXT = Regex("[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}")
  }
}
