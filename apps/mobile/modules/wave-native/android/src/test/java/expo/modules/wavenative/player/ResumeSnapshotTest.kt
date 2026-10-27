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
    queueJson = """{"entries":[{"key":"k1","trackId":"1"}],"index":0,"shuffle":true,"repeat":"all"}""",
    queueIndex = 1,
    queueMetadata = """{"shuffle":true,"repeat":"one"}""",
  )

  private fun readBack(snapshot: ResumeSnapshot) =
    ResumeSnapshot.decode(snapshot.encodeItems(), snapshot.encodePlace())

  @Test
  fun `a written snapshot reads back the same`() {
    assertEquals(snapshot, readBack(snapshot))
  }

  @Test
  fun `the place part holds no items or queue`() {
    val place = snapshot.encodePlace()

    assert("One" !in place && "entries" !in place) { place }
  }

  @Test
  fun `the queue's parts kept apart may be absent`() {
    val whole = snapshot.copy(queueIndex = null, queueMetadata = null)

    assertEquals(whole, readBack(whole))
  }

  @Test
  fun `tabs, newlines and backslashes in names survive`() {
    val odd = snapshot.copy(
      items = listOf(ResumeItem("k1", "/music/a\\b\tc.flac", "Line\nbreak\r", "\\N", null, "\\")),
      index = 0,
      queueJson = null,
    )

    assertEquals(odd, readBack(odd))
  }

  @Test
  fun `a snapshot an earlier Wave wrote in one file still reads`() {
    val text = listOf(
      "wave-resume 1",
      "index\t1",
      "position\t83250",
      "shuffle\ttrue",
      "repeat\tall",
      "source\tauto",
      "queue\t${snapshot.queueJson}",
      "item\tk1\t/music/One.flac\tOne\tArtist\tAlbum\t/files/artwork/abc.jpg",
      "item\tk2\t/music/Two.mp3\tTwo\tArtist\t\\N\t\\N",
    ).joinToString("\n", postfix = "\n")

    assertEquals(snapshot.copy(queueIndex = null, queueMetadata = null), ResumeSnapshot.decode(text))
  }

  @Test
  fun `no snapshot reads as none`() {
    assertNull(ResumeSnapshot.decode(null))
    assertNull(ResumeSnapshot.decode(""))
    assertNull(ResumeSnapshot.decode(snapshot.encodeItems(), null))
    assertNull(ResumeSnapshot.decode(null, snapshot.encodePlace()))
  }

  @Test
  fun `a corrupt snapshot reads as none`() {
    val items = snapshot.encodeItems()
    val place = snapshot.encodePlace()

    assertNull(ResumeSnapshot.decode("garbage", place))
    assertNull(ResumeSnapshot.decode(items, "garbage"))
    assertNull(ResumeSnapshot.decode(place, items))
    assertNull(ResumeSnapshot.decode(items.replace("wave-resume-items 1", "wave-resume-items 9"), place))
    assertNull(ResumeSnapshot.decode(items, place.replace("index\t1", "index\tone")))
    assertNull(ResumeSnapshot.decode(items, place.replace("position\t83250", "position")))
    assertNull(ResumeSnapshot.decode(items, place.lines().filterNot { it.startsWith("repeat") }.joinToString("\n")))
    assertNull(ResumeSnapshot.decode(items, place.replace("queueIndex\t1", "queueIndex\tone")))
    assertNull(ResumeSnapshot.decode(items.substring(0, items.indexOf("\tOne")), place))
  }
}
