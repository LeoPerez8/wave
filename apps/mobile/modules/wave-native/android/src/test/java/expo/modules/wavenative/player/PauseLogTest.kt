package expo.modules.wavenative.player

import androidx.media3.common.C
import androidx.media3.common.Player
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PauseLogTest {
  private val file = PauseLog.Song(streamed = false, positionMs = 83_400, durationMs = 244_000)
  private val stream = PauseLog.Song(streamed = true, positionMs = 40_000, durationMs = C.TIME_UNSET)

  @Test
  fun aPauseSaysWhyAndWhatWasPlaying() {
    assertEquals(
      "Paused by the notification; a Library file at 1:23 of 4:04",
      PauseLog.pausedLine(Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST, "the notification", file),
    )
    assertEquals(
      "Paused: another app took the audio; a streamed song at 0:40",
      PauseLog.pausedLine(Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_FOCUS_LOSS, null, stream),
    )
    assertEquals(
      "Paused: the audio output went away (headphones unplugged or Bluetooth disconnected); a Library file at 1:23 of 4:04",
      PauseLog.pausedLine(Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_BECOMING_NOISY, null, file),
    )
    assertEquals(
      "Paused by an unnamed command",
      PauseLog.pausedLine(Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST, null, null),
    )
    assertEquals(
      "Paused at the song's end, for the sleep timer",
      PauseLog.pausedLine(Player.PLAY_WHEN_READY_CHANGE_REASON_END_OF_MEDIA_ITEM, null, null),
    )
  }

  @Test
  fun playingAgainSaysHowLongThePauseLastedAndWho() {
    assertEquals(
      "Playing again after 4 min 12 s, by com.samsung.android.watch",
      PauseLog.playedLine(Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST, "com.samsung.android.watch", 252_000),
    )
    assertEquals("Playing again after 45 s, by an unnamed command", PauseLog.playedLine(1, null, 45_900))
    assertEquals("1 h 3 min", PauseLog.duration(3_780_000))
  }

  @Test
  fun aHoldAndItsEnd() {
    assertEquals(
      "Held: another app has the audio for a moment; a streamed song at 0:40",
      PauseLog.heldLine(Player.PLAYBACK_SUPPRESSION_REASON_TRANSIENT_AUDIO_FOCUS_LOSS, stream),
    )
    assertEquals("No longer held, after 8 s", PauseLog.releasedLine(8_200))
    assertTrue(PauseLog.logsHold(Player.PLAYBACK_SUPPRESSION_REASON_TRANSIENT_AUDIO_FOCUS_LOSS))
    assertFalse(PauseLog.logsHold(Player.PLAYBACK_SUPPRESSION_REASON_SCRUBBING))
    assertFalse(PauseLog.logsHold(Player.PLAYBACK_SUPPRESSION_REASON_NONE))
  }

  @Test
  fun theListRunningOut() {
    assertEquals(
      "Ended: the player's list ran out; a Library file at 4:04 of 4:04",
      PauseLog.endedLine(file.copy(positionMs = 244_000)),
    )
  }

  @Test
  fun aNoteNamesTheNextPlayOrPauseOnlyAndOnlyForAMoment() {
    val causes = PauseCauses()
    causes.note("Wave", nowMs = 1_000)
    assertEquals("Wave", causes.take(nowMs = 1_100))
    // Spent: the next pause nobody asked for isn't Wave's.
    assertNull(causes.take(nowMs = 1_200))
    causes.note("the sleep timer", nowMs = 2_000)
    assertNull(causes.take(nowMs = 4_500))
  }

  @Test
  fun aMediaButtonStaysTheButtonWhenItsCommandFollows() {
    val causes = PauseCauses()
    causes.note("a media button from com.android.bluetooth", nowMs = 1_000)
    causes.noteUnlessFresh("com.android.bluetooth", nowMs = 1_050)
    assertEquals("a media button from com.android.bluetooth", causes.take(nowMs = 1_100))
    // A command with no fresh note before it names its controller.
    causes.noteUnlessFresh("the notification", nowMs = 5_000)
    assertEquals("the notification", causes.take(nowMs = 5_050))
  }
}
