package expo.modules.wavenative.download

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.EOFException
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.ObjectInputStream
import java.io.ObjectOutputStream
import java.nio.ByteBuffer
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.zip.CRC32

/**
 * Where the download journal lives on disk (#452): a snapshot ([journal], every job whole: its
 * song, recording, candidates and tags with lyrics) and, beside it, a log of what changed since
 * (`<journal>.log`). A write appends one record to the log: for each job that changed since it
 * was last written, only the fields that changed (a new job whole), the jobs that went, the order
 * when it changed, and the budget's clock. So a write costs what changed: a job's tags are
 * written once, when its prepare answer brings them, and again only in a snapshot.
 *
 * Once the log outgrows the snapshot (and [MIN_LOG_BYTES]), the next write is whole: a new
 * snapshot one epoch on, then a log holding only that epoch. Each file is replaced atomically and
 * synced; a log whose epoch isn't the snapshot's (a crash between the two) is ignored, as the
 * snapshot holds it all. Records are framed with their length and a CRC, so a record a crash cut
 * short ends the log there. A journal written before the log existed (no epoch, no log) reads as
 * epoch 0.
 *
 * Not thread-safe: [DurableDownloads] calls it under its lock; only [takeStats] may come from
 * another thread.
 */
internal class JournalStore(private val journal: File) {
  private val changes = File(journal.path + ".log")
  private var epoch = 0L
  /** Each job as it was last written, the very copy written (readers' copies are never mutated). */
  private val written = HashMap<String, Map<String, Any?>>()
  private var writtenOrder: List<String> = emptyList()
  private var writtenPolicy: Map<String, Any?>? = null
  private var snapshotBytes = 0L
  private var logBytes = 0L
  /** Until a snapshot is written by this store, the next write is whole. */
  private var wholeDue = true

  private val statsLock = Any()
  private var writes = 0
  private var wholes = 0
  private var bytes = 0L
  private var nanos = 0L

  /** The journal as last written (the snapshot with its log applied), or null without a readable one. */
  @Suppress("UNCHECKED_CAST")
  fun load(): Map<String, Any?>? {
    // An unreadable journal (never expected: writes are atomic) must not crash every launch.
    val snapshot = if (journal.isFile) runCatching {
      FileInputStream(journal).use { ObjectInputStream(it).readObject() } as Map<String, Any?>
    }.getOrNull() else null
    snapshot ?: return null
    val jobs = LinkedHashMap<String, MutableMap<String, Any?>>()
    for ((id, job) in snapshot["jobs"] as? Map<String, Any?> ?: emptyMap()) jobs[id] = LinkedHashMap(job as Map<String, Any?>)
    var policy = snapshot["libraryPolicy"]
    var budgetClock = snapshot["budgetClock"]
    val records = readLog()
    if ((records.firstOrNull()?.get("epoch") as? Number)?.toLong() == ((snapshot["epoch"] as? Number)?.toLong() ?: 0L)) {
      for (record in records.drop(1)) {
        for (id in record["removed"] as? List<String> ?: emptyList()) jobs.remove(id)
        for ((id, change) in record["jobs"] as? Map<String, Map<String, Any?>> ?: emptyMap()) {
          val job = jobs.getOrPut(id) { LinkedHashMap() }
          job.putAll(change["set"] as? Map<String, Any?> ?: emptyMap())
          for (key in change["unset"] as? List<String> ?: emptyList()) job.remove(key)
        }
        (record["order"] as? List<String>)?.let { order ->
          val reordered = LinkedHashMap<String, MutableMap<String, Any?>>()
          for (id in order) jobs[id]?.let { reordered[id] = it }
          for ((id, job) in jobs) if (id !in reordered) reordered[id] = job
          jobs.clear(); jobs.putAll(reordered)
        }
        if (record.containsKey("libraryPolicy")) policy = record["libraryPolicy"]
        if (record.containsKey("budgetClock")) budgetClock = record["budgetClock"]
      }
    }
    return mapOf("jobs" to jobs, "libraryPolicy" to policy, "budgetClock" to budgetClock)
  }

  /**
   * Writes the journal: [jobs] (readers' immutable copies, in order), the library [policy] and the
   * [budgetClock]. Appends what changed since the last write, or writes it whole when that's due.
   */
  fun write(jobs: List<Map<String, Any?>>, policy: Map<String, Any?>, budgetClock: Long) {
    val started = System.nanoTime()
    val whole = wholeDue || logBytes >= maxOf(MIN_LOG_BYTES, snapshotBytes)
    val count = if (whole) writeWhole(jobs, policy, budgetClock) else append(jobs, policy, budgetClock)
    synchronized(statsLock) { writes++; if (whole) wholes++; bytes += count; nanos += System.nanoTime() - started }
  }

  /** What writing cost since the last call: writes, whole ones, bytes and time ([JournalWrites], without its span). */
  fun takeStats(spanMs: Long): JournalWrites = synchronized(statsLock) {
    JournalWrites(writes, wholes, bytes, nanos / 1_000_000, spanMs).also { writes = 0; wholes = 0; bytes = 0; nanos = 0 }
  }

