package expo.modules.wavenative.lyrics

import java.io.File

/** A track's sidecar `.lrc` file: read for its lyrics, deleted along with the track. */
object Sidecars {
  /**
   * `Song.lrc` beside `Song.mp3`, or `Song.mp3.lrc`; names match ignoring case,
   * as they do on the phone's own storage.
   */
  fun find(audio: File): File? {
    val names = listOf("${audio.nameWithoutExtension}.lrc", "${audio.name}.lrc")
    val folder = audio.parentFile ?: return null
    names.map { File(folder, it) }.firstOrNull { it.isFile }?.let { return it }
    val files = folder.listFiles { file -> file.extension.equals("lrc", ignoreCase = true) } ?: return null
    return names.firstNotNullOfOrNull { name ->
      files.firstOrNull { it.name.equals(name, ignoreCase = true) && it.isFile }
    }
  }

  /** The `.lrc` file names in [folder], lower-cased, for `hasOne`: one listing for a whole folder. */
  fun namesIn(folder: File?): Set<String> =
    folder
      ?.listFiles { file -> file.extension.equals("lrc", ignoreCase = true) && file.isFile }
      ?.mapTo(HashSet()) { it.name.lowercase() }
      ?: emptySet()

  /** Whether [audio] has a sidecar among its folder's [names] (from `namesIn`), as `find` matches them. */
  fun hasOne(audio: File, names: Set<String>): Boolean =
    names.isNotEmpty() &&
      ("${audio.nameWithoutExtension}.lrc".lowercase() in names || "${audio.name}.lrc".lowercase() in names)
}
