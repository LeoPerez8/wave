package expo.modules.wavenative.yt

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class YtMediaTest {
  @Test
  fun aYtMusicSongIsPlayedByItsTrackId() {
    assertEquals("dQw4w9WgXcQ", YtMedia.videoIdOf("yt:dQw4w9WgXcQ"))
    assertEquals("yt:dQw4w9WgXcQ", YtMedia.uriOf("dQw4w9WgXcQ"))
  }

  @Test
  fun aLibraryFileIsNoYtMusicSong() {
    assertNull(YtMedia.videoIdOf("/storage/emulated/0/Music/yt:song.mp3"))
    assertNull(YtMedia.videoIdOf("file:///storage/emulated/0/Music/song.mp3"))
    assertNull(YtMedia.videoIdOf(""))
  }

  @Test
  fun onlyAVideoIdIsTakenAfterThePrefix() {
    assertNull(YtMedia.videoIdOf("yt:"))
    assertNull(YtMedia.videoIdOf("yt:../../files"))
    assertNull(YtMedia.videoIdOf("yt:abc def"))
  }
}
