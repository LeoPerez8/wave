package expo.modules.wavenative.playlists

import expo.modules.wavenative.folders.TreeUris
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PlaylistFilesTest {
  private val volumes = mapOf("primary" to File("/storage/emulated/0"))

  private fun path(documentId: String?, authority: String = TreeUris.EXTERNAL_STORAGE_AUTHORITY) =
    PlaylistFiles.documentPath(authority, documentId) { volumes[it] }

  @Test
  fun utf8TextIsReadAsIs() {
    assertEquals("#EXTM3U\nCafé.mp3", PlaylistFiles.decodeText("#EXTM3U\nCafé.mp3".toByteArray()))
  }

  @Test
  fun aByteOrderMarkIsDropped() {
    val bytes = byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte()) + "Airbag.mp3".toByteArray()
    assertEquals("Airbag.mp3", PlaylistFiles.decodeText(bytes))
  }

  @Test
  fun bytesThatArentUtf8AreReadAsTheWindowsCodePage() {
    val bytes = "Café.mp3".toByteArray(charset("windows-1252"))
    assertEquals("Café.mp3", PlaylistFiles.decodeText(bytes))
  }

  @Test
  fun aFileOverTheLimitIsNotRead() {
    assertEquals("Airbag.mp3", PlaylistFiles.readText("Airbag.mp3".byteInputStream(), maxBytes = 10))
    assertNull(PlaylistFiles.readText("Airbag.flac".byteInputStream(), maxBytes = 10))
  }

  @Test
  fun aFileOnStorageHasItsPath() {
    assertEquals("/storage/emulated/0/Playlists/Drive.m3u", path("primary:Playlists/Drive.m3u"))
  }

  @Test
  fun aRawDownloadHasItsPath() {
    assertEquals(
      "/storage/emulated/0/Download/Drive.m3u",
      path("raw:/storage/emulated/0/Download/Drive.m3u", authority = PlaylistFiles.DOWNLOADS_AUTHORITY),
    )
  }

  @Test
  fun otherDocumentsHaveNoPath() {
    assertNull(path("msf:1234", authority = PlaylistFiles.DOWNLOADS_AUTHORITY))
    assertNull(path("doc-id", authority = "com.google.android.apps.docs.storage"))
    assertNull(path(null))
  }

  @Test
  fun aMediaStoreDownloadHasItsId() {
    assertEquals(1234L, PlaylistFiles.mediaStoreId(PlaylistFiles.DOWNLOADS_AUTHORITY, "msf:1234"))
    assertNull(PlaylistFiles.mediaStoreId(PlaylistFiles.DOWNLOADS_AUTHORITY, "raw:/x.m3u"))
    assertNull(PlaylistFiles.mediaStoreId(TreeUris.EXTERNAL_STORAGE_AUTHORITY, "msf:1234"))
  }
}
