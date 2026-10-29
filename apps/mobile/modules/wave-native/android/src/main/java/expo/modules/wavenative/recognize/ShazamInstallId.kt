package expo.modules.wavenative.recognize

import java.io.File
import java.util.Locale
import java.util.UUID

/**
 * The random id this install sends Shazam with every request, made on first use and
 * kept in [file]. It names no person or account: a reinstall gets a new one.
 */
class ShazamInstallId(private val file: File) {
  @Synchronized
  fun get(): String {
    val saved = runCatching { file.readText().trim() }.getOrNull()
    if (saved != null && UUID_TEXT.matches(saved)) return saved
    val id = UUID.randomUUID().toString().uppercase(Locale.ROOT)
    file.parentFile?.mkdirs()
    val temporary = File(file.path + ".tmp")
    temporary.writeText(id)
    if (!temporary.renameTo(file)) {
      file.delete()
      temporary.renameTo(file)
    }
    return id
  }

  private companion object {
    val UUID_TEXT = Regex("[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}")
  }
}
