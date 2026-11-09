package expo.modules.wavenative.player

import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Timeline
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.AudioProcessor.StreamMetadata
import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The gain stage as the player's audio sink drives it: each song's samples are configured and
 * flushed in with the song's place in the timeline, as `DefaultAudioSink` does at a gapless song
 * change, then queued buffer by buffer. Two synthetic songs: a stream YouTube says is 6 dB loud,
 * and a Library file Wave knows nothing about.
 */
class GainStageTest {
  private val stream = MediaItem.Builder().setMediaId("yt:loud").build()
  private val file = MediaItem.Builder().setMediaId("/music/file.flac").build()
  private val timeline = Songs(listOf(stream, file))
  private val known = mapOf("yt:loud" to SongLoudness(youtubeLoudnessDb = 6.0))

  private var on = true
  private val started = mutableListOf<SongGain>()
  private val stage = GainStage(
    loudnessOf = { item -> known[item?.mediaId] ?: SongLoudness() },
    isOn = { on },
    onSongStart = { started += it },
  )

  @Test
  fun inGaplessPlaybackTheGainChangesAtTheFirstSampleOfTheNextSong() {
    startSong(0)
    val end = play(frames = 1_000)
    stage.queueEndOfStream()
    startSong(1)
    val start = play(frames = 1_000)

    // 6 dB down: 10000 × 0.501. Then the typical gain, 5 dB down: 10000 × 0.562.
    assertEquals(5012, end.last().toInt())
    assertEquals(5623, start.first().toInt())
    assertTrue(start.all { it.toInt() == 5623 })
  }

  @Test
  fun turningTheSwitchOffPlaysThePlayingSongAsItIsWithoutANewStream() {
    startSong(0)
    play(frames = 1_000)
    on = false
    val after = play(frames = 2_000)

    // No jump on the first sample, and the song's own level within 20 ms (882 frames).
    assertTrue(after.first().toInt() in 5012..5100)
    assertTrue(after.drop(2 * 882).all { it.toInt() == 10_000 })
  }

  @Test
  fun turningTheSwitchOnAppliesThePlayingSongsGainAtOnce() {
    on = false
    startSong(0)
    assertEquals(10_000, play(frames = 100).last().toInt())
    on = true
    val after = play(frames = 2_000)

    assertTrue(after.drop(2 * 882).all { it.toInt() == 5012 })
  }

  @Test
  fun eachSongStartIsToldOnceWithItsGainButASeekWithinItIsnt() {
    startSong(0)
    play(frames = 100)
    // A seek: the sink flushes from the start, then from where the song carries on.
    stage.flush(metadata(0, positionUs = 0))
    stage.flush(metadata(0, positionUs = 90_000_000))
    play(frames = 100)
    stage.queueEndOfStream()
    startSong(1)
    play(frames = 100)
    // Repeat one: the same song from its start again.
    stage.queueEndOfStream()
    startSong(1)
    play(frames = 100)

    assertEquals(
      listOf(
        SongGain(-6.0, GainSource.YOUTUBE),
        SongGain(-5.0, GainSource.TYPICAL),
        SongGain(-5.0, GainSource.TYPICAL),
      ),
      started,
    )
  }

  @Test
  fun aSongResumedPartWayThroughStillStarts() {
    startSong(1, positionUs = 90_000_000)
    play(frames = 100)

    assertEquals(listOf(SongGain(-5.0, GainSource.TYPICAL)), started)
  }

  @Test
  fun withTheSwitchOffAStartSaysSo() {
    on = false
    startSong(0)
    val samples = play(frames = 10)

    assertEquals(listOf(SongGain(0.0, GainSource.OFF)), started)
    assertArrayEquals(ShortArray(20) { 10_000 }, samples)
  }

  @Test
  fun aFormatItCantScalePassesThroughUntouched() {
    val float = AudioProcessor.AudioFormat(44_100, 2, C.ENCODING_PCM_FLOAT)
    stage.configure(float)
    stage.flush(metadata(0))

    assertTrue(!stage.isActive)
  }

  /** The sink starting [index]'s samples at [positionUs] into it. */
  private fun startSong(index: Int, positionUs: Long = 0) {
    stage.configure(STEREO_16_BIT)
    stage.flush(metadata(index, positionUs))
  }

  private fun metadata(index: Int, positionUs: Long = 0): StreamMetadata =
    StreamMetadata.Builder().setTimeline(timeline).setPeriodUid(index).setPositionOffsetUs(positionUs).build()

  /** Queues [frames] stereo frames at 10000 and gives back what comes out. */
  private fun play(frames: Int): ShortArray {
    val input = ByteBuffer.allocateDirect(frames * 4).order(ByteOrder.nativeOrder())
    repeat(frames * 2) { input.putShort(10_000) }
    input.flip()
    stage.queueInput(input)
    val output = stage.output
    return ShortArray(output.remaining() / 2) { output.short }
  }

  /** A playlist of [items], one period each, its uid the item's index. */
  private class Songs(private val items: List<MediaItem>) : Timeline() {
    override fun getWindowCount() = items.size

    override fun getWindow(windowIndex: Int, window: Window, defaultPositionProjectionUs: Long): Window =
      window.set(
        windowIndex, items[windowIndex], null, C.TIME_UNSET, C.TIME_UNSET, C.TIME_UNSET,
        true, false, null, 0, C.TIME_UNSET, windowIndex, windowIndex, 0,
      )

    override fun getPeriodCount() = items.size

    override fun getPeriod(periodIndex: Int, period: Period, setIds: Boolean): Period =
      period.set(periodIndex, periodIndex, periodIndex, C.TIME_UNSET, 0)

    override fun getIndexOfPeriod(uid: Any): Int = (uid as? Int)?.takeIf { it in items.indices } ?: C.INDEX_UNSET

    override fun getUidOfPeriod(periodIndex: Int): Any = periodIndex
  }

  private companion object {
    val STEREO_16_BIT = AudioProcessor.AudioFormat(44_100, 2, C.ENCODING_PCM_16BIT)
  }
}
