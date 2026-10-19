package expo.modules.wavenative.yt

import android.content.Context
import com.metrolist.innertubex.InnerTube

/**
 * YouTube's visitor data (the anonymous visitor id its web clients send),
 * kept across launches as Metrolist does: innertubex fetches one when the
 * session has none, and the proof-of-origin token is bound to it, so a new
 * one on every launch would mean a new token each time.
 */
class YtVisitorData(context: Context) {
  private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  /** Gives a session without visitor data (a fresh launch) the one kept. */
  fun restoreInto(innerTube: InnerTube) {
    if (!innerTube.visitorData.isNullOrBlank()) return
    prefs.getString(KEY, null)?.takeIf { it.isNotBlank() }?.let { innerTube.visitorData = it }
  }

  /** Keeps the session's visitor data once innertubex fetched one. */
  fun saveFrom(innerTube: InnerTube) {
    val current = innerTube.visitorData?.takeIf { it.isNotBlank() } ?: return
    if (current != prefs.getString(KEY, null)) prefs.edit().putString(KEY, current).apply()
  }

  /**
   * Drops the session's visitor data and the one kept, while YouTube limits downloads: innertubex
   * fetches a new one with the next request, and the proof-of-origin token follows it.
   */
  fun forget(innerTube: InnerTube) {
    innerTube.visitorData = null
    prefs.edit().remove(KEY).apply()
  }

  private companion object {
    const val PREFS = "wave_yt_visitor"
    const val KEY = "visitor_data"
  }
}
