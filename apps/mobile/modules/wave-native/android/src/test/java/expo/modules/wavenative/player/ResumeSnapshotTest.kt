package expo.modules.wavenative.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ResumeSnapshotTest {
  private val snapshot = ResumeSnapshot(
    items = listOf(
      ResumeItem("k1", "/music/One.flac", "One", "Artist", "Album", "/files/artwork/abc.jpg"),
      ResumeItem("k2", "/music/Two.mp3", "Two", "Artist", null, null),
    ),
    index = 1,
    positionMs = 83_250,
    shuffle = true,
    repeat = "all",
    source = "auto",
    queueJson = """{"entries":[{"key":"k1","trackId":"1"}],"shuffle":true,"repeat":"all"}""",
  )

  @Test
  fun `a written snapshot reads back the same`() {
    assertEquals(snapshot, ResumeSnapshot.decode(snapshot.encode()))
  }

  @Test
  fun `tabs, newlines and backslashes in names survive`() {
    val odd = snapshot.copy(
      items = listOf(ResumeItem("k1", "/music/a\\b\tc.flac", "Line\nbreak\r", "\\N", null, "\\")),
      index = 0,
      queueJson = null,
    )

    assertEquals(odd, ResumeSnapshot.decode(odd.encode()))
  }

  @Test
  fun `no snapshot reads as none`() {
    assertNull(ResumeSnapshot.decode(null))
    assertNull(ResumeSnapshot.decode(""))
  }

  @Test
  fun `a corrupt snapshot reads as none`() {
    val text = snapshot.encode()

    assertNull(ResumeSnapshot.decode("garbage"))
    assertNull(ResumeSnapshot.decode(text.replace("wave-resume 1", "wave-resume 9")))
    assertNull(ResumeSnapshot.decode(text.replace("index\t1", "index\tone")))
    assertNull(ResumeSnapshot.decode(text.replace("position\t83250", "position")))
    assertNull(ResumeSnapshot.decode(text.lines().filterNot { it.startsWith("repeat") }.joinToString("\n")))
    assertNull(ResumeSnapshot.decode(text.substring(0, text.indexOf("\tOne"))))
  }
}
