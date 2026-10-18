package expo.modules.wavenative.share

import java.io.File
import java.util.Base64

/**
 * The images Wave hands to the gallery and to other apps (the lyrics card),
 * as PNG files in [directory], which [ShareImageProvider] serves. JS draws
 * them and sends them as base64. Each write deletes the images written more
 * than [KEEP_MS] before, which the app they were shared with has had time to
 * read.
 */
class SharedImages(private val directory: File, private val now: () -> Long = System::currentTimeMillis) {
  /** Writes [base64] decoded to [fileName] (its last path part only) and returns the file. */
  fun write(base64: String, fileName: String): File {
    directory.mkdirs()
    val cutoff = now() - KEEP_MS
    directory.listFiles()?.forEach { if (it.lastModified() < cutoff) it.delete() }
    val image = File(directory, File(fileName).name)
    val temp = File.createTempFile(".image-", ".tmp", directory)
    try {
      temp.writeBytes(Base64.getMimeDecoder().decode(base64))
      if (!temp.renameTo(image)) {
        image.delete()
        if (!temp.renameTo(image)) throw IllegalStateException("Couldn't write ${image.name}")
      }
    } finally {
      temp.delete()
    }
    return image
  }

  companion object {
    /** The cache folder the images go in; `res/xml/wave_share_paths.xml` names the same. */
    const val DIRECTORY = "shared-images"

    /** How long an image is kept after it was written. */
    const val KEEP_MS = 10 * 60_000L
  }
}
