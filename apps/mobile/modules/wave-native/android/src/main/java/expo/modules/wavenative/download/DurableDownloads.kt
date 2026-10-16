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
 *
 * What a failure leads to (trying again, the next peer, the end of the job, YouTube Music) is
 * Core's `downloadFailurePlan` for the job's source, which the prepare answer brings
 * (`failurePlan`). The journal only carries it out, with its own counts and deadlines.
 *
 * Every failure keeps what actually went wrong as the job's `cause` (an exception's class and
 * message, or what JS reported with its answer) and writes it to [log]. The reason stays one of
 * Core's failures; `storage` only for a real storage problem (`DownloadFiles.storageProblem`).
 *
 * Up to [slots] songs download at once, in the order they were asked for; the next one starts as
 * one of them frees its slot. A song that waits (in a peer's queue, for a pause before trying
 * again, or for JS's answer longer than [DECISION_WAIT_MS]) doesn't hold a slot, so it never
 * holds up the songs behind it; at most twice [slots] are started at once all the same. Saving to
 * the Library goes one song at a time: the publish and import decisions, and publication itself.
 */
class DurableDownloads(
  private val journal: File,
  private val clock: () -> Long = System::currentTimeMillis,
  private val log: (String) -> Unit = {},
  private val slots: Int = SLOTS,
) {
  private val jobs = LinkedHashMap<String, MutableMap<String, Any?>>()
  private var policy = mutableMapOf<String, Any?>("roots" to emptyList<String>(), "excluded" to emptyList<String>(), "revision" to 0L)
  @Volatile private var stopped = false
  /** The jobs a worker is on (under the lock), so no job's step ever runs twice at once. */
  private val running = HashSet<String>()
  /** The transfers under way, which [stopWork] cancels without the lock. */
  private val transfers = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()
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
      // Imported and cancelled jobs have nothing left to show; a failure keeps Retry until it's
      // retried or cleared (Settings › Downloads cancels it).
      jobs.values.removeAll { it["phase"] == "cancelled" || it["acknowledged"] == true }
      // A socket cannot survive process recreation. Counts and absolute deadlines do: a peer keeps
      // what was left of its turn. YouTube's stream starts over from byte 0 at an address resolved
      // afresh, so its transfer gets a whole window again, within the job's own deadline.
      for (job in jobs.values) if (job["phase"] == "transferring") {
        cleanup(job)
        job["generation"] = job.number("generation") + 1
        job["phase"] = "prepared"
        if (job["source"] != YOUTUBE) {
          job["resumeAttemptDeadline"] = job["attemptDeadline"]
          job["resumeQueueDeadline"] = job["queueDeadline"]
        }
      }
      // Prepared before the prepare answer brought a failure plan: it asks for one again.
      for (job in jobs.values) if (job["phase"] == "prepared" && job["failurePlan"] == null && job["fellBackFrom"] == null) {
        cleanup(job)
        for (key in listOf("candidates", "resumeAttemptDeadline", "resumeQueueDeadline")) job.remove(key)
        job["generation"] = job.number("generation") + 1
        transition(job, "preparing")
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
        existing.remove("token"); existing.remove("reason"); existing.remove("importFailure"); existing.remove("cause")
        // Retry starts again from the source decided now, Soulseek first while it has an account.
        existing.remove("fallback"); existing.remove("fellBackFrom"); existing.remove("video")
        // Asked for again: it waits behind what's already queued.
        val key = existing["id"] as String
        jobs.remove(key); jobs[key] = existing
        existing["decisionAttempts"] = 0L; existing["deadline"] = clock() + JOB_MS
        if (deletedCompletion) {
          for (key in listOf("saved", "acknowledged", "finalPath", "digest", "publishSource")) existing.remove(key)
        }
        if (existing["saved"] != null) existing["phase"] = "completed"
        // Only while the file there is still this download's: one replaced since downloads again.
        else if ((existing["finalPath"] as? String)?.let { File(it).isFile && digest(File(it)) == existing["digest"] } == true) {
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
    // Songs join the Library one at a time: the next is offered once the one before is imported.
    if (job["phase"] == "awaitingPublication" && jobs.values.any { it !== job && saving(it) }) return null
    if (job.number("deadline") <= clock()) {
      // As in expire(): a published file is never a failed download, only one the Library didn't import.
      val cause = "Out of time before the ${DECISIONS[job["phase"]]} decision"
      if (job["phase"] == "completed") importFailed(job, "failed", cause) else fail(job, "timedOut", cause)
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
      // What JS saw go wrong; a failure it decided on (no folder, no source) comes without one.
      val cause = payload["cause"] as? String
      if (decision == "prepare") keepPlans(job, payload)
      if (decision == "import" && reason != "noFolder") {
        job.remove("token")
        job["retryAt"] = clock() + 2_000L
        if (cause != null) recordCause(job, reason, cause)
        if (job.number("decisionAttempts") >= MAX_DECISIONS) importFailed(job, reason, cause)
      } else if (decision == "prepare" && reason in plan(job).strings("retry") && job.number("decisionAttempts") < MAX_DECISIONS) {
        // Searching reconnects the saved session; a dropped connection gets a few spaced retries.
        job.remove("token")
        job["retryAt"] = clock() + 5_000L * job.number("decisionAttempts")
        if (cause != null) recordCause(job, reason, cause)
      } else fail(job, reason, cause)
      persist(); return true
    }
    when (decision) {
      "prepare" -> {
        val target = (payload["targetPath"] as? String)?.let(::File)
        val source = payload["source"] as? String ?: job["source"] as? String ?: SOULSEEK
        setSource(job, source)
        keepPlans(job, payload)
        // An answer with nothing the job may download leaves it nothing to try.
        val candidates = if (source == YOUTUBE) {
          // YouTube's audio is saved as the M4A it serves, never re-encoded.
          if (target == null || !target.extension.equals("m4a", true)) { fail(job, exhausted(job)); persist(); return true }
          youtubeCandidates(job)
        } else {
          val candidates = payload.maps("candidates").take(3)
          // Only original MP3 320 is eligible; anything else is no recording rather than a lower one.
          if (target == null || !target.extension.equals("mp3", true) || candidates.isEmpty() ||
            !candidates.all { it.number("bitrateKbps") == 320L && (it["filename"] as? String)?.endsWith(".mp3", true) == true }
          ) { fail(job, exhausted(job)); persist(); return true }
          candidates
        }
        job["candidates"] = clean(candidates); job["tags"] = clean(payload.map("tags")); job["targetPath"] = target.path
        job["sourcePath"] = DownloadFiles.partFileFor(target, "$id-$generation").path
        transition(job, "prepared")
      }
      "confirm" -> {
        if (payload["receiptId"] != job["receiptId"]) return false
        if (payload["acceptable"] == true) transition(job, "tagging")
        else plan(job)["rejected"]?.let { fail(job, it as String) } ?: nextCandidate(job)
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

  /** The songs started and not yet in the Library, and those still waiting to start; the notification shows both. */
  fun counts(): DownloadCounts {
    val all = published
    val left = all.count { it["phase"] == "queued" }
    return DownloadCounts(running = all.count(::pending) - left, left = left)
  }

  /** The first song started, else the next one waiting; what the notification shows. */
  fun current(): Map<String, Any?>? =
    published.firstOrNull { it["phase"] != "queued" && pending(it) } ?: published.firstOrNull { it["phase"] == "queued" }

  private fun pending(job: Map<String, Any?>) = job["phase"] !in TERMINAL && !(job["phase"] == "completed" && (job["acknowledged"] == true || job["importFailure"] != null))

  /** Between its publish decision and its import: what only one song does at a time. */
  private fun saving(job: Map<String, Any?>) = pending(job) &&
    (job["phase"] == "publishing" || job["phase"] == "completed" || (job["phase"] == "awaitingPublication" && job["token"] != null))
  /** Started and not yet accepted and tagged: the part of a download that takes a slot. */
  private fun started(job: Map<String, Any?>) = job["phase"] in ACQUIRING || job["phase"] == "tagging"
  /** A started song that only waits for now, so it leaves its slot to the next one. */
  private fun waits(job: Map<String, Any?>) = job["queuePosition"] != null || job.number("retryAt") > clock() ||
    (job["phase"] in DECISIONS && clock() - job.number("phaseAt") >= DECISION_WAIT_MS)

  /** Starts queued songs, in order, while a slot is free. A song's time starts when it does. */
  private fun admit() {
    var busy = jobs.values.count { started(it) && !waits(it) }
    var startedCount = jobs.values.count(::started)
    var changed = false
    for (job in jobs.values) {
      if (busy >= slots || startedCount >= slots * 2) break
      if (job["phase"] != "queued") continue
      job["deadline"] = clock() + JOB_MS; transition(job, "preparing")
      busy++; startedCount++; changed = true
    }
    if (changed) persist()
  }

  fun startWork() { stopped = false }
  /** Stops socket work immediately, without waiting for an IO operation's journal lock. */
  fun stopWork(transport: DurableTransfer) { stopped = true; for (id in transfers) transport.cancel(id) }

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
  @Synchronized fun expire(transport: DurableTransfer, stopAll: Boolean = false, stopCause: String? = null) {
    for (job in jobs.values) {
      if (job["phase"] in TERMINAL || job["acknowledged"] == true || job["importFailure"] != null) continue
      // A queued job's time starts when it gets a slot.
      if (job["phase"] == "queued") continue
      if (stopAll || job.number("deadline") <= clock()) {
        val cause = if (stopAll) stopCause ?: "Android stopped the download service" else "Out of time while ${job["phase"]}"
        if (job["phase"] == "completed") { importFailed(job, "failed", cause); job.remove("token") }
        // Android stopping the work isn't the source's fault; running out of time is.
        else fail(job, if (stopAll) "failed" else "timedOut", cause)
        transport.cancel(job["id"] as String)
      } else if (job["phase"] == "transferring" && (job.number("attemptDeadline") <= clock() || (job["queuePosition"] != null && job.number("queueDeadline") <= clock()))) {
        transport.cancel(job["id"] as String)
        nextCandidate(job)
        job["generation"] = job.number("generation") + 1
      } else if (job["token"] != null && job.number("leaseUntil") < clock()) {
        job.remove("token"); job["generation"] = job.number("generation") + 1
        if (job.number("decisionAttempts") >= MAX_DECISIONS) {
          // JS never answered (it went away, or answering threw): that isn't storage.
          val cause = "No answer to the ${DECISIONS[job["phase"]]} decision after $MAX_DECISIONS leases"
          if (job["phase"] == "completed") importFailed(job, "failed", cause) else fail(job, "failed", cause)
        }
      }
    }
    persist()
  }

  /** Expires what's out of time, then runs the next native step, if there is one, on this thread. */
  fun advance(transport: DurableTransfer, publication: DurablePublication) {
    if (stopped) return
    expire(transport)
    nextStep(transport, publication)?.invoke()
  }

  /**
   * Starts queued songs while a slot is free, then hands out the next native step (a transfer,
   * tagging or publication) of a song no worker is on, for a worker thread to run; null when
   * nothing can go on now. Network IO runs outside the journal lock.
   */
  @Synchronized fun nextStep(transport: DurableTransfer, publication: DurablePublication): (() -> Unit)? {
    if (stopped) return null
    admit()
    for (job in jobs.values) {
      val id = job["id"] as String
      if (id in running || job.number("retryAt") > clock()) continue
      if (job["phase"] == "prepared") {
        if (job.number("attempts") >= MAX_ATTEMPTS || job.number("candidateIndex") >= job.maps("candidates").size) { fail(job, exhausted(job)); persist(); continue }
        if (job.number("resumeAttemptDeadline") in 1..clock() || job.number("resumeQueueDeadline") in 1..clock()) { nextCandidate(job); persist(); continue }
        job["attempts"] = job.number("attempts") + 1
        job["sourcePath"] = DownloadFiles.partFileFor(File(job["targetPath"] as String), "${job["id"]}-${job["generation"]}-${job["attempts"]}").path
        job["peer"] = job.maps("candidates")[job.number("candidateIndex").toInt()]
        job.remove("received"); job.remove("total")
        job["queuePosition"] = null; job["queueDeadline"] = job.remove("resumeQueueDeadline") ?: minOf(clock() + QUEUE_MS, job.number("deadline"))
        job["attemptDeadline"] = job.remove("resumeAttemptDeadline") ?: minOf(clock() + ATTEMPT_MS, job.number("deadline"))
        transition(job, "transferring")
        persist()
      }
      if (job["phase"] !in WORK) continue
      val work = job.toMap()
      running += id
      // A step run after the work stopped only lets go of its job; the next start takes it up again.
      return { try { if (!stopped) run(work, transport, publication) } finally { synchronized(this) { running -= id } } }
    }
    return null
  }

  private fun run(work: Map<String, Any?>, transport: DurableTransfer, publication: DurablePublication) {
    val id = work["id"] as String
    val generation = work.number("generation")
    try {
      when (work["phase"]) {
        "transferring" -> {
          val source = File(work["sourcePath"] as String)
          transfers += id
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
        "tagging" -> {
          // The cover comes over the network: other songs' steps and decisions go on meanwhile.
          val source = File(work["sourcePath"] as String)
          publication.tag(source, work.map("tags"))
          synchronized(this) {
            // Cancelled while it was tagged: the file it tagged goes with it.
            val job = held(id, generation, "tagging") ?: run { source.delete(); return }
            if (stopped) return
            transition(job, "awaitingPublication"); persist()
          }
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
            if (!target.parentFile.isDirectory) throw DurableFailure("storage", java.io.IOException("Couldn't make the folder ${target.parentFile.path}"))
            // A changed root requires a new hidden file on the destination filesystem.
            if (source.parentFile.canonicalFile != target.parentFile.canonicalFile) {
              val local = DownloadFiles.partFileFor(target, "$id-$generation-publication")
              job["outputPath"] = local.path; persist()
              FileInputStream(source).use { input -> FileOutputStream(local).use { out -> input.copyTo(out); out.fd.sync() } }
              source = local
            }
            job["finalPath"] = DownloadFiles.freeName(target).path; job["digest"] = digest(source); job["publishSource"] = source.path
            persist()
          }
          var final = File(job["finalPath"] as String)
          if (!included(final)) { fail(job, "noFolder"); persist(); return }
          val publishSource = File(job["publishSource"] as String)
          // Another file took the chosen name before this one was moved there: the next free one.
          if (final.exists() && publishSource.isFile && digest(final) != job["digest"]) {
            final = DownloadFiles.freeName(File(job["targetPath"] as String)); job["finalPath"] = final.path; persist()
          }
          if (!final.exists()) Files.move(publishSource.toPath(), final.toPath())
          if (digest(final) != job["digest"]) {
            // Wave's own copy is gone and another file holds its name: Retry downloads the song again.
            for (key in listOf("finalPath", "digest", "publishSource")) job.remove(key)
            fail(job, "failed", "Another file took ${final.path} before it was imported"); persist(); return
          }
          // Keep the chosen path and proof until scanner/outbox persistence succeeds.
          job["saved"] = clean(publication.index(final)); transition(job, "completed"); cleanup(job); persist()
        }
      }
    } catch (error: Exception) {
      synchronized(this) {
        val job = held(id, generation, work["phase"] as String) ?: run { if (work["phase"] == "tagging") File(work["sourcePath"] as String).delete(); return }
        val cause = describe(error)
        if (work["phase"] == "publishing" && job["finalPath"] != null && File(job["finalPath"] as String).isFile && job.number("publicationAttempts") < 3) {
          job["publicationAttempts"] = job.number("publicationAttempts") + 1
          recordCause(job, "publishing again", cause)
        } else if (work["phase"] == "transferring") {
          val reason = (error as? DurableFailure)?.reason ?: "unavailable"
          // The service stopping isn't the peer's fault: the next start retries the same peer.
          if (stopped) { cleanup(job); transition(job, "prepared"); job["attempts"] = maxOf(0L, job.number("attempts") - 1) }
          else if (reason in plan(job).strings("retry") && job.number("attempts") < MAX_ATTEMPTS) { recordCause(job, reason, cause); cleanup(job); transition(job, "prepared"); job["retryAt"] = clock() + RETRY_PAUSE_MS * job.number("attempts") }
          else if (reason in plan(job).strings("retry") || reason in plan(job).strings("end")) fail(job, reason, cause)
          else { recordCause(job, reason, cause); nextCandidate(job) }
        } else {
          // Tagging or publication: storage only when storage is what failed.
          val folder = (job["finalPath"] ?: job["targetPath"])?.let { File(it as String).parentFile }
          val reason = (error as? DurableFailure)?.reason ?: if (DownloadFiles.storageProblem(error, folder)) "storage" else "failed"
          fail(job, reason, cause)
        }
        persist()
      }
    } finally { transfers -= id }
  }

  private fun held(id: String, generation: Long, phase: String): MutableMap<String, Any?>? = jobs[id]?.takeIf { it.number("generation") == generation && it["phase"] == phase }
  private fun transition(job: MutableMap<String, Any?>, phase: String) { job["phase"] = phase; job["phaseAt"] = clock(); job.remove("token"); job["decisionAttempts"] = 0L; job.remove("retryAt") }
  /** The next peer, or for YouTube its one stream again; failing once there's none left to try. */
  private fun nextCandidate(job: MutableMap<String, Any?>) {
    job.remove("resumeAttemptDeadline"); job.remove("resumeQueueDeadline")
    cleanup(job)
    if (job["source"] != YOUTUBE) job["candidateIndex"] = job.number("candidateIndex") + 1
    if (job.number("candidateIndex") >= job.maps("candidates").size || job.number("attempts") >= MAX_ATTEMPTS) { fail(job, exhausted(job)); return }
    transition(job, "prepared")
    // YouTube's stream again means the whole song again: a pause, longer each time, comes first.
    if (job["source"] == YOUTUBE) job["retryAt"] = clock() + RETRY_PAUSE_MS * job.number("attempts")
  }
  /** The failure plan the prepare answer brought; without one, every failure ends the job. */
  private fun plan(job: Map<String, Any?>) = job.map("failurePlan")
  /** What the job fails with once nothing is left to try. */
  private fun exhausted(job: Map<String, Any?>) = plan(job)["exhausted"] as? String ?: "failed"
  private fun setSource(job: MutableMap<String, Any?>, source: String?) {
    if (source == null) return
    job["source"] = source; job["policy"] = if (source == YOUTUBE) YOUTUBE_M4A else MP3_320
  }
  /**
   * The video YouTube Music downloads: the one the prepare answer (or its fallback) named for a
   * job not named after a video, such as a missing song's, else the song's own.
   */
  private fun youtubeCandidates(job: Map<String, Any?>) =
    listOf(mapOf("source" to YOUTUBE, "videoId" to (job["video"] as? String ?: job.map("song")["videoId"])))

  /**
   * Keeps what a prepare answer says to do when a failure comes: the plan for the job's source
   * and, for a Soulseek job, YouTube Music's fallback (the M4A's place and YouTube's own plan).
   * The tags come with a failed answer too, so a job that never found a peer can still fall back.
   * The video it names, if any, is the one YouTube Music downloads; an answer without one forgets it.
   */
  private fun keepPlans(job: MutableMap<String, Any?>, payload: Map<String, Any?>) {
    (payload["video"] as? String)?.let { job["video"] = it } ?: job.remove("video")
    if (payload["failurePlan"] != null) job["failurePlan"] = clean(payload.map("failurePlan")) else job.remove("failurePlan")
    val fallback = payload.map("fallback")
    if (job["source"] != YOUTUBE && fallback["source"] == YOUTUBE && (fallback["targetPath"] as? String)?.endsWith(".m4a", true) == true) {
      job["fallback"] = clean(fallback)
    } else job.remove("fallback")
    if (payload["tags"] != null) job["tags"] = clean(payload.map("tags"))
  }

  /** Whether failing [job] with [reason] hands it over to YouTube Music, as its plan says. */
  private fun fallsBack(job: Map<String, Any?>, reason: String) =
    job["phase"] in ACQUIRING && job["fallback"] != null && reason in plan(job).strings("fallsBack")

  /**
   * Carries [job] on from YouTube Music when Soulseek's [reason] is one Core hands over: the same
   * job and row, with YouTube's M4A as the target, YouTube's failure plan and a time budget of its
   * own. The fallback is used up, so YouTube's own failure ends the job; Retry starts again from
   * Soulseek.
   */
  private fun fallBack(job: MutableMap<String, Any?>, reason: String): Boolean {
    if (!fallsBack(job, reason)) return false
    val fallback = job.map("fallback")
    cleanup(job)
    for (key in listOf("fallback", "failurePlan", "peer", "audio", "receiptId", "received", "total", "queuePosition", "queueDeadline", "attemptDeadline", "resumeAttemptDeadline", "resumeQueueDeadline")) job.remove(key)
    setSource(job, YOUTUBE)
    fallback["failurePlan"]?.let { job["failurePlan"] = clean(it) }
    job["fellBackFrom"] = reason
    (fallback["video"] as? String)?.let { job["video"] = it }
    job["targetPath"] = fallback["targetPath"]
    job["candidates"] = youtubeCandidates(job); job["candidateIndex"] = 0L; job["attempts"] = 0L
    job["deadline"] = clock() + JOB_MS
    job["generation"] = job.number("generation") + 1
    transition(job, "prepared")
    return true
  }

  /**
   * Every way a job fails goes through here, which is where Soulseek's failures fall back. A
   * [cause] says what actually went wrong; it stays on the job (and in the log) through a fallback.
   */
  private fun fail(job: MutableMap<String, Any?>, reason: String, cause: String? = null) {
    if (cause != null) recordCause(job, reason, cause)
    if (fallBack(job, reason)) return
    // YT Music was turned off before YouTube could take over: Soulseek's failure stands.
    job["reason"] = if (reason == "noSource") job["fellBackFrom"] as? String ?: reason else reason
    job["endedAt"] = clock(); transition(job, "failed"); job["generation"] = job.number("generation") + 1; cleanup(job)
  }
  /** A published file the Library couldn't import, with what went wrong. */
  private fun importFailed(job: MutableMap<String, Any?>, reason: String, cause: String?) {
    job["importFailure"] = reason
    if (cause != null) recordCause(job, reason, cause)
  }
  /** Keeps [cause] as what last went wrong with [job], in the journal and the log. */
  private fun recordCause(job: MutableMap<String, Any?>, reason: String, cause: String) {
    job["cause"] = cause.take(MAX_CAUSE)
    log("Download ${job["id"]} (${job["source"] ?: SOULSEEK}) ${job["phase"]}: $reason; ${job["cause"]}")
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
    /** How many songs download at once (measured for #239). */
    const val SLOTS = 3
    /** How long a started song may wait for JS's answer before it leaves its slot to the next. */
    const val DECISION_WAIT_MS = 30_000L
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
    /** The pause before a transfer from the same peer, or YouTube's stream, again: times the attempts so far. */
    const val RETRY_PAUSE_MS = 2_000L
    const val MAX_DECISIONS = 3L
    /** A cause is a line for the Downloads page and the log, not a stack trace. */
    const val MAX_CAUSE = 1_000
    const val SOULSEEK = "soulseek"
    const val YOUTUBE = "youtube"
    /** What a job saves: Soulseek's original MP3 320, or YouTube's M4A as served. */
    private const val MP3_320 = "mp3-320"
    private const val YOUTUBE_M4A = "youtube-m4a"
    private val TERMINAL = setOf("failed", "cancelled")
    /** Until the audio is accepted; afterwards a failure is the save's, which YouTube would share. */
    private val ACQUIRING = setOf("preparing", "prepared", "transferring", "sourceReady")
    private val DECISIONS = mapOf("preparing" to "prepare", "sourceReady" to "confirm", "awaitingPublication" to "publish", "completed" to "import")
    /** The phases with native work: a worker thread runs them. */
    private val WORK = setOf("transferring", "tagging", "publishing")
  }
}

class DurableFailure(val reason: String, cause: Throwable? = null) : java.io.IOException(reason, cause)

/** What the download notification counts: songs on their way ([running]) and songs not started yet ([left]). */
data class DownloadCounts(val running: Int, val left: Int)

/**
 * What went wrong, as `<exception class>: <message>`, then what caused it (`<-`). A
 * [DurableFailure] only carries the reason it was given, so what it wraps describes it.
 */
fun describe(error: Throwable): String =
  generateSequence(error) { it.cause?.takeIf { cause -> cause !== it } }
    .filterNot { it is DurableFailure && it.cause != null }
    .take(4)
    .joinToString(" <- ") { if (it.message.isNullOrBlank()) it.javaClass.name else "${it.javaClass.name}: ${it.message}" }
    .take(DurableDownloads.MAX_CAUSE)

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
