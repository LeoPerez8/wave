package expo.modules.wavenative.yt

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.cache.Cache
import androidx.media3.datasource.cache.CacheEvictor
import androidx.media3.datasource.cache.CacheSpan
import java.util.TreeSet

/**
 * What leaves the audio cache for new audio, beyond [maxBytes]: first the
 * songs [leavesFirst] names (audio fetched ahead on Wi-Fi that the day's list
 * no longer has and that hasn't played since, [YtAudioCache.evictor]), the
 * least recently touched of them first; then the least recently played, as
 * Media3's `LeastRecentlyUsedCacheEvictor` does.
 */
@OptIn(UnstableApi::class)
class YtAudioEvictor(
  private val maxBytes: Long,
  private val leavesFirst: (cache: Cache, key: String) -> Boolean,
) : CacheEvictor {
  private val spans = TreeSet<CacheSpan>(::compare)
  private var currentSize = 0L

  override fun requiresCacheSpanTouches(): Boolean = true

  override fun onCacheInitialized() = Unit

  override fun onStartFile(cache: Cache, key: String, position: Long, length: Long) {
    if (length != C.LENGTH_UNSET.toLong()) evict(cache, length)
  }

  override fun onSpanAdded(cache: Cache, span: CacheSpan) {
    spans.add(span)
    currentSize += span.length
    evict(cache, 0)
  }

  override fun onSpanRemoved(cache: Cache, span: CacheSpan) {
    spans.remove(span)
    currentSize -= span.length
  }

  override fun onSpanTouched(cache: Cache, oldSpan: CacheSpan, newSpan: CacheSpan) {
    onSpanRemoved(cache, oldSpan)
    onSpanAdded(cache, newSpan)
  }

  private fun fits(required: Long) = currentSize + required <= maxBytes

  private fun evict(cache: Cache, required: Long) {
    if (fits(required)) return
    val leaving = HashMap<String, Boolean>()
    // A copy: removing a span calls back into onSpanRemoved.
    val first = spans.filter { span -> leaving.getOrPut(span.key) { leavesFirst(cache, span.key) } }
    for (span in first) {
      if (fits(required)) return
      cache.removeSpan(span)
    }
    while (!fits(required) && spans.isNotEmpty()) cache.removeSpan(spans.first())
  }

  private companion object {
    fun compare(a: CacheSpan, b: CacheSpan): Int =
      if (a.lastTouchTimestamp == b.lastTouchTimestamp) a.compareTo(b) else a.lastTouchTimestamp.compareTo(b.lastTouchTimestamp)
  }
}
