package expo.modules.wavenative.folders

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TreeUrisTest {
  private val volumes = mapOf(
    "primary" to File("/storage/emulated/0"),
    "1A2B-3C4D" to File("/storage/1A2B-3C4D"),
  )

  private fun path(documentId: String?, authority: String = TreeUris.EXTERNAL_STORAGE_AUTHORITY) =
    TreeUris.toPath(authority, documentId) { volumes[it] }

  @Test
  fun folderOnInternalStorage() {
    assertEquals("/storage/emulated/0/Músicas", path("primary:Músicas"))
    assertEquals("/storage/emulated/0/Music/Rock", path("primary:Music/Rock"))
  }

  @Test
  fun internalStorageRoot() {
    assertEquals("/storage/emulated/0", path("primary:"))
  }

  @Test
  fun folderOnSdCard() {
    assertEquals("/storage/1A2B-3C4D/Music", path("1A2B-3C4D:Music"))
  }

  @Test
  fun documentsShortcut() {
    assertEquals("/storage/emulated/0/Documents/Songs", path("home:Songs"))
    assertEquals("/storage/emulated/0/Documents", path("home:"))
  }

  @Test
  fun otherProvidersAndUnknownVolumesHaveNoPath() {
    assertNull(path("downloads", authority = "com.android.providers.downloads.documents"))
    assertNull(path("FFFF-0000:Music"))
    assertNull(path("no-separator"))
    assertNull(path(null))
  }
}
