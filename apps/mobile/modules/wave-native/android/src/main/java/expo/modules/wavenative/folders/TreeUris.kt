package expo.modules.wavenative.folders

import java.io.File

/**
 * Maps a folder picked with the system picker (`ACTION_OPEN_DOCUMENT_TREE`) to
 * the absolute path the scanner walks. Wave holds all-files access, so the
 * path is readable directly; only the external-storage provider has paths.
 */
object TreeUris {
  const val EXTERNAL_STORAGE_AUTHORITY = "com.android.externalstorage.documents"

  /**
   * [treeDocumentId] is `<volume>:<path>`: `primary:Music/Rock`, `1A2B-3C4D:Music`,
   * or `home:Sub` for the Documents folder. [volumeDirectory] resolves a volume
   * id (`primary` or a storage UUID) to its root. Returns null for other
   * providers (Downloads, Drive, …) and unknown volumes.
   */
  fun toPath(
    authority: String?,
    treeDocumentId: String?,
    volumeDirectory: (String) -> File?,
  ): String? {
    if (authority != EXTERNAL_STORAGE_AUTHORITY || treeDocumentId == null) return null
    val separator = treeDocumentId.indexOf(':')
    if (separator < 0) return null
    val volume = treeDocumentId.substring(0, separator)
    var relative = treeDocumentId.substring(separator + 1).trim('/')
    val root = if (volume == "home") {
      relative = if (relative.isEmpty()) "Documents" else "Documents/$relative"
      volumeDirectory("primary")
    } else {
      volumeDirectory(volume)
    } ?: return null
    return if (relative.isEmpty()) root.path else File(root, relative).path
  }
}
