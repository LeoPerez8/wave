package expo.modules.wavenative.player

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RuntimeOwnersTest {
  @Test fun runtimeOwnersDoNotReleaseEachOther() {
    val owners = RuntimeOwners()
    owners.acquire("auto"); owners.acquire("downloads"); owners.release("auto")
    assertTrue(owners.isWanted())
    owners.acquire("auto"); owners.release("downloads")
    assertTrue(owners.isWanted())
    owners.release("auto"); assertFalse(owners.isWanted())
  }

  @Test fun playbackHoldsTheRuntimeBesideDownloadsAutoAndRecognize() {
    val others = listOf("auto", "downloads", "recognize", "recognizeFavorite", "resume")
    assertFalse(PlaybackRuntimeHold.OWNER in others)
    val owners = RuntimeOwners()
    owners.acquire(PlaybackRuntimeHold.OWNER)
    others.forEach(owners::acquire)
    // Playback letting go leaves every other owner's hold.
    owners.release(PlaybackRuntimeHold.OWNER)
    assertTrue(owners.isWanted())
    // And each other owner letting go leaves playback's.
    owners.acquire(PlaybackRuntimeHold.OWNER)
    others.forEach(owners::release)
    assertTrue(owners.isWanted())
    owners.release(PlaybackRuntimeHold.OWNER)
    assertFalse(owners.isWanted())
  }
}
