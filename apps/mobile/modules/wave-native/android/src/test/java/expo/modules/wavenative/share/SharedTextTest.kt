package expo.modules.wavenative.share

import android.content.Intent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** What reaches Wave's shared-text inbox: a share of text, or a tapped web link. */
class SharedTextTest {
  private fun share(text: String?, type: String? = "text/plain", fromHistory: Boolean = false) =
    SharedText.of(Intent.ACTION_SEND, type, fromHistory, text, link = null)

  private fun tap(link: String?, fromHistory: Boolean = false) =
    SharedText.of(Intent.ACTION_VIEW, type = null, fromHistory, text = null, link)

  @Test
  fun aSharedTextArrives() {
    assertEquals("Look https://music.youtube.com/watch?v=x", share("Look https://music.youtube.com/watch?v=x"))
  }

  @Test
  fun aShareOfAnythingButTextIsIgnored() {
    assertNull(share("photo", type = "image/png"))
    assertNull(share("   "))
    assertNull(share(null))
  }

  @Test
  fun aTappedSongLinkArrivesAsItsAddress() {
    assertEquals("https://music.youtube.com/watch?v=dQw4w9WgXcQ", tap("https://music.youtube.com/watch?v=dQw4w9WgXcQ"))
    assertEquals("http://open.spotify.com/track/abc", tap("http://open.spotify.com/track/abc"))
  }

  @Test
  fun aWaveDeepLinkStaysWithTheRouter() {
    assertNull(tap("wave://settings/library"))
    assertNull(tap(null))
  }

  @Test
  fun anIntentAndroidReplaysFromRecentsWasAlreadyHandled() {
    assertNull(share("https://music.youtube.com/watch?v=x", fromHistory = true))
    assertNull(tap("https://music.youtube.com/watch?v=x", fromHistory = true))
  }

  @Test
  fun anyOtherActionIsIgnored() {
    assertNull(SharedText.of(Intent.ACTION_MAIN, null, false, "text", "https://music.youtube.com/"))
  }
}
