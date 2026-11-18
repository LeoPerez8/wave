package expo.modules.wavenative.files

import java.io.InputStream
import java.security.MessageDigest

/**
 * A file's SHA-256 as the download journal keeps it (lowercase hex): what tells a published file
 * is still the download's. Taken as the bytes are written where Wave writes them (#455).
 */
object FileDigest {
  fun sha256(): MessageDigest = MessageDigest.getInstance("SHA-256")

  fun hex(digest: MessageDigest): String = digest.digest().joinToString("") { "%02x".format(it) }

  /** The digest of what [input] holds to its end, each chunk also handed to [each] (a copy's write). */
  fun of(input: InputStream, each: (ByteArray, Int) -> Unit = { _, _ -> }): String {
    val sha = sha256()
    val buffer = ByteArray(64 * 1024)
    while (true) {
      val count = input.read(buffer)
      if (count < 0) break
      sha.update(buffer, 0, count)
      each(buffer, count)
    }
    return hex(sha)
  }
}
