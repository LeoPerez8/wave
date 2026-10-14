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

/**
 * A process-owned journal. Bridge replies are leased decisions, never the queue's owner.
 *
 * Each job has a source (Core's `downloadSource`): `soulseek` (and jobs from before there was a
 * choice) transfers original MP3 320 from up to three peers in turn; `youtube` transfers the M4A
 * YouTube Music serves, from its one stream, started again when a transfer breaks off. The
 * transport receives the current candidate (`peer`), which says which source it's from.
 */
class DurableDownloads(private val journal: File, private val clock: () -> Long = System::currentTimeMillis) {
  private val jobs = LinkedHashMap<String, MutableMap<String, Any?>>()
  private var policy = mutableMapOf<String, Any?>("roots" to emptyList<String>(), "excluded" to emptyList<String>(), "revision" to 0L)
  @Volatile private var stopped = false
  @Volatile private var activeTransfer: String? = null
  /**
   * What readers see, copied whenever the journal changes. The notification reads it on the main
   * thread while the worker holds the lock for slow work (cover fetch, tag writing, publication).
   */
  @Volatile private var published: List<Map<String, Any?>> = emptyList()

  init {
    // An unreadable journal (never expected: writes are atomic) must not crash every launch.
    @Suppress("UNCHECKED_CAST")
    val saved = if (journal.isFile) runCatching {
      FileInputStream(journal).use { ObjectInputStream(it).readObject() } as Map<String, Any?>
    }.getOrNull() else null
    if (saved != null) {
      for ((id, job) in saved.map("jobs")) {
        @Suppress("UNCHECKED_CAST")
        val record = job as Map<String, Any?>
        jobs[id] = record.toMutableMap()
      }
      policy = saved.map("libraryPolicy").toMutableMap()
      // Imported and cancelled jobs have nothing left to show; failures keep Retry for a day.
      jobs.values.removeAll {
        it["phase"] == "cancelled" || it["acknowledged"] == true || (it["phase"] == "failed" && it.number("endedAt") + FORGET_FAILED_MS <= clock())
      }
      // A socket cannot survive process recreation. Counts and absolute deadlines do.
      for (job in jobs.values) if (job["phase"] == "transferring") {
        cleanup(job)
        job["generation"] = job.number("generation") + 1
        job["phase"] = "prepared"
        job["resumeAttemptDeadline"] = job["attemptDeadline"]
        job["resumeQueueDeadline"] = job["queueDeadline"]
      }
      // A full disk mustn't stop Wave or the download service from opening the journal: the
      // jobs stay in memory (and readable), and the next change that can be written saves them.
      try { persist() } catch (_: java.io.IOException) {}
    }
  }

  fun snapshot(): List<Map<String, Any?>> = published

