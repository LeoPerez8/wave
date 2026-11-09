package expo.modules.wavenative.player

import androidx.media3.common.MediaItem
import expo.modules.wavenative.yt.YtLoudness
import expo.modules.wavenative.yt.YtMedia
import java.util.concurrent.ConcurrentHashMap

/**
 * Normalize Volume's gains for the Library songs in the player's list, by
 * queue entry key (the item's media ID), as Core's `entryGain` worked them out
 * in JS (track or album gain): they come with the queue ([WavePlayerModule]'s `applySync`, or
 * Auto's play request, [AutoLibrary]), and a
 * value learned after that (a scan reading a song's tags) comes on its own
 * (`setSongGains`). The gain stage reads an entry's gain when its song starts
 * ([loudnessOf]), so a late one applies from that song's next start, never
 * mid-song, and without pushing the queue again. Both crossfade players read
 * it; process-wide and thread-safe.
 */
object SongGains {
  private val byKey = ConcurrentHashMap<String, SongGain>()

  /** [key]'s gain, or none when its song has no value (it plays at the typical gain). */
  fun set(key: String, gain: SongGain?) {
    if (gain == null || !gain.gainDb.isFinite()) byKey.remove(key) else byKey[key] = gain
  }

  /** [key]'s gain as JS sends it: [gainDb] from [source] (Core's names), or none. */
  fun set(key: String, gainDb: Double?, source: String?) {
    val from = GainSource.of(source)
    set(key, if (from == null || gainDb == null) null else SongGain(gainDb, from))
  }

  /** Forgets the entries the player no longer holds. */
  fun retain(keys: Set<String>) {
    byKey.keys.retainAll(keys)
  }

  /**
   * What's known of [item]'s loudness as its song starts: its entry's gain,
   * and YouTube's value for a streamed song it was opened with.
   */
  fun loudnessOf(item: MediaItem?): SongLoudness {
    val videoId = YtMedia.videoIdOf(item?.localConfiguration?.uri?.toString() ?: item?.mediaId ?: "")
    return SongLoudness(
      youtubeLoudnessDb = videoId?.let(YtLoudness::of),
      known = item?.mediaId?.let(byKey::get),
    )
  }
}
