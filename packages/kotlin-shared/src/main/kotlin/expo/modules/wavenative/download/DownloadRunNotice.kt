package expo.modules.wavenative.download

/**
 * The run as the download notification shows it (#476): its title ("Downloading 1,234 of 2,500"),
 * its bar ([finished] of [total]) and its text ("12 failed · 1,254 left · About 2 h left"). JS
 * follows the run (Core's `followDownloadRun`) and pushes its words (Core's `downloadRunNotice`)
 * about once a second, so the notification and Settings › Downloads count the same run.
 */
data class DownloadRunNotice(val title: String, val text: String, val finished: Int, val total: Int) {
  companion object {
    /** What JS pushed; null with no run, a one-song run (the per-song notification) or anything else. */
    fun of(notice: Map<String, Any?>?): DownloadRunNotice? {
      val title = notice?.get("title") as? String ?: return null
      val text = notice["text"] as? String ?: return null
      val finished = (notice["finished"] as? Number)?.toInt() ?: return null
      val total = (notice["total"] as? Number)?.toInt() ?: return null
      return if (total > 1) DownloadRunNotice(title, text, finished.coerceIn(0, total), total) else null
    }
  }
}
