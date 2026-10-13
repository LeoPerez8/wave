package expo.modules.wavenative.download

import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.ObjectInputStream
import java.io.ObjectOutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.util.UUID

interface DurableTransfer {
  fun receive(id: String, candidate: Map<String, Any?>, source: File, durationMs: Long, progress: (Long, Long, Long?) -> Unit): Map<String, Any?>
  fun cancel(id: String)
}

interface DurablePublication {
  fun tag(source: File, tags: Map<String, Any?>)
  fun index(file: File): Map<String, Any?>
}

/** A process-owned journal. Bridge replies are leased decisions, never the queue's owner. */
class DurableDownloads(private val journal: File, private val clock: () -> Long = System::currentTimeMillis) {
  private val jobs = LinkedHashMap<String, MutableMap<String, Any?>>()
  private var policy = mutableMapOf<String, Any?>("roots" to emptyList<String>(), "excluded" to emptyList<String>(), "revision" to 0L)
  @Volatile private var stopped = false
  @Volatile private var activeTransfer: String? = null

  init {
    if (journal.isFile) {
      @Suppress("UNCHECKED_CAST")
      val saved = ObjectInputStream(FileInputStream(journal)).use { it.readObject() } as Map<String, Any?>
      for ((id, job) in saved.map("jobs")) {
        @Suppress("UNCHECKED_CAST")
        val record = job as Map<String, Any?>
        jobs[id] = record.toMutableMap()
      }
      policy = saved.map("libraryPolicy").toMutableMap()
      // A socket cannot survive process recreation. Counts and absolute deadlines do.
      for (job in jobs.values) if (job["phase"] == "transferring") {
        cleanup(job)
        job["generation"] = job.number("generation") + 1
        job["phase"] = "prepared"
        job["resumeAttemptDeadline"] = job["attemptDeadline"]
        job["resumeQueueDeadline"] = job["queueDeadline"]
      }
      persist()
    }
  }

  @Synchronized fun snapshot(): List<Map<String, Any?>> = jobs.values.map { it.toMap() }

  @Synchronized fun enqueue(song: Map<String, Any?>, equivalentId: String?, recording: Map<String, Any?> = emptyMap()): String {
    val id = song["videoId"] as String
    val existing = jobs.values.firstOrNull { it["id"] == id || it.maps("aliases").any { alias -> alias["videoId"] == id } }
      ?: equivalentId?.let { jobs[it] }?.takeIf { it["phase"] !in TERMINAL && it["importFailure"] == null }
    if (existing != null) {
      val deletedCompletion = existing["acknowledged"] == true && !(existing.map("saved")["path"] as? String)?.let { File(it).isFile }.orFalse()
      if (existing["phase"] == "failed" || existing["phase"] == "cancelled" || existing["importFailure"] != null || deletedCompletion) {
        existing["generation"] = existing.number("generation") + 1
        existing.remove("token"); existing.remove("reason"); existing.remove("importFailure")
        existing["decisionAttempts"] = 0L; existing["deadline"] = clock() + JOB_MS
        if (deletedCompletion) {
          for (key in listOf("saved", "acknowledged", "finalPath", "digest", "publishSource")) existing.remove(key)
        }
        if (existing["saved"] != null) existing["phase"] = "completed"
        else if ((existing["finalPath"] as? String)?.let { File(it).isFile } == true) {
          existing["phase"] = "awaitingPublication"; existing["publicationAttempts"] = 0L
        } else {
          cleanup(existing)
          for (key in listOf("finalPath", "digest", "publishSource")) existing.remove(key)
          existing["phase"] = "queued"; existing["attempts"] = 0L; existing["candidateIndex"] = 0L
        }
      } else if (existing.map("song")["videoId"] != id && existing.maps("aliases").none { it["videoId"] == id }) {
        existing["aliases"] = existing.maps("aliases") + clean(song)
      }
      persist()
      return existing["id"] as String
    }
    jobs[id] = mutableMapOf(
      "id" to id, "song" to clean(song), "recording" to clean(recording), "generation" to 1L, "phase" to "queued", "policy" to "mp3-320",
      "createdAt" to clock(), "deadline" to clock() + JOB_MS, "decisionAttempts" to 0L,
      "aliases" to emptyList<Map<String, Any?>>(), "attempts" to 0L, "candidateIndex" to 0L,
    )
    persist()
    return id
  }

