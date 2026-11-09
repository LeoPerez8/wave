package expo.modules.wavenative.player

import androidx.media3.common.MediaItem
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test

class SongGainsTest {
  @After
  fun forget() = SongGains.retain(emptySet())

  private fun entry(key: String, uri: String) = MediaItem.Builder().setMediaId(key).setUri(uri).build()

  @Test
  fun anEntrysGainIsReadByItsKey() {
    SongGains.set("a", SongGain(-3.0, GainSource.TAG))
    assertEquals(SongLoudness(known = SongGain(-3.0, GainSource.TAG)), SongGains.loudnessOf(entry("a", "file:///m/a.flac")))
    assertEquals(SongLoudness(), SongGains.loudnessOf(entry("b", "file:///m/a.flac")))
    assertEquals(SongLoudness(), SongGains.loudnessOf(null))
  }

  @Test
  fun aGainAsJsSendsItIsReadByCoresSourceName() {
    SongGains.set("a", -3.0, "tag")
    assertEquals(SongGain(-3.0, GainSource.TAG), SongGains.loudnessOf(entry("a", "file:///m/a.flac")).known)
    // No value, or a source this side doesn't know: none, so the typical gain.
    SongGains.set("a", null, null)
    assertEquals(SongLoudness(), SongGains.loudnessOf(entry("a", "file:///m/a.flac")))
    SongGains.set("a", -3.0, "measured-someday")
    assertEquals(SongLoudness(), SongGains.loudnessOf(entry("a", "file:///m/a.flac")))
  }

  @Test
  fun aSongWithNoValueAnyMoreLosesItsGain() {
    SongGains.set("a", SongGain(-3.0, GainSource.TAG))
    SongGains.set("a", null)
    assertEquals(SongLoudness(), SongGains.loudnessOf(entry("a", "file:///m/a.flac")))
  }

  @Test
  fun entriesThePlayerNoLongerHoldsAreForgotten() {
    SongGains.set("a", SongGain(-3.0, GainSource.TAG))
    SongGains.set("b", SongGain(-4.0, GainSource.TAG))
    SongGains.retain(setOf("b"))
    assertEquals(SongLoudness(), SongGains.loudnessOf(entry("a", "file:///m/a.flac")))
    assertEquals(SongGain(-4.0, GainSource.TAG), SongGains.loudnessOf(entry("b", "file:///m/b.flac")).known)
  }

  @Test
  fun aStreamedSongStillHasYouTubesValue() {
    expo.modules.wavenative.yt.YtLoudness.note("gainsTest01", 6.0)
    // Android's Uri is a stub on the JVM: the item's media ID stands in for its `yt:` URI.
    val streamed = MediaItem.Builder().setMediaId("yt:gainsTest01").build()
    assertEquals(SongLoudness(youtubeLoudnessDb = 6.0), SongGains.loudnessOf(streamed))
  }
}