  private fun writeWhole(jobs: List<Map<String, Any?>>, policy: Map<String, Any?>, budgetClock: Long): Long {
    val next = epoch + 1
    val all = LinkedHashMap<String, Any?>()
    for (job in jobs) all[job["id"] as String] = job
    // A failure from here on leaves the next write whole, whichever file it stopped at.
    wholeDue = true
    val snapshot = serialize(mapOf("jobs" to all, "libraryPolicy" to policy, "budgetClock" to budgetClock, "epoch" to next))
    replace(journal, snapshot)
    epoch = next
    val header = frame(serialize(mapOf("epoch" to next)))
    replace(changes, header)
    wholeDue = false
    snapshotBytes = snapshot.size.toLong(); logBytes = header.size.toLong()
    written.clear(); for (job in jobs) written[job["id"] as String] = job
    writtenOrder = jobs.map { it["id"] as String }; writtenPolicy = policy
    return snapshotBytes + logBytes
  }

  private fun append(jobs: List<Map<String, Any?>>, policy: Map<String, Any?>, budgetClock: Long): Long {
    val ids = jobs.map { it["id"] as String }
    val present = ids.toHashSet()
    val removed = writtenOrder.filter { it !in present }
    val changed = LinkedHashMap<String, Any?>()
    for (job in jobs) {
      val id = job["id"] as String
      val before = written[id]
      if (before === job) continue
      if (before == null) { changed[id] = linkedMapOf("set" to job); continue }
      val set = LinkedHashMap<String, Any?>()
      for ((key, value) in job) if (!before.containsKey(key) || before[key] != value) set[key] = value
      val unset = before.keys.filter { !job.containsKey(it) }
      if (set.isNotEmpty() || unset.isNotEmpty()) changed[id] = linkedMapOf("set" to set, "unset" to ArrayList(unset))
    }
    // New jobs go to the end as they're applied; the whole order only when that isn't it.
    val kept = writtenOrder.filter { it in present }.toHashSet()
    val expected = writtenOrder.filter { it in present } + ids.filter { it !in kept }
    val record = LinkedHashMap<String, Any?>()
    record["budgetClock"] = budgetClock
    if (changed.isNotEmpty()) record["jobs"] = changed
    if (removed.isNotEmpty()) record["removed"] = ArrayList(removed)
    if (expected != ids) record["order"] = ArrayList(ids)
    if (policy != writtenPolicy) record["libraryPolicy"] = policy
    val framed = frame(serialize(record))
    try {
      FileOutputStream(changes, true).use { output -> output.write(framed); output.fd.sync() }
    } catch (error: java.io.IOException) {
      // A record cut short ends the log there: the next write starts afresh, whole.
      wholeDue = true; throw error
    }
    logBytes += framed.size
    for (job in jobs) written[job["id"] as String] = job
    for (id in removed) written.remove(id)
    writtenOrder = ids; writtenPolicy = policy
    return framed.size.toLong()
  }

  @Suppress("UNCHECKED_CAST")
  private fun readLog(): List<Map<String, Any?>> {
    if (!changes.isFile) return emptyList()
    val records = mutableListOf<Map<String, Any?>>()
    runCatching {
      DataInputStream(FileInputStream(changes).buffered()).use { input ->
        while (true) {
          val length = try { input.readInt() } catch (_: EOFException) { break }
          val crc = input.readInt()
          if (length < 0 || length > MAX_RECORD_BYTES) break
          val bytes = ByteArray(length)
          input.readFully(bytes)
          if (CRC32().apply { update(bytes) }.value.toInt() != crc) break
          records += ObjectInputStream(ByteArrayInputStream(bytes)).use { it.readObject() } as Map<String, Any?>
        }
      }
    }
    return records
  }

  private fun serialize(value: Map<String, Any?>): ByteArray {
    val bytes = ByteArrayOutputStream()
    ObjectOutputStream(bytes).use { it.writeObject(LinkedHashMap(value)) }
    return bytes.toByteArray()
  }

  private fun frame(payload: ByteArray): ByteArray =
    ByteBuffer.allocate(8 + payload.size).putInt(payload.size).putInt(CRC32().apply { update(payload) }.value.toInt()).put(payload).array()

  private fun replace(file: File, bytes: ByteArray) {
    file.parentFile?.mkdirs()
    val temp = File(file.path + ".tmp")
    FileOutputStream(temp).use { output -> output.write(bytes); output.fd.sync() }
    Files.move(temp.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
  }

  companion object {
    /** The log is compacted into a new snapshot once it's past this and the snapshot's own size. */
    const val MIN_LOG_BYTES = 256L * 1024
    /** A length past this is a damaged record, not one to read. */
    private const val MAX_RECORD_BYTES = 64 shl 20
    /** The files a journal at [journal] keeps: its snapshot and its log (a copy of both is a copy of the journal). */
    fun files(journal: File): List<File> = listOf(journal, File(journal.path + ".log"))
  }
}