  @Synchronized fun claim(id: String): Map<String, Any?>? {
    val job = jobs[id] ?: return null
    if (job["phase"] !in DECISIONS || job["token"] != null || job["acknowledged"] == true || job["importFailure"] != null || job.number("retryAt") > clock()) return null
    if (job.number("deadline") <= clock()) { fail(job, "failed"); persist(); return null }
    job["decisionAttempts"] = job.number("decisionAttempts") + 1
    job["token"] = UUID.randomUUID().toString()
    job["leaseUntil"] = minOf(clock() + LEASE_MS, job.number("deadline"))
    persist()
    return job.toMap() + ("decision" to DECISIONS[job["phase"]])
  }

  @Synchronized fun submit(id: String, generation: Long, token: String, decision: String, payload: Map<String, Any?>): Boolean {
    val job = jobs[id] ?: return false
    if (job.number("generation") != generation || job["token"] != token || job.number("leaseUntil") < clock() || DECISIONS[job["phase"]] != decision) return false
    if (payload["failure"] != null) {
      val reason = payload["failure"] as String
      if (decision == "import" && reason != "noFolder") {
        job.remove("token")
        job["retryAt"] = clock() + 2_000L
        if (job.number("decisionAttempts") >= MAX_DECISIONS) job["importFailure"] = reason
      } else fail(job, reason)
      persist(); return true
    }
    when (decision) {
      "prepare" -> {
        val candidates = payload.maps("candidates").take(3)
        require(candidates.isNotEmpty() && candidates.all { it.number("bitrateKbps") == 320L && (it["filename"] as? String)?.endsWith(".mp3", true) == true }) { "Only original MP3 320 candidates are supported" }
        val target = File(payload["targetPath"] as String)
        require(target.extension.equals("mp3", true))
        job["candidates"] = clean(candidates); job["tags"] = clean(payload.map("tags")); job["targetPath"] = target.path
        job["sourcePath"] = DownloadFiles.partFileFor(target, "$id-$generation").path
        transition(job, "prepared")
      }
      "confirm" -> {
        if (payload["receiptId"] != job["receiptId"]) return false
        if (payload["acceptable"] == true) transition(job, "tagging") else nextCandidate(job)
      }
      "publish" -> {
        if (payload.number("revision") != policy.number("revision")) { job.remove("token"); persist(); return false }
        val target = File(payload["targetPath"] as String)
        if (!included(target)) fail(job, "noFolder")
        else {
          job["targetPath"] = target.path; job["policyRevision"] = policy.number("revision")
          transition(job, "publishing")
        }
      }
      "import" -> {
        if (payload["path"] != job.map("saved")["path"] || !included(File(payload["path"] as String))) return false
        job["acknowledged"] = true; job.remove("token")
      }
      else -> return false
    }
    persist(); return true
  }

  @Synchronized fun refreshPolicy(roots: List<String>, excluded: List<String>): Long {
    if (policy["roots"] != roots || policy["excluded"] != excluded) {
      policy = mutableMapOf("roots" to roots.toList(), "excluded" to excluded.toList(), "revision" to policy.number("revision") + 1)
      persist()
    }
    return policy.number("revision")
  }

  @Synchronized fun hasWork(): Boolean = jobs.values.any { it["phase"] !in TERMINAL && !(it["phase"] == "completed" && (it["acknowledged"] == true || it["importFailure"] != null)) }

