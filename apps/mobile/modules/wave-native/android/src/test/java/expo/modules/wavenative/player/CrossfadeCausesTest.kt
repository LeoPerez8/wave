package expo.modules.wavenative.player

import androidx.media3.common.Player
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CrossfadeCausesTest {
  @Test
  fun aSongEndingOnItsOwnIsTheSongEndingWhateverWasNoted() {
    val causes = CrossfadeCauses()
    causes.noteApp("queue", nowMs = 10_000)
    assertEquals("the song ending", causes.move(Player.MEDIA_ITEM_TRANSITION_REASON_AUTO, nowMs = 10_010).phrase)
    // The note is spent: a move or seek nobody named after it isn't pinned on it.
    assertEquals("an unnamed seek", causes.seek(nowMs = 10_020).phrase)
    causes.noteApp("queue", nowMs = 10_030)
    assertEquals("repeat one", causes.move(Player.MEDIA_ITEM_TRANSITION_REASON_REPEAT, nowMs = 10_040).phrase)
    assertEquals("an unnamed move", causes.move(Player.MEDIA_ITEM_TRANSITION_REASON_SEEK, nowMs = 10_050).phrase)
  }

  @Test
  fun theAppsMovesAndSeeksSayWhatTheOwnerDid() {
    val causes = CrossfadeCauses()
    val said = listOf("next", "previous", "queueTap", "play", "player", "trackEnded", "search", "undo", "restore", "queue")
      .map { id ->
        causes.noteApp(id, nowMs = 0)
        causes.move(Player.MEDIA_ITEM_TRANSITION_REASON_SEEK, nowMs = 10).phrase
      }
    assertEquals(
      listOf(
        "Next",
        "Previous",
        "a tap in the queue",
        "playing a new queue",
        "the queue following the player",
        "the queue running out",
        "a search answer",
        "Undo",
        "the queue restored",
        "a queue change",
      ),
      said,
    )
    val sources = listOf("scrubber", "lyric", "previousRestart", "undo", "restore", "queueEnd").map { id ->
      causes.noteApp(id, nowMs = 0)
      causes.seek(nowMs = 10).phrase
    }
    assertEquals(
      listOf("the scrubber", "a lyric tap", "Previous restarting the song", "Undo", "the queue restored", "the queue ending"),
      sources,
    )
  }

  @Test
  fun everyIdCoreSendsHasAPhrase() {
    // Core's unions, read from its source, so a new cause can't reach the log as "the app (id)".
    val core = generateSequence(File("").canonicalFile) { it.parentFile }
      .map { File(it, "packages/core/src/songChangeCause.ts") }
      .first { it.isFile }
      .readText()
      .replace(Regex("/\\*.*?\\*/", RegexOption.DOT_MATCHES_ALL), "")
    fun ids(type: String): Set<String> {
      val union = Regex("export type $type =([^;]*);").find(core)?.groupValues?.get(1) ?: error("No $type in Core")
      return Regex("\"(\\w+)\"").findAll(union).map { it.groupValues[1] }.toSet()
    }
    val sent = ids("SongChangeCause") + ids("SeekSource")
    assertTrue(sent.containsAll(listOf("next", "scrubber", "queueEnd")))
    assertEquals(sent, CrossfadeCause.APP_PHRASES.keys)
  }

  @Test
  fun aSyncThatLeavesThePlayerOnItsSongNamesNothing() {
    // A Magic Queue batch appended, or the queue following a song that ended on its own.
    val causes = CrossfadeCauses()
    var current = "a"
    causes.sync("queue", nowMs = 0, currentKey = { current }) {}
    assertEquals("an unnamed seek", causes.seek(nowMs = 10).phrase)
    causes.sync("next", nowMs = 20, currentKey = { current }) { current = "b" }
    assertEquals("Next", causes.move(Player.MEDIA_ITEM_TRANSITION_REASON_SEEK, nowMs = 30).phrase)
    // The player may move as the sync is made, before it returns.
    val moved = causes.sync("previous", nowMs = 40, currentKey = { current }) {
      current = "a"
      causes.move(Player.MEDIA_ITEM_TRANSITION_REASON_SEEK, nowMs = 40).phrase
    }
    assertEquals("Previous", moved)
  }

  @Test
  fun aRequestAnsweredLateKeepsItsNote() {
    // Android Auto plays a song that has to be searched first, which can take longer than a note waits.
    val causes = CrossfadeCauses()
    causes.noteSession("Android Auto", nowMs = 0)
    val held = causes.held(nowMs = 5)
    causes.noteApp("queue", nowMs = 1000)
    causes.noteAgain(held, nowMs = 6000)
    assertEquals(
      "a session command from Android Auto",
      causes.move(Player.MEDIA_ITEM_TRANSITION_REASON_PLAYLIST_CHANGED, nowMs = 6010).phrase,
    )
    // Nothing held, nothing noted.
    causes.noteAgain(causes.held(nowMs = 7000), nowMs = 7000)
    assertEquals(
      "a change to the player's list",
      causes.move(Player.MEDIA_ITEM_TRANSITION_REASON_PLAYLIST_CHANGED, nowMs = 7010).phrase,
    )
  }

  @Test
  fun aNewQueueSetOnThePlayerTakesTheNoteToo() {
    val causes = CrossfadeCauses()
    causes.noteApp("play", nowMs = 0)
    assertEquals("playing a new queue", causes.move(Player.MEDIA_ITEM_TRANSITION_REASON_PLAYLIST_CHANGED, nowMs = 10).phrase)
    assertEquals(
      "a change to the player's list",
      causes.move(Player.MEDIA_ITEM_TRANSITION_REASON_PLAYLIST_CHANGED, nowMs = 20).phrase,
    )
  }

  @Test
  fun aNoteNamesOneChangeOnlyAndIsForgottenSoon() {
    val causes = CrossfadeCauses()
    causes.noteApp("next", nowMs = 0)
    causes.move(Player.MEDIA_ITEM_TRANSITION_REASON_SEEK, nowMs = 10)
    assertEquals("an unnamed move", causes.move(Player.MEDIA_ITEM_TRANSITION_REASON_SEEK, nowMs = 20).phrase)
    causes.noteApp("scrubber", nowMs = 0)
    assertEquals("an unnamed seek", causes.seek(nowMs = 30_000).phrase)
  }

  @Test
  fun aSessionCommandNamesItsController() {
    val causes = CrossfadeCauses()
    causes.noteSession("Android Auto", nowMs = 0)
    assertEquals("a session command from Android Auto", causes.move(Player.MEDIA_ITEM_TRANSITION_REASON_SEEK, nowMs = 10).phrase)
    causes.noteSession("com.android.systemui", nowMs = 0)
    assertEquals("a session command from com.android.systemui", causes.seek(nowMs = 10).phrase)
  }

  @Test
  fun aMediaButtonStaysOneThroughTheCommandItBecomes() {
    // A headset or notification button: the session turns it into a player command.
    val causes = CrossfadeCauses()
    causes.noteMediaButton("the notification", nowMs = 0)
    causes.noteSession("the notification", nowMs = 5)
    assertEquals("a media button from the notification", causes.move(Player.MEDIA_ITEM_TRANSITION_REASON_SEEK, nowMs = 10).phrase)
  }

  @Test
  fun anUnknownAppCauseIsStillNamed() {
    val causes = CrossfadeCauses()
    causes.noteApp("somethingNew", nowMs = 0)
    assertEquals("the app (somethingNew)", causes.seek(nowMs = 10).phrase)
  }
}
