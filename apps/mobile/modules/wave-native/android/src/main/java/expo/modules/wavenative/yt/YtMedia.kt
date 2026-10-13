package expo.modules.wavenative.yt

/**
 * How a YT Music song travels as a player item: its path (and media URI) is
 * its track id, `yt:<videoId>`, and the playback service streams it from
 * YouTube when the player loads it ([YtDataSource]). Library items keep their
 * file paths.
 */
object YtMedia {
  private const val PREFIX = "yt:"
  private val VIDEO_ID = Regex("[A-Za-z0-9_-]{1,64}")

  /** The video id of the YT Music song at [path], or null for a Library file. */
  fun videoIdOf(path: String): String? {
    if (!path.startsWith(PREFIX)) return null
    return path.substring(PREFIX.length).takeIf(VIDEO_ID::matches)
  }

  /** The player item URI (and path) of the YT Music song [videoId]. */
  fun uriOf(videoId: String): String = PREFIX + videoId
}