  fun startWork() { stopped = false }
  /** Stops socket work immediately, without waiting for an IO operation's journal lock. */
  fun stopWork(transport: DurableTransfer) { stopped = true; activeTransfer?.let(transport::cancel) }

  @Synchronized fun cancel(id: String, transport: DurableTransfer) {
    val job = jobs[id] ?: jobs.values.firstOrNull { it.maps("aliases").any { alias -> alias["videoId"] == id } } ?: return
    if (job["phase"] in listOf("publishing", "completed")) return
    job["phase"] = "cancelled"; job["generation"] = job.number("generation") + 1; job.remove("token")
    persist(); transport.cancel(job["id"] as String); cleanup(job)
  }

  /** Called by Android's deadline thread, including the dataSync timeout callback. */
  @Synchronized fun expire(transport: DurableTransfer, stopAll: Boolean = false) {
    for (job in jobs.values) {
      if (job["phase"] in TERMINAL || job["acknowledged"] == true || job["importFailure"] != null) continue
      if (stopAll || job.number("deadline") <= clock()) {
        if (job["phase"] == "completed") { job["importFailure"] = "failed"; job.remove("token") }
        else fail(job, "failed")
        transport.cancel(job["id"] as String)
      } else if (job["phase"] == "transferring" && (job.number("attemptDeadline") <= clock() || (job["queuePosition"] != null && job.number("queueDeadline") <= clock()))) {
        transport.cancel(job["id"] as String)
        nextCandidate(job)
        job["generation"] = job.number("generation") + 1
      } else if (job["token"] != null && job.number("leaseUntil") < clock()) {
        job.remove("token"); job["generation"] = job.number("generation") + 1
        if (job.number("decisionAttempts") >= MAX_DECISIONS) {
          if (job["phase"] == "completed") job["importFailure"] = "storage" else fail(job, "failed")
        }
      }
    }
    persist()
  }

