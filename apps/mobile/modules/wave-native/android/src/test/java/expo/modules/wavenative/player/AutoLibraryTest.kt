package expo.modules.wavenative.player

import androidx.media3.session.LibraryResult
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.TimeUnit

class AutoLibraryTest {
  @Test
  fun `the root is answered at once, without JS`() {
    assertFalse("JS isn't running", AutoLibrary.bridge.attached)

    val root = AutoLibrary.root(null)

    assertTrue("Auto's first call never waits on JS", root.isDone)
    val result = root.get()
    assertEquals(LibraryResult.RESULT_SUCCESS, result.resultCode)
    val item = result.value!!
    // Core's AUTO_ROOT (packages/core/src/auto.ts).
    assertEquals("root", item.mediaId)
    assertEquals("Wave", item.mediaMetadata.title)
    assertEquals(true, item.mediaMetadata.isBrowsable)
    assertEquals(false, item.mediaMetadata.isPlayable)
  }

  @Test
  fun `a request times out with no main looper running`() {
    // Unit tests have no main looper: the timeout must not need one, since
    // Media3 can block the main thread while Auto connects.
    val reply = AutoLibrary.bridge.request("children", "{}", timeoutMs = 50)

    assertEquals(AutoReply.Failed(AutoBridge.STILL_LOADING), reply.get(5, TimeUnit.SECONDS))
  }
}