  /**
   * Asks for [song], from the [source] Core decided for it (null when there's none, which the
   * prepare decision then reports). A Retry takes the source decided again.
   */
  @Synchronized fun enqueue(song: Map<String, Any?>, equivalentId: String?, recording: Map<String, Any?> = emptyMap(), source: String? = null): String {
    val id = song["videoId"] as String
    val existing = jobs.values.firstOrNull { it["id"] == id || it.maps("aliases").any { alias -> alias["videoId"] == id } }
      ?: equivalentId?.let { jobs[it] }?.takeIf { it["phase"] !in TERMINAL && it["importFailure"] == null }
    if (existing != null) {
      val deletedCompletion = existing["acknowledged"] == true && !(existing.map("saved")["path"] as? String)?.let { File(it).isFile }.orFalse()
      if (existing["phase"] == "failed" || existing["phase"] == "cancelled" || existing["importFailure"] != null || deletedCompletion) {
        existing["generation"] = existing.number("generation") + 1
        existing.remove("token"); existing.remove("reason"); existing.remove("importFailure")
        // Asked for again: it waits behind what's already queued.
        val key = existing["id"] as String
        jobs.remove(key); jobs[key] = existing
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
          setSource(existing, source)
        }
      } else if (existing.map("song")["videoId"] != id && existing.maps("aliases").none { it["videoId"] == id }) {
        existing["aliases"] = existing.maps("aliases") + clean(song)
      }
      persist()
      return existing["id"] as String
    }
    jobs[id] = mutableMapOf(
      "id" to id, "song" to clean(song), "recording" to clean(recording), "generation" to 1L, "phase" to "queued", "policy" to MP3_320,
      "createdAt" to clock(), "decisionAttempts" to 0L,
      "aliases" to emptyList<Map<String, Any?>>(), "attempts" to 0L, "candidateIndex" to 0L,
    )
    setSource(jobs.getValue(id), source)
    persist()
    return id
  }

  @Synchronized fun claim(id: String): Map<String, Any?>? {
    val job = jobs[id] ?: return null
    if (job["phase"] !in DECISIONS || job["token"] != null || job["acknowledged"] == true || job["importFailure"] != null || job.number("retryAt") > clock()) return null
    if (job.number("deadline") <= clock()) {
      // As in expire(): a published file is never a failed download, only one the Library didn't import.
      if (job["phase"] == "completed") job["importFailure"] = "failed" else fail(job, "failed")
      persist(); return null
    }
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
      if (decision == "prepare") keepFallback(job, payload)
      if (decision == "import" && reason != "noFolder") {
        job.remove("token")
        job["retryAt"] = clock() + 2_000L
        if (job.number("decisionAttempts") >= MAX_DECISIONS) job["importFailure"] = reason
      } else if (decision == "prepare" && retriesConnection(job, reason) && job.number("decisionAttempts") < MAX_DECISIONS) {
        // Searching reconnects the saved session; a dropped connection gets a few spaced retries.
        job.remove("token")
        job["retryAt"] = clock() + 5_000L * job.number("decisionAttempts")
      } else fail(job, reason)
      persist(); return true
    }
    when (decision) {
      "prepare" -> {
        val target = (payload["targetPath"] as? String)?.let(::File)
        val source = payload["source"] as? String ?: job["source"] as? String ?: SOULSEEK
        setSource(job, source)
        keepFallback(job, payload)
        val candidates = if (source == YOUTUBE) {
          // YouTube's audio is saved as the M4A it serves, never re-encoded.
          if (target == null || !target.extension.equals("m4a", true)) { fail(job, "failed"); persist(); return true }
          youtubeCandidates(job)
        } else {
          val candidates = payload.maps("candidates").take(3)
          // Only original MP3 320 is eligible; anything else is no recording rather than a lower one.
          if (target == null || !target.extension.equals("mp3", true) || candidates.isEmpty() ||
            !candidates.all { it.number("bitrateKbps") == 320L && (it["filename"] as? String)?.endsWith(".mp3", true) == true }
          ) { fail(job, "unavailable"); persist(); return true }
          candidates
        }
        job["candidates"] = clean(candidates); job["tags"] = clean(payload.map("tags")); job["targetPath"] = target.path
        job["sourcePath"] = DownloadFiles.partFileFor(target, "$id-$generation").path
        transition(job, "prepared")
      }
      "confirm" -> {
        if (payload["receiptId"] != job["receiptId"]) return false
        // YouTube serves the same stream again: audio of another length means it won't serve the song.
        if (payload["acceptable"] == true) transition(job, "tagging")
        else if (job["source"] == YOUTUBE) fail(job, "ytUnavailable")
        else nextCandidate(job)
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

  fun hasWork(): Boolean = published.any(::pending)

  /** How many songs are still to download, the current one included; the notification counts them. */
  fun pendingCount(): Int = published.count(::pending)

  /** The job the serial worker is on, else the next one waiting; what the notification shows. */
  fun current(): Map<String, Any?>? = next(published)

  private fun pending(job: Map<String, Any?>) = job["phase"] !in TERMINAL && !(job["phase"] == "completed" && (job["acknowledged"] == true || job["importFailure"] != null))
  private fun next(): MutableMap<String, Any?>? = next(jobs.values)
  private fun <M : Map<String, Any?>> next(all: Collection<M>): M? =
    all.firstOrNull { it["phase"] != "queued" && pending(it) } ?: all.firstOrNull { it["phase"] == "queued" }

  fun startWork() { stopped = false }
  /** Stops socket work immediately, without waiting for an IO operation's journal lock. */
  fun stopWork(transport: DurableTransfer) { stopped = true; activeTransfer?.let(transport::cancel) }

  /**
   * Whether [id]'s transfer still has its turn: it is the job's current step and within its start,
   * queue and stall deadlines. The transport polls this, so a transfer never outlives those rules,
   * even when a cancel arrives before the transfer is registered. Reads the published copy.
   */
  fun transferWanted(id: String): Boolean {
    if (stopped) return false
    val job = published.firstOrNull { it["id"] == id } ?: return false
    return job["phase"] == "transferring" && job.number("attemptDeadline") > clock() &&
      (job["queuePosition"] == null || job.number("queueDeadline") > clock())
  }

  /**
   * A row's Cancel Download for [videoId]: only that requester leaves a shared job. The download
   * itself is cancelled once nobody else asked for it.
   */
  @Synchronized fun cancel(videoId: String, transport: DurableTransfer) {
    val job = jobs.values.firstOrNull { it.map("song")["videoId"] == videoId || it.maps("aliases").any { alias -> alias["videoId"] == videoId } } ?: return
    if (!cancellable(job)) return
    val aliases = job.maps("aliases")
    if (aliases.isEmpty()) { end(job, transport); return }
    if (job.map("song")["videoId"] == videoId) { job["song"] = aliases.first(); job["aliases"] = aliases.drop(1) }
    else job["aliases"] = aliases.filter { it["videoId"] != videoId }
    persist()
  }

  /** The notification's Cancel: stops job [id] for every requester. */
  @Synchronized fun cancelJob(id: String, transport: DurableTransfer) {
    val job = jobs[id] ?: return
    if (cancellable(job)) end(job, transport)
  }

  /**
   * Too late while publishing or importing. A published file the Library couldn't import shows as a
   * failure with Cancel: cancelling forgets the row and leaves the file in the Library folder.
   */
  private fun cancellable(job: Map<String, Any?>) =
    job["phase"] != "publishing" && !(job["phase"] == "completed" && job["importFailure"] == null)

  private fun end(job: MutableMap<String, Any?>, transport: DurableTransfer) {
    job["phase"] = "cancelled"; job["generation"] = job.number("generation") + 1; job.remove("token")
    persist(); transport.cancel(job["id"] as String); cleanup(job)
  }

  /** Called by Android's deadline thread, including the dataSync timeout callback. */
  @Synchronized fun expire(transport: DurableTransfer, stopAll: Boolean = false) {
    for (job in jobs.values) {
      if (job["phase"] in TERMINAL || job["acknowledged"] == true || job["importFailure"] != null) continue
      // A queued job's time starts when the serial worker reaches it.
      if (job["phase"] == "queued") continue
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
      val job = next() ?: return
      if (job.number("retryAt") > clock()) return
      if (job["phase"] == "queued") { job["deadline"] = clock() + JOB_MS; transition(job, "preparing") }
      if (job["phase"] == "prepared") {
        if (job.number("attempts") >= MAX_ATTEMPTS || job.number("candidateIndex") >= job.maps("candidates").size) { fail(job, exhausted(job)); persist(); return }
        if (job.number("resumeAttemptDeadline") in 1..clock() || job.number("resumeQueueDeadline") in 1..clock()) { nextCandidate(job); persist(); return }
        job["attempts"] = job.number("attempts") + 1
        job["sourcePath"] = DownloadFiles.partFileFor(File(job["targetPath"] as String), "${job["id"]}-${job["generation"]}-${job["attempts"]}").path
        job["peer"] = job.maps("candidates")[job.number("candidateIndex").toInt()]
        job.remove("received"); job.remove("total")
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
              val job = held(id, generation, "transferring") ?: return@synchronized
              // Arriving bytes keep a slow peer's turn; one that goes quiet for STALL_MS is replaced.
              if (received > job.number("received")) job["attemptDeadline"] = minOf(clock() + STALL_MS, job.number("deadline"))
              job["received"] = received; job["total"] = total; job["queuePosition"] = queue
              if (queue != null && job.number("queueDeadline") <= clock()) transport.cancel(id)
              if (queue != null || received == total || clock() - lastProgressAt >= 500) { lastProgressAt = clock(); persist() } else publish()
            }
          }
          synchronized(this) {
            val job = held(id, generation, "transferring") ?: run { source.delete(); return }
            if (stopped) { cleanup(job); transition(job, "prepared"); persist(); return }
            job["audio"] = clean(audio); job["receiptId"] = UUID.randomUUID().toString(); transition(job, "sourceReady"); persist()
          }
        }
        "tagging" -> synchronized(this) {
          val job = held(id, generation, "tagging") ?: return
          publication.tag(File(work["sourcePath"] as String), work.map("tags"))
          if (stopped) return
          transition(job, "awaitingPublication"); persist()
        }
        "publishing" -> synchronized(this) {
          val job = held(id, generation, "publishing") ?: return
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
            while (targetName.exists()) targetName = File(target.parentFile, "${target.nameWithoutExtension} (${suffix++}).${target.extension}")
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
        val job = held(id, generation, work["phase"] as String) ?: return
        if (work["phase"] == "publishing" && job["finalPath"] != null && File(job["finalPath"] as String).isFile && job.number("publicationAttempts") < 3) {
          job["publicationAttempts"] = job.number("publicationAttempts") + 1
        } else if (work["phase"] == "transferring") {
          val reason = (error as? DurableFailure)?.reason ?: "unavailable"
          // The service stopping isn't the peer's fault: the next start retries the same peer.
          if (stopped) { cleanup(job); transition(job, "prepared"); job["attempts"] = maxOf(0L, job.number("attempts") - 1) }
          else if (retriesConnection(job, reason) && job.number("attempts") < MAX_ATTEMPTS) { cleanup(job); transition(job, "prepared"); job["retryAt"] = clock() + 2_000L * job.number("attempts") }
          else if (reason in listOf("account", "accountRejected", "storage", "noFolder", "offline", "unreachable", "noSource", "ytUnavailable")) fail(job, reason)
          else nextCandidate(job)
        } else fail(job, "storage")
        persist()
      }
    } finally { if (activeTransfer == id) activeTransfer = null }
  }

  private fun held(id: String, generation: Long, phase: String): MutableMap<String, Any?>? = jobs[id]?.takeIf { it.number("generation") == generation && it["phase"] == phase }
  private fun transition(job: MutableMap<String, Any?>, phase: String) { job["phase"] = phase; job.remove("token"); job["decisionAttempts"] = 0L; job.remove("retryAt") }
  /** The next peer, or for YouTube its one stream again; failing once there's none left to try. */
  private fun nextCandidate(job: MutableMap<String, Any?>) {
    job.remove("resumeAttemptDeadline"); job.remove("resumeQueueDeadline")
    cleanup(job)
    if (job["source"] != YOUTUBE) job["candidateIndex"] = job.number("candidateIndex") + 1
    if (job.number("candidateIndex") >= job.maps("candidates").size || job.number("attempts") >= MAX_ATTEMPTS) fail(job, exhausted(job)) else transition(job, "prepared")
  }
  /** Soulseek ran out of peers with the recording in 320 kbps; YouTube's stream kept breaking off. */
  private fun exhausted(job: Map<String, Any?>) = if (job["source"] == YOUTUBE) "failed" else "unavailable"
  private fun setSource(job: MutableMap<String, Any?>, source: String?) {
    if (source == null) return
    job["source"] = source; job["policy"] = if (source == YOUTUBE) YOUTUBE_M4A else MP3_320
  }
  private fun youtubeCandidates(job: Map<String, Any?>) = listOf(mapOf("source" to YOUTUBE, "videoId" to job.map("song")["videoId"]))

  /**
   * Keeps what a Soulseek job's prepare answer says about YouTube Music (Core's
   * `downloadFallbackFailures`): the failures that hand the job over, and the M4A's place. The
   * tags come with a failed answer too, so a job that never found a peer can still fall back.
   */
  private fun keepFallback(job: MutableMap<String, Any?>, payload: Map<String, Any?>) {
    val fallback = payload.map("fallback")
    if (job["source"] != YOUTUBE && fallback["source"] == YOUTUBE && (fallback["targetPath"] as? String)?.endsWith(".m4a", true) == true) {
      job["fallback"] = clean(fallback)
    } else job.remove("fallback")
    if (payload["tags"] != null) job["tags"] = clean(payload.map("tags"))
  }

  /**
   * A lost connection gets a few spaced retries: being offline always, Soulseek's server not
   * answering only when there's no YouTube Music to carry on from at once.
   */
  private fun retriesConnection(job: Map<String, Any?>, reason: String) =
    reason == "offline" || (reason == "unreachable" && !fallsBack(job, reason))

  /** Whether Soulseek failing [job] with [reason] hands it over to YouTube Music. */
  private fun fallsBack(job: Map<String, Any?>, reason: String) =
    job["source"] != YOUTUBE && job["phase"] in ACQUIRING && reason in job.map("fallback").strings("failures")

  /**
   * Carries [job] on from YouTube Music when Soulseek's [reason] is one Core hands over: the same
   * job and row, with YouTube's M4A as the target and a time budget of its own. The plan is used
   * up, so YouTube's own failure ends the job; Retry starts again from Soulseek.
   */
  private fun fallBack(job: MutableMap<String, Any?>, reason: String): Boolean {
    if (!fallsBack(job, reason)) return false
    val fallback = job.map("fallback")
    cleanup(job)
    for (key in listOf("fallback", "peer", "audio", "receiptId", "received", "total", "queuePosition", "queueDeadline", "attemptDeadline", "resumeAttemptDeadline", "resumeQueueDeadline")) job.remove(key)
    setSource(job, YOUTUBE)
    job["fellBackFrom"] = reason
    job["targetPath"] = fallback["targetPath"]
    job["candidates"] = youtubeCandidates(job); job["candidateIndex"] = 0L; job["attempts"] = 0L
    job["deadline"] = clock() + JOB_MS
    job["generation"] = job.number("generation") + 1
    transition(job, "prepared")
    return true
  }

  /** Every way a job fails goes through here, which is where Soulseek's failures fall back. */
  private fun fail(job: MutableMap<String, Any?>, reason: String) {
    if (fallBack(job, reason)) return
    // YT Music was turned off before YouTube could take over: Soulseek's failure stands.
    job["reason"] = if (reason == "noSource") job["fellBackFrom"] as? String ?: reason else reason
    job["endedAt"] = clock(); transition(job, "failed"); job["generation"] = job.number("generation") + 1; cleanup(job)
  }
  private fun cleanup(job: Map<String, Any?>) { for (key in listOf("sourcePath", "outputPath")) (job[key] as? String)?.let { if (it != job["finalPath"]) File(it).delete() } }
  private fun included(file: File): Boolean {
    val path = file.canonicalFile.toPath()
    return policy.strings("roots").any { path.startsWith(File(it).canonicalFile.toPath()) } && !policy.strings("excluded").any { path.startsWith(File(it).canonicalFile.toPath()) }
  }

  @Suppress("UNCHECKED_CAST")
  private fun publish() { published = jobs.values.map { clean(it) as Map<String, Any?> } }

  private fun persist() {
    publish()
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
    /** A job's whole budget from leaving the queue: search, peers' queues, transfers and saving. */
    const val JOB_MS = 20 * 60_000L
    /** How long one peer may keep us in its upload queue. */
    const val QUEUE_MS = 120_000L
    /** How long one peer has to start sending. */
    const val ATTEMPT_MS = 180_000L
    /** How long a sending peer may go quiet. */
    const val STALL_MS = 60_000L
    const val MAX_ATTEMPTS = 6L
    const val MAX_DECISIONS = 3L
    const val FORGET_FAILED_MS = 24 * 60 * 60_000L
    const val SOULSEEK = "soulseek"
    const val YOUTUBE = "youtube"
    /** What a job saves: Soulseek's original MP3 320, or YouTube's M4A as served. */
    private const val MP3_320 = "mp3-320"
    private const val YOUTUBE_M4A = "youtube-m4a"
    private val TERMINAL = setOf("failed", "cancelled")
    /** Until the audio is accepted; afterwards a failure is the save's, which YouTube would share. */
    private val ACQUIRING = setOf("preparing", "prepared", "transferring", "sourceReady")
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

/** Persist only standard JDK maps (in order)/lists/scalars; no app classes or credentials enter the journal. */
private fun clean(value: Any?): Any? = when (value) {
  is Map<*, *> -> LinkedHashMap<String, Any?>().apply { for ((key, item) in value) put(key as String, clean(item)) }
  is List<*> -> ArrayList(value.map(::clean))
  is String, is Number, is Boolean, null -> value
  else -> throw IllegalArgumentException("Unsupported persisted value")
}