  /** One serial native operation. Network IO runs outside the journal lock. */
  fun advance(transport: DurableTransfer, publication: DurablePublication) {
    if (stopped) return
    expire(transport)
    val work = synchronized(this) {
      val active = jobs.values.firstOrNull { it["phase"] !in TERMINAL && it["phase"] != "queued" && !(it["phase"] == "completed" && (it["acknowledged"] == true || it["importFailure"] != null)) }
      val job = active ?: jobs.values.firstOrNull { it["phase"] == "queued" } ?: return
      if (job.number("retryAt") > clock()) return
      if (job["phase"] == "queued") transition(job, "preparing")
      if (job["phase"] == "prepared") {
        if (job.number("attempts") >= MAX_ATTEMPTS || job.number("candidateIndex") >= job.maps("candidates").size) { fail(job, "unavailable"); persist(); return }
        if (job.number("resumeAttemptDeadline") in 1..clock() || job.number("resumeQueueDeadline") in 1..clock()) { nextCandidate(job); persist(); return }
        job["attempts"] = job.number("attempts") + 1
        job["sourcePath"] = DownloadFiles.partFileFor(File(job["targetPath"] as String), "${job["id"]}-${job["generation"]}-${job["attempts"]}").path
        job["peer"] = job.maps("candidates")[job.number("candidateIndex").toInt()]
        job["queuePosition"] = null; job["queueDeadline"] = job.remove("resumeQueueDeadline") ?: minOf(clock() + QUEUE_MS, job.number("deadline"))
        job["attemptDeadline"] = job.remove("resumeAttemptDeadline") ?: minOf(clock() + ATTEMPT_MS, job.number("deadline"))
        transition(job, "transferring")
      }
      persist(); job.toMap()
    }
    val id = work["id"] as String
    val generation = work.number("generation")
    try {
      when (work["phase"]) {
        "transferring" -> {
          val source = File(work["sourcePath"] as String)
          activeTransfer = id
          var lastProgressAt = 0L
          val durationMs = work.map("song").number("durationMs").takeIf { it > 0 } ?: work.map("peer").number("durationMs")
          val audio = transport.receive(id, work.map("peer"), source, durationMs) { received, total, queue ->
            synchronized(this) {
              val job = current(id, generation, "transferring") ?: return@synchronized
              job["received"] = received; job["total"] = total; job["queuePosition"] = queue
              if (queue != null && job.number("queueDeadline") <= clock()) transport.cancel(id)
              if (queue != null || received == total || clock() - lastProgressAt >= 500) { lastProgressAt = clock(); persist() }
            }
          }
          synchronized(this) {
            val job = current(id, generation, "transferring") ?: run { source.delete(); return }
            if (stopped) { cleanup(job); transition(job, "prepared"); persist(); return }
            job["audio"] = clean(audio); job["receiptId"] = UUID.randomUUID().toString(); transition(job, "sourceReady"); persist()
          }
        }
        "tagging" -> synchronized(this) {
          val job = current(id, generation, "tagging") ?: return
          publication.tag(File(work["sourcePath"] as String), work.map("tags"))
          if (stopped) return
          transition(job, "awaitingPublication"); persist()
        }
        "publishing" -> synchronized(this) {
          val job = current(id, generation, "publishing") ?: return
          if (stopped) return
          if (job.number("policyRevision") != policy.number("revision")) { transition(job, "awaitingPublication"); persist(); return }
          if (!included(File(job["targetPath"] as String))) { fail(job, "noFolder"); persist(); return }
          var source = File(job["sourcePath"] as String)
          if (job["finalPath"] == null) {
            val target = File(job["targetPath"] as String)
            target.parentFile.mkdirs()
            // A changed root requires a new hidden file on the destination filesystem.
            if (source.parentFile.canonicalFile != target.parentFile.canonicalFile) {
              val local = DownloadFiles.partFileFor(target, "$id-$generation-publication")
              job["outputPath"] = local.path; persist()
              FileInputStream(source).use { input -> FileOutputStream(local).use { out -> input.copyTo(out); out.fd.sync() } }
              source = local
            }
            var targetName = target
            var suffix = 2
            while (targetName.exists()) targetName = File(target.parentFile, "${target.nameWithoutExtension} (${suffix++}).mp3")
            job["finalPath"] = targetName.path; job["digest"] = digest(source); job["publishSource"] = source.path
            persist()
          }
          val final = File(job["finalPath"] as String)
          if (!included(final)) { fail(job, "noFolder"); persist(); return }
          if (!final.exists()) Files.move(File(job["publishSource"] as String).toPath(), final.toPath())
          check(digest(final) == job["digest"]) { "Publication path belongs to another file" }
          // Keep the chosen path and proof until scanner/outbox persistence succeeds.
          job["saved"] = clean(publication.index(final)); transition(job, "completed"); cleanup(job); persist()
        }
      }
    } catch (error: Exception) {
      synchronized(this) {
        val job = current(id, generation, work["phase"] as String) ?: return
        if (work["phase"] == "publishing" && job["finalPath"] != null && File(job["finalPath"] as String).isFile && job.number("publicationAttempts") < 3) {
          job["publicationAttempts"] = job.number("publicationAttempts") + 1
        } else if (work["phase"] == "transferring") {
          val reason = (error as? DurableFailure)?.reason ?: "unavailable"
          if (reason == "offline" && job.number("attempts") < MAX_ATTEMPTS) { cleanup(job); transition(job, "prepared"); job["retryAt"] = clock() + 2_000L * job.number("attempts") }
          else if (reason in listOf("account", "storage", "noFolder", "offline")) fail(job, reason)
          else nextCandidate(job)
        } else fail(job, "storage")
        persist()
      }
    } finally { if (activeTransfer == id) activeTransfer = null }
  }

