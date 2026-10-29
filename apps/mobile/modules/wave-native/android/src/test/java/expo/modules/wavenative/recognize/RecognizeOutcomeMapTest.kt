package expo.modules.wavenative.recognize

import org.junit.Assert.assertEquals
import org.junit.Test

/** What JS receives for each outcome. */
class RecognizeOutcomeMapTest {
  @Test
  fun `a match hands over the song's fields`() {
    val song = RecognizedSong("Song", "Artist feat. Other", null, "https://example.com/cover.jpg", null, 2001)

    assertEquals(
      mapOf(
        "kind" to "match",
        "song" to mapOf(
          "title" to "Song",
          "artist" to "Artist feat. Other",
          "album" to null,
          "coverUrl" to "https://example.com/cover.jpg",
          "isrc" to null,
          "releaseYear" to 2001,
        ),
      ),
      RecognizeOutcome.Match(song).toMap(),
    )
  }

  @Test
  fun `no match and failures say which they are`() {
    assertEquals(mapOf("kind" to "noMatch"), RecognizeOutcome.NoMatch.toMap())
    assertEquals(mapOf("kind" to "failed", "failure" to "network"), RecognizeOutcome.Failed(RecognizeFailure.NETWORK).toMap())
    assertEquals(mapOf("kind" to "failed", "failure" to "refused"), RecognizeOutcome.Failed(RecognizeFailure.REFUSED).toMap())
    assertEquals(mapOf("kind" to "failed", "failure" to "unreadable"), RecognizeOutcome.Failed(RecognizeFailure.UNREADABLE).toMap())
  }
}
