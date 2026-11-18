package expo.modules.wavenative.yt

import com.metrolist.innertubex.InnerTube

/** Where [YtVisitorData] keeps the visitor data across launches: a setting the device keeps. */
interface YtVisitorStore {
  fun load(): String?

  /** Keeps [value]; null removes it. */
  fun save(value: String?)
}

/**
 * YouTube's visitor data (the anonymous visitor id its web clients send),
 * kept across launches as Metrolist does: innertubex fetches one when the
 * session has none, and the proof-of-origin token is bound to it, so a new
 * one on every launch would mean a new token each time.
 */
class YtVisitorData(private val store: YtVisitorStore) {
  /** Gives a session without visitor data (a fresh launch) the one kept. */
  fun restoreInto(innerTube: InnerTube) {
    if (!innerTube.visitorData.isNullOrBlank()) return
    store.load()?.takeIf { it.isNotBlank() }?.let { innerTube.visitorData = it }
  }

  /** Keeps the session's visitor data once innertubex fetched one. */
  fun saveFrom(innerTube: InnerTube) {
    val current = innerTube.visitorData?.takeIf { it.isNotBlank() } ?: return
    if (current != store.load()) store.save(current)
  }

  /**
   * Drops the session's visitor data and the one kept, while YouTube limits downloads: innertubex
   * fetches a new one with the next request, and the proof-of-origin token follows it.
   */
  fun forget(innerTube: InnerTube) {
    innerTube.visitorData = null
    store.save(null)
  }
}