  private fun current(id: String, generation: Long, phase: String): MutableMap<String, Any?>? = jobs[id]?.takeIf { it.number("generation") == generation && it["phase"] == phase }
  private fun transition(job: MutableMap<String, Any?>, phase: String) { job["phase"] = phase; job.remove("token"); job["decisionAttempts"] = 0L; job.remove("retryAt") }
  private fun nextCandidate(job: MutableMap<String, Any?>) {
    job.remove("resumeAttemptDeadline"); job.remove("resumeQueueDeadline")
    cleanup(job); job["candidateIndex"] = job.number("candidateIndex") + 1
    if (job.number("candidateIndex") >= job.maps("candidates").size || job.number("attempts") >= MAX_ATTEMPTS) fail(job, "unavailable") else transition(job, "prepared")
  }
  private fun fail(job: MutableMap<String, Any?>, reason: String) { job["reason"] = reason; transition(job, "failed"); job["generation"] = job.number("generation") + 1; cleanup(job) }
  private fun cleanup(job: Map<String, Any?>) { for (key in listOf("sourcePath", "outputPath")) (job[key] as? String)?.let { if (it != job["finalPath"]) File(it).delete() } }
  private fun included(file: File): Boolean {
    val path = file.canonicalFile.toPath()
    return policy.strings("roots").any { path.startsWith(File(it).canonicalFile.toPath()) } && !policy.strings("excluded").any { path.startsWith(File(it).canonicalFile.toPath()) }
  }

  private fun persist() {
    journal.parentFile?.mkdirs()
    val temp = File(journal.path + ".tmp")
    FileOutputStream(temp).use { output ->
      val stream = ObjectOutputStream(output)
      stream.writeObject(clean(mapOf("jobs" to jobs, "libraryPolicy" to policy)))
      stream.flush()
      output.fd.sync()
    }
    Files.move(temp.toPath(), journal.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
  }

  companion object {
    const val LEASE_MS = 45_000L
    const val JOB_MS = 12 * 60_000L
    const val QUEUE_MS = 120_000L
    const val ATTEMPT_MS = 180_000L
    const val MAX_ATTEMPTS = 6L
    const val MAX_DECISIONS = 3L
    private val TERMINAL = setOf("failed", "cancelled")
    private val DECISIONS = mapOf("preparing" to "prepare", "sourceReady" to "confirm", "awaitingPublication" to "publish", "completed" to "import")
  }
}

class DurableFailure(val reason: String, cause: Throwable? = null) : java.io.IOException(reason, cause)

private fun Map<String, Any?>.number(key: String): Long = (get(key) as? Number)?.toLong() ?: 0L
private fun Boolean?.orFalse(): Boolean = this ?: false
@Suppress("UNCHECKED_CAST")
private fun Map<String, Any?>.map(key: String): Map<String, Any?> = get(key) as? Map<String, Any?> ?: emptyMap()
@Suppress("UNCHECKED_CAST")
private fun Map<String, Any?>.maps(key: String): List<Map<String, Any?>> = get(key) as? List<Map<String, Any?>> ?: emptyList()
@Suppress("UNCHECKED_CAST")
private fun Map<String, Any?>.strings(key: String): List<String> = get(key) as? List<String> ?: emptyList()

private fun digest(file: File): String {
  val sha = MessageDigest.getInstance("SHA-256")
  file.inputStream().use { input -> val buffer = ByteArray(64 * 1024); while (true) { val count = input.read(buffer); if (count < 0) break; sha.update(buffer, 0, count) } }
  return sha.digest().joinToString("") { "%02x".format(it) }
}

/** Persist only standard JDK maps/lists/scalars; no app classes or credentials enter the journal. */
private fun clean(value: Any?): Any? = when (value) {
  is Map<*, *> -> HashMap<String, Any?>().apply { for ((key, item) in value) put(key as String, clean(item)) }
  is List<*> -> ArrayList(value.map(::clean))
  is String, is Number, is Boolean, null -> value
  else -> throw IllegalArgumentException("Unsupported persisted value")
}
