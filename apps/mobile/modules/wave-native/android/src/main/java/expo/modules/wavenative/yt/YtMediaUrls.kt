package expo.modules.wavenative.yt

/**
 * YouTube media addresses (`*.googlevideo.com/videoplayback?…`): they carry
 * the file's length (`clen`) and take the byte range to send as a `range`
 * parameter, which is how YouTube's own clients ask for one.
 */
object YtMediaUrls {
  /** [url] asking for bytes [start] to [end] (inclusive), replacing any range it had. */
  fun withRange(url: String, start: Long, end: Long): String {
    val query = url.substringAfter('?', "")
    val base = url.substringBefore('?')
    val kept = query.split('&').filter { it.isNotEmpty() && !it.startsWith("range=") }
    return "$base?${(kept + "range=$start-$end").joinToString("&")}"
  }

  /** The file's length in bytes as the address states it, or null. */
  fun contentLength(url: String): Long? =
    url.substringAfter('?', "").split('&')
      .firstOrNull { it.startsWith("clen=") }
      ?.substringAfter('=')?.toLongOrNull()
}
