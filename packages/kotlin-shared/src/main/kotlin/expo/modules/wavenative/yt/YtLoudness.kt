package expo.modules.wavenative.yt

/**
 * YouTube's loudness for the YT Music songs the player has opened: its
 * `loudnessDb`, dB above YouTube's -14 LUFS reference (its answer's
 * `loudnessTargetLkfs`), which Normalize Volume turns a streamed song down by
 * ([expo.modules.wavenative.player.NormalizeVolume]). [YtDataSource] notes it
 * as it opens a song, from the stream it resolved or from what the audio
 * cache kept with the song's audio ([YtAudioCache.loudnessOf]), so it's known
 * before the song's first sample reaches the gain stage. Process-wide, as
 * both crossfade players read it. Thread-safe.
 */
object YtLoudness {
  private const val CAPACITY = 512

  private val known = object : LinkedHashMap<String, Double>(16, 0.75f, true) {
    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Double>?): Boolean = size > CAPACITY
  }

  /** [videoId]'s loudness, or nothing new when YouTube gave none. */
  @Synchronized
  fun note(videoId: String, loudnessDb: Double?) {
    if (loudnessDb != null && loudnessDb.isFinite()) known[videoId] = loudnessDb
  }

  /** [videoId]'s loudness, or null when it hasn't been opened with one. */
  @Synchronized
  fun of(videoId: String): Double? = known[videoId]
}
