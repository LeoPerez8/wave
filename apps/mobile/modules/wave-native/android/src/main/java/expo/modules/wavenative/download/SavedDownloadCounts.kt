package expo.modules.wavenative.download

import java.io.File

/**
 * The songs downloading and waiting in the journal at [journal] as its last write left them, as
 * [DurableDownloads.counts] counted them then ([DownloadCounts.of]); null without a readable journal. Read at launch
 * for the app log's line on how the previous session ended (`SessionRecord`), without opening the
 * journal (which would start recovering its jobs, and writes). It reads the snapshot and its log
 * as [DurableDownloads] does ([JournalStore.load]); a record a write is still adding when it's
 * read (a journal open in this process meanwhile) ends the log there.
 *
 * The one reader of the journal's files outside [DurableDownloads]: it reads them through [JournalStore].
 */
fun savedDownloadCounts(journal: File): DownloadCounts? = runCatching {
  val saved = JournalStore(journal).load()!!
  DownloadCounts.of((saved["jobs"] as Map<*, *>).values.map { it as Map<*, *> })
}.getOrNull()
