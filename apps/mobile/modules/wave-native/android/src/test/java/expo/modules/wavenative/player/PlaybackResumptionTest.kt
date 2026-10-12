package expo.modules.wavenative.player

import androidx.media3.common.Player
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PlaybackResumptionTest {
  private fun item(key: String) = ResumeItem(key, "/music/$key.flac", "Title $key", "Artist", "Album", null)

  private val snapshot = ResumeSnapshot(
    items = listOf(item("a"), item("b"), item("c")),
    index = 1,
    positionMs = 42_000,
    shuffle = false,
    repeat = "one",
    source = "phone",
    queueJson = "{}",
  )

  @Test
  fun `resumes the saved items at the saved item, position and repeat`() {
    val resumption = PlaybackResumption.plan(snapshot, byAuto = false) { it.id }

    assertEquals(Resumption(listOf("a", "b", "c"), 1, 42_000L, Player.REPEAT_MODE_ONE, "phone"), resumption)
  }

  @Test
  fun `nothing to resume without a snapshot or with an empty one`() {
    assertNull(PlaybackResumption.plan(null, byAuto = false) { it.id })
    assertNull(PlaybackResumption.plan(snapshot.copy(items = emptyList(), index = -1), byAuto = false) { it.id })
  }

  @Test
  fun `an index outside the items starts the first one from the top`() {
    val resumption = PlaybackResumption.plan(snapshot.copy(index = 7), byAuto = false) { it.id }

    assertEquals(Resumption(listOf("a", "b", "c"), 0, 0L, Player.REPEAT_MODE_ONE, "phone"), resumption)
  }

  @Test
  fun `a negative position starts from the top and an unknown repeat is off`() {
    val resumption = PlaybackResumption.plan(snapshot.copy(positionMs = -5, repeat = "sideways"), byAuto = false) { it.id }

    assertEquals(Resumption(listOf("a", "b", "c"), 1, 0L, Player.REPEAT_MODE_OFF, "phone"), resumption)
  }

  @Test
  fun `a resume Auto asked for plays from Auto, whoever started the queue`() {
    assertEquals("auto", PlaybackResumption.plan(snapshot, byAuto = true) { it.id }?.source)
    assertEquals("auto", PlaybackResumption.plan(snapshot.copy(source = "auto"), byAuto = false) { it.id }?.source)
    assertEquals("phone", PlaybackResumption.plan(snapshot, byAuto = false) { it.id }?.source)
  }
}
