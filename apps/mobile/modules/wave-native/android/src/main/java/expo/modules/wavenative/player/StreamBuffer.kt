package expo.modules.wavenative.player

import android.content.Context
import android.content.SharedPreferences
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.Timeline
import androidx.media3.common.util.UnstableApi
import androidx.media3.common.util.Util
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.LoadControl
import androidx.media3.exoplayer.analytics.PlayerId
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.exoplayer.source.TrackGroupArray
import androidx.media3.exoplayer.trackselection.ExoTrackSelection
import androidx.media3.exoplayer.upstream.Allocator
import expo.modules.wavenative.yt.YtMedia

/**
 * Buffer (Settings › Playback): how much streamed audio the session's player
 * keeps loaded ahead. JS sets it ([WavePlayerModule]'s `setStreamBuffer`);
 * it's kept on disk so the service follows it without JS (a cold start from
 * Auto or the media controls), and read by [StreamLoadControl] on the
 * playback thread at each buffering decision, so a change applies without
 * restarting playback.
 *
 * [aheadMs] is a copy of Core's `bufferAheadMs` (the service can't call Core):
 * `StreamBufferTest` runs `streamBuffer.test.ts`'s cases. Change both together.
 */
object StreamBuffer {
  private const val PREFS = "wave_stream_buffer"
  private const val AHEAD_KEY = "aheadMs"

  /** Core's `LIBRARY_BUFFER_MS`: ExoPlayer's own 50 s, what library files keep. */
  const val LIBRARY_MS = 50_000L

  /** Core's `STREAM_BUFFER_DEFAULT` (2 minutes), until JS has said otherwise. */
  const val DEFAULT_MS = 120_000L

  private var prefs: SharedPreferences? = null

  /** The Buffer setting in ms (Core's `streamBufferMs`), as the playback thread reads it. */
  @Volatile
  var chosenMs: Long = DEFAULT_MS
    private set

  fun init(context: Context) {
    if (prefs != null) return
    val stored = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    prefs = stored
    chosenMs = stored.getLong(AHEAD_KEY, DEFAULT_MS)
  }

  fun setChosen(ms: Long) {
    chosenMs = ms.coerceAtLeast(0L)
    prefs?.edit()?.putLong(AHEAD_KEY, chosenMs)?.apply()
  }

  /**
   * How much audio, in ms, to keep loaded ahead of the playing position while
   * a song loads: [chosenMs] for a [streamed] one, never under [LIBRARY_MS],
   * and [LIBRARY_MS] for a library file (Core's `bufferAheadMs`).
   */
  fun aheadMs(chosenMs: Long, streamed: Boolean): Long =
    if (streamed) maxOf(chosenMs, LIBRARY_MS) else LIBRARY_MS
}

/**
 * The session player's load control: ExoPlayer's [DefaultLoadControl] for
 * everything but how far a streamed YT Music song loads ahead, which follows
 * [StreamBuffer]. What's buffered spans song boundaries: once a song is fully
 * loaded the player loads the next one in its list, so a long buffer holds
 * the next songs in Up Next. The player drops what it loaded for songs a
 * queue change moves out of next place, so a reorder or a replaced Up Next
 * never plays stale audio. Library files and crossfade's preload
 * ([shouldContinuePreloading]) keep the default's decisions.
 *
 * Called on the player's playback thread only.
 */
@OptIn(UnstableApi::class)
class StreamLoadControl(private val default: DefaultLoadControl = DefaultLoadControl()) : LoadControl {
  private val period = Timeline.Period()
  private val window = Timeline.Window()

  override fun shouldContinueLoading(parameters: LoadControl.Parameters): Boolean {
    val defaultSays = default.shouldContinueLoading(parameters)
    if (!loadingStreamed(parameters.timeline, parameters.mediaPeriodId)) return defaultSays
    // Bounded by time, not by the default's byte target: about 40-60 MB at 30 minutes.
    val aheadUs = Util.msToUs(StreamBuffer.aheadMs(StreamBuffer.chosenMs, streamed = true))
    return defaultSays || parameters.bufferedDurationUs < aheadUs
  }

  /** Whether the song being loaded is a streamed YT Music one (a `yt:` item). */
  private fun loadingStreamed(timeline: Timeline, id: MediaSource.MediaPeriodId): Boolean {
    if (timeline.isEmpty) return false
    val index = timeline.getIndexOfPeriod(id.periodUid)
    if (index == C.INDEX_UNSET) return false
    val windowIndex = timeline.getPeriod(index, period).windowIndex
    val uri = timeline.getWindow(windowIndex, window).mediaItem.localConfiguration?.uri ?: return false
    return YtMedia.videoIdOf(uri.toString()) != null
  }

  // The rest is the default's.
  override fun onPrepared(playerId: PlayerId) = default.onPrepared(playerId)

  override fun onTracksSelected(
    parameters: LoadControl.Parameters,
    trackGroups: TrackGroupArray,
    trackSelections: Array<out ExoTrackSelection?>,
  ) = default.onTracksSelected(parameters, trackGroups, trackSelections)

  override fun onStopped(playerId: PlayerId) = default.onStopped(playerId)

  override fun onReleased(playerId: PlayerId) = default.onReleased(playerId)

  override fun getAllocator(playerId: PlayerId): Allocator = default.getAllocator(playerId)

  override fun getBackBufferDurationUs(playerId: PlayerId): Long = default.getBackBufferDurationUs(playerId)

  override fun retainBackBufferFromKeyframe(playerId: PlayerId): Boolean =
    default.retainBackBufferFromKeyframe(playerId)

  override fun shouldStartPlayback(parameters: LoadControl.Parameters): Boolean =
    default.shouldStartPlayback(parameters)

  override fun shouldContinuePreloading(
    playerId: PlayerId,
    timeline: Timeline,
    mediaPeriodId: MediaSource.MediaPeriodId,
    bufferedDurationUs: Long,
  ): Boolean = default.shouldContinuePreloading(playerId, timeline, mediaPeriodId, bufferedDurationUs)
}
