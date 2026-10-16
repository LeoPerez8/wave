package expo.modules.wavenative.log

import android.content.Context
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile

/**
 * Wave's app log (#326): one UTF-8 text file in the app's private storage,
 * `files/logs/wave.log`, that JS and native code both append to.
 *
 * Each entry is Core's `formatLogEntry` (packages/core/src/appLog.ts):
 * `<ISO-8601 UTC time with ms> <I|W|E|F> <tag>: <message>\n`, a message of
 * several lines (a stack) going on the lines after, each indented by two spaces,
 * so only an entry's first line starts with a time. Native code writing here must
 * keep that shape and leave out secrets (Core's `redactSecrets`).
 *
 * Every access holds one lock, so an append from any thread never interleaves
 * with another or with a trim. Only JS trims (Core's `trimLog` decides how many
 * bytes go from the start), so the file may run past its cap until JS next writes.
 */
class AppLogFile(val file: File) {
  /** Appends [text] and returns the file's size in bytes. */
  fun append(text: String): Long = synchronized(LOCK) {
    file.parentFile?.mkdirs()
    FileOutputStream(file, true).use { it.write(text.toByteArray(Charsets.UTF_8)) }
    file.length()
  }

  /** The whole log; empty when nothing was written yet. */
  fun read(): String = synchronized(LOCK) { if (file.exists()) file.readText(Charsets.UTF_8) else "" }

  /** Removes the first [bytes] bytes, the oldest entries; what was appended after them stays. */
  fun dropHead(bytes: Long) = synchronized(LOCK) {
    if (bytes <= 0 || !file.exists()) return@synchronized
    val size = file.length()
    if (bytes >= size) {
      file.writeBytes(ByteArray(0))
      return@synchronized
    }
    val rest = File(file.parentFile, "${file.name}.trim")
    RandomAccessFile(file, "r").use { source ->
      source.seek(bytes)
      FileOutputStream(rest).use { out ->
        val buffer = ByteArray(64 * 1024)
        while (true) {
          val read = source.read(buffer)
          if (read < 0) break
          out.write(buffer, 0, read)
        }
      }
    }
    if (!rest.renameTo(file)) {
      rest.copyTo(file, overwrite = true)
      rest.delete()
    }
  }

  /** Writes [header] then the log to [destination], replacing it. */
  fun exportTo(destination: File, header: String) = synchronized(LOCK) {
    destination.parentFile?.mkdirs()
    FileOutputStream(destination).use { out ->
      out.write(header.toByteArray(Charsets.UTF_8))
      if (file.exists()) file.inputStream().use { it.copyTo(out) }
    }
  }

  companion object {
    /** One lock for every [AppLogFile], whichever instance or thread writes. */
    private val LOCK = Any()

    const val DIRECTORY = "logs"
    const val FILE_NAME = "wave.log"

    /** Wave's log, in [context]'s private files. */
    fun of(context: Context) = AppLogFile(File(File(context.filesDir, DIRECTORY), FILE_NAME))
  }
}
