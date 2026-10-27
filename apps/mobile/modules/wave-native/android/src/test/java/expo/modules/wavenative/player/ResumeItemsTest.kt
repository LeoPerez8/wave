package expo.modules.wavenative.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ResumeItemsTest {
  private fun items() = listOf(
    ResumeItem("k1", "/music/One.flac", "One", "Artist", "Album", null),
    ResumeItem("k2", "/music/Two.mp3", "Two", "Artist", null, null),
  )

  @Test
  fun `a timeline change that only prepared an item keeps the items part`() {
    // The player reports the same items again, as new objects.
    assertNull(changedResumeItems(items(), items()))
  }

  @Test
  fun `a new, moved or updated item rewrites the items part`() {
    val kept = items()
    val added = items() + ResumeItem("k3", "/music/Three.mp3", "Three", "Artist", null, null)
    val moved = items().reversed()
    val coverCached = items().mapIndexed { i, item ->
      if (i == 0) item.copy(artworkPath = "/files/artwork/abc.jpg") else item
    }

    assertEquals(added, changedResumeItems(kept, added))
    assertEquals(moved, changedResumeItems(kept, moved))
    assertEquals(coverCached, changedResumeItems(kept, coverCached))
  }

  @Test
  fun `the first report of a process is new`() {
    assertEquals(items(), changedResumeItems(null, items()))
  }
}
