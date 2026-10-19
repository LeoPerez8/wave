package expo.modules.wavenative.player

import androidx.media3.common.Player
import org.junit.Assert.assertEquals
import org.junit.Test

class CrossfadeCausesTest {
  @Test
  fun aSongEndingOnItsOwnIsTheSongEndingWhateverWasNoted() {
    val causes = CrossfadeCauses()
    causes.noteApp("next", nowMs = 10_000)
    assertEquals("the song ending", causes.move(Player.MEDIA_ITEM_TRANSITION_REASON_AUTO, nowMs = 10_010).says)
    assertEquals("repeat one", causes.move(Player.MEDIA_ITEM_TRANSITION_REASON_REPEAT, nowMs = 10_020).says)
    // The note waits for the app's own move.
    assertEquals("Next", causes.move(Player.MEDIA_ITEM_TRANSITION_REASON_SEEK, nowMs = 10_030).says)
  }

  @Test
  fun theAppsMovesAndSeeksSayWhatTheOwnerDid() {
    val causes = CrossfadeCauses()
    val said = listOf("next", "previous", "queueTap", "play", "player", "undo", "queue").map { id ->
      causes.noteApp(id, nowMs = 0)
      causes.move(Player.MEDIA_ITEM_TRANSITION_REASON_SEEK, nowMs = 10).says
    }
    assertEquals(
      listOf("Next", "Previous", "a tap in the queue", "playing a new queue", "the queue following the player", "Undo", "a queue change"),
      said,
    )
    val sources = listOf("scrubber", "lyric", "previousRestart").map { id ->
      causes.noteApp(id, nowMs = 0)
      causes.seek(nowMs = 10).says
    }
    assertEquals(listOf("the scrubber", "a lyric tap", "Previous restarting the song"), sources)
  }

  @Test
  fun aNewQueueSetOnThePlayerTakesTheNoteToo() {
    val causes = CrossfadeCauses()
    causes.noteApp("play", nowMs = 0)
    assertEquals("playing a new queue", causes.move(Player.MEDIA_ITEM_TRANSITION_REASON_PLAYLIST_CHANGED, nowMs = 10).says)
    assertEquals(
      "a change to the player's list",
      causes.move(Player.MEDIA_ITEM_TRANSITION_REASON_PLAYLIST_CHANGED, nowMs = 20).says,
    )
  }

  @Test
  fun aNoteNamesOneChangeOnlyAndIsForgottenSoon() {
    val causes = CrossfadeCauses()
    causes.noteApp("next", nowMs = 0)
    causes.move(Player.MEDIA_ITEM_TRANSITION_REASON_SEEK, nowMs = 10)
    assertEquals("an unnamed move", causes.move(Player.MEDIA_ITEM_TRANSITION_REASON_SEEK, nowMs = 20).says)
    causes.noteApp("scrubber", nowMs = 0)
    assertEquals("an unnamed seek", causes.seek(nowMs = 30_000).says)
  }

  @Test
  fun aSessionCommandNamesItsController() {
    val causes = CrossfadeCauses()
    causes.noteSession("Android Auto", nowMs = 0)
    assertEquals("a session command from Android Auto", causes.move(Player.MEDIA_ITEM_TRANSITION_REASON_SEEK, nowMs = 10).says)
    causes.noteSession("com.android.systemui", nowMs = 0)
    assertEquals("a session command from com.android.systemui", causes.seek(nowMs = 10).says)
  }

  @Test
  fun aMediaButtonStaysOneThroughTheCommandItBecomes() {
    // A headset or notification button: the session turns it into a player command.
    val causes = CrossfadeCauses()
    causes.noteMediaButton("the notification", nowMs = 0)
    causes.noteSession("the notification", nowMs = 5)
    assertEquals("a media button from the notification", causes.move(Player.MEDIA_ITEM_TRANSITION_REASON_SEEK, nowMs = 10).says)
  }

  @Test
  fun anUnknownAppCauseIsStillNamed() {
    val causes = CrossfadeCauses()
    causes.noteApp("somethingNew", nowMs = 0)
    assertEquals("the app (somethingNew)", causes.seek(nowMs = 10).says)
  }
}
