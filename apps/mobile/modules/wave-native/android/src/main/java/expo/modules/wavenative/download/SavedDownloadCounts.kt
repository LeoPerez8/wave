package expo.modules.wavenative.download

import java.io.File
import java.io.FileInputStream
import java.io.ObjectInputStream

/**
 * The songs downloading and waiting in the journal at [journal] as its last write left them, as
 * [DurableDownloads.counts] counted them then; null without a readable journal. Read at launch
 * for the app log's line on how the previous session ended (`SessionRecord`), without opening the
 * journal (which would start recovering its jobs). The journal's writes are atomic, so a journal
 * open in this process meanwhile is read whole, before or after its write.
 *
 * The one reader of the journal's file outside [DurableDownloads]: it changes with the file's format.
 */
fun savedDownloadCounts(journal: File): DownloadCounts? = runCatching {
  @Suppress("UNCHECKED_CAST")
  val saved = FileInputStream(journal).use { ObjectInputStream(it).readObject() } as Map<String, Any?>
  val jobs = (saved["jobs"] as Map<*, *>).values.map { it as Map<*, *> }
  val pending = jobs.filter { job ->
    job["phase"] != "failed" && job["phase"] != "cancelled" &&
      !(job["phase"] == "completed" && (job["acknowledged"] == true || job["importFailure"] != null))
  }
  val left = pending.count { it["phase"] == "queued" }
  DownloadCounts(running = pending.size - left, left = left)
}.getOrNull()
