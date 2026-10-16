package expo.modules.wavenative.player

import androidx.media3.common.C
import androidx.media3.common.Player
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayerEventsTest {
  @Test
  fun namesPlaybackStates() {
    assertEquals("idle", PlayerEvents.status(Player.STATE_IDLE))
    assertEquals("buffering", PlayerEvents.status(Player.STATE_BUFFERING))
    assertEquals("ready", PlayerEvents.status(Player.STATE_READY))
    assertEquals("ended", PlayerEvents.status(Player.STATE_ENDED))
  }

  @Test
  fun namesTransitionReasons() {
    assertEquals("auto", PlayerEvents.transitionReason(Player.MEDIA_ITEM_TRANSITION_REASON_AUTO))
    assertEquals("repeat", PlayerEvents.transitionReason(Player.MEDIA_ITEM_TRANSITION_REASON_REPEAT))
    assertEquals("seek", PlayerEvents.transitionReason(Player.MEDIA_ITEM_TRANSITION_REASON_SEEK))
    assertEquals(
      "playlist",
      PlayerEvents.transitionReason(Player.MEDIA_ITEM_TRANSITION_REASON_PLAYLIST_CHANGED),
    )
  }

  @Test
  fun transitionsCausedBySyncingTheQueueAreNamedSync() {
    assertEquals(
      "sync",
      PlayerEvents.transitionReason(Player.MEDIA_ITEM_TRANSITION_REASON_SEEK, duringSync = true),
    )
    assertEquals(
      "seek",
      PlayerEvents.transitionReason(Player.MEDIA_ITEM_TRANSITION_REASON_SEEK, duringSync = false),
    )
  }

  @Test
  fun theMoveAsACrossfadeStartsIsNamedCrossfade() {
    assertEquals(
      "crossfade",
      PlayerEvents.transitionReason(Player.MEDIA_ITEM_TRANSITION_REASON_SEEK, crossfade = true),
    )
    // Anything else moving the player at that moment is what it is.
    assertEquals(
      "auto",
      PlayerEvents.transitionReason(Player.MEDIA_ITEM_TRANSITION_REASON_AUTO, crossfade = true),
    )
  }

  @Test
  fun seeksWithinTheCurrentItemAreReportedAsSeeks() {
    // "Previous" after three seconds, from the notification or a headset, seeks to 0 in place.
    assertTrue(PlayerEvents.isSeekWithinItem(Player.DISCONTINUITY_REASON_SEEK, "k1", "k1"))
    // Going to another item is a transition, not a seek.
    assertFalse(PlayerEvents.isSeekWithinItem(Player.DISCONTINUITY_REASON_SEEK, "k1", "k2"))
    assertFalse(PlayerEvents.isSeekWithinItem(Player.DISCONTINUITY_REASON_SEEK, null, null))
    // Auto-advance and repeat-one jumps aren't seeks.
    assertFalse(PlayerEvents.isSeekWithinItem(Player.DISCONTINUITY_REASON_AUTO_TRANSITION, "k1", "k1"))
  }

  @Test
  fun mapsRepeatModes() {
    assertEquals(Player.REPEAT_MODE_OFF, PlayerEvents.repeatMode("off"))
    assertEquals(Player.REPEAT_MODE_ALL, PlayerEvents.repeatMode("all"))
    assertEquals(Player.REPEAT_MODE_ONE, PlayerEvents.repeatMode("one"))
    assertEquals(Player.REPEAT_MODE_OFF, PlayerEvents.repeatMode("sometimes"))
  }

  @Test
  fun unknownDurationIsNull() {
    assertNull(PlayerEvents.duration(C.TIME_UNSET))
    assertEquals(183_000.0, PlayerEvents.duration(183_000)!!, 0.0)
  }
}
