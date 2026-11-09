package expo.modules.wavenative.player

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Timeline
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.AudioProcessor.StreamMetadata
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.common.util.UnstableApi
import java.nio.ByteBuffer
import kotlin.math.pow
import kotlin.math.roundToInt

/**
 * Normalize Volume's gain stage: a processing stage in a player's audio sink
 * ([WaveRenderersFactory]) that scales the playing song's samples by its gain
 * ([NormalizeVolume.gain]). It sits under the player's volume, which stays the
 * crossfade's, so a fading song's fade and its gain multiply; and it can scale
 * above 0 dB, which the player's volume can't. Each player has its own.
 *
 * The sink flushes it with the song's place in the timeline as that song's
 * first sample comes in, a gapless song change included, so the gain changes
 * at the first sample of the next song; what the song is and what's known of
 * its loudness ([loudnessOf]) are settled then and kept for the song. The
 * switch ([isOn]) is read at every buffer: turning it on or off moves the
 * playing song to its new level within [RAMP_MS], without a skip or a pause.
 * [onSongStart] hears each song's start once, with its gain, but not a seek
 * within it.
 *
 * Takes 16-bit PCM, which is what the sink hands its processors; anything
 * else passes through untouched. Runs on the playback thread.
 */
@OptIn(UnstableApi::class)
class GainStage(
  private val loudnessOf: (MediaItem?) -> SongLoudness,
  private val isOn: () -> Boolean = { NormalizeVolume.on },
  private val onSongStart: (SongGain) -> Unit = {},
) : BaseAudioProcessor() {
  private val period = Timeline.Period()
  private val window = Timeline.Window()

  /** Where the last flush said the samples coming next start, until they come. */
  private var pending: StreamMetadata? = null

  /** The song playing: its item, what's known of its loudness, and the frames played since it started. */
  private var item: MediaItem? = null
  private var loudness = SongLoudness()
  private var framesSinceStart = 0L

  /** The switch as last read, and the factor the samples are scaled by now and are heading to. */
  private var lastOn: Boolean? = null
  private var factor = 1f
  private var target = 1f
  private var step = 0f
  private var rampLeft = 0

  override fun onConfigure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat =
    if (inputAudioFormat.encoding == C.ENCODING_PCM_16BIT) inputAudioFormat else AudioProcessor.AudioFormat.NOT_SET

  override fun onFlush(streamMetadata: StreamMetadata) {
    // A seek flushes from the start first, then from where the song carries on: the last one counts.
    pending = streamMetadata
  }

  override fun queueInput(inputBuffer: ByteBuffer) {
    pending?.let(::start)
    pending = null
    followSwitch()
    val position = inputBuffer.position()
    val limit = inputBuffer.limit()
    val output = replaceOutputBuffer(limit - position)
    val channels = inputAudioFormat.channelCount
    var sample = 0
    for (index in position until limit step 2) {
      if (sample == 0 && rampLeft > 0) {
        rampLeft--
        factor = if (rampLeft == 0) target else factor + step
      }
      val scaled = (inputBuffer.getShort(index) * factor).roundToInt()
      output.putShort(scaled.coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt()).toShort())
      sample = (sample + 1) % channels
    }
    framesSinceStart += (limit - position) / inputAudioFormat.bytesPerFrame
    inputBuffer.position(limit)
    output.flip()
  }

  /**
   * The samples coming next start at [metadata]: a new song when it's another
   * item than the one playing, or the same one from its start once some of it
   * has played (repeat one, previous); otherwise a seek within the song, which
   * keeps its gain.
   */
  private fun start(metadata: StreamMetadata) {
    val next = itemOf(metadata)
    val fromStart = metadata.positionOffsetUs < START_US && framesSinceStart > 0
    val known = item
    if (known != null && next?.mediaId == known.mediaId && !fromStart) return
    item = next
    loudness = loudnessOf(next)
    framesSinceStart = 0
    val on = isOn()
    lastOn = on
    val gain = NormalizeVolume.gain(on, loudness)
    factor = linear(gain.gainDb)
    target = factor
    rampLeft = 0
    onSongStart(gain)
  }

  /** Heads for the playing song's level under the switch as it is now, over [RAMP_MS]. */
  private fun followSwitch() {
    val on = isOn()
    if (on == lastOn) return
    lastOn = on
    target = linear(NormalizeVolume.gain(on, loudness).gainDb)
    rampLeft = maxOf(1, inputAudioFormat.sampleRate * RAMP_MS / 1000)
    step = (target - factor) / rampLeft
  }

  private fun itemOf(metadata: StreamMetadata): MediaItem? {
    val uid = metadata.periodUid ?: return null
    val timeline = metadata.timeline
    if (timeline.isEmpty || timeline.getIndexOfPeriod(uid) == C.INDEX_UNSET) return null
    val windowIndex = timeline.getPeriodByUid(uid, period).windowIndex
    return timeline.getWindow(windowIndex, window).mediaItem
  }

  override fun onReset() {
    pending = null
    item = null
    loudness = SongLoudness()
    framesSinceStart = 0
    lastOn = null
    factor = 1f
    target = 1f
    rampLeft = 0
  }

  private companion object {
    /** How long turning the switch takes to reach the new level: short enough to be at once, long enough not to click. */
    const val RAMP_MS = 20

    /** Samples starting this close to a song's start start it again. */
    const val START_US = 1_000_000L

    fun linear(gainDb: Double): Float = 10.0.pow(gainDb / 20).toFloat()
  }
}
