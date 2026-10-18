package expo.modules.wavenative.soulseek

import expo.modules.wavenative.download.BackgroundThreads
import java.io.Closeable
import java.io.File
import java.io.IOException
import java.io.FileOutputStream
import java.net.InetSocketAddress
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Semaphore
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeoutException
import kotlin.concurrent.thread

class SoulseekCredentials(val username: String, val password: String) {
  override fun toString() = "SoulseekCredentials([redacted])"

  /** The same account: the same username and password. */
  fun sameAs(other: SoulseekCredentials?) = other != null && username == other.username && password == other.password
}

interface SoulseekCredentialsStore {
  fun load(): SoulseekCredentials?
  fun save(value: SoulseekCredentials?)
}

/** Whether Download in best quality is on: null on a phone from before the switch. */
interface SoulseekSwitchStore {
  fun load(): Boolean?
  fun save(on: Boolean)
}

/** Process-owned client. All network and file work runs on the caller's IO thread, outside JS. */
class SoulseekClient(
  private val credentialsStore: SoulseekCredentialsStore,
  private val host: String = "server.slsknet.org",
  private val port: Int = 2242,
  /** Whether the phone is online, which tells Soulseek's server being unreachable from being offline. */
  private val online: () -> Boolean = { true },
  private val switch: SoulseekSwitchStore,
  /** While the phone is signed in to one, the Soulseek account belongs to the Wave account. */
  private val waveAccount: WaveAccountSoulseek = NoWaveAccount,
  /** Lowers a download's peer thread to background priority before it receives (#455). */
  lowerDownloadPeer: () -> Unit = BackgroundThreads::lowerThisThread,
) : Closeable {
  /** A download's peer threads: they receive the song's bytes, at background priority like the rest of download work. */
  private val downloadPeers = BackgroundThreads("Wave Soulseek peer", daemon = true, lower = lowerDownloadPeer)
  @Volatile private var server: Socket? = null
  private var listener: ServerSocket? = null
  private var credentials = credentialsStore.load()
  /** The account [server] is logged in as: an old one after a switch, until its downloads end. */
  @Volatile private var connectedAs: SoulseekCredentials? = null
  /** Download in best quality. A phone connected to an account of its own before the switch keeps it, on. */
  @Volatile private var on = switch.load() ?: (credentials != null)
  private val token = AtomicInteger(java.security.SecureRandom().nextInt(Int.MAX_VALUE / 2 - 1) + 1)
  private val peers = ConcurrentHashMap<String, Socket>()
  private val peerLocks = ConcurrentHashMap<String, Any>()
  /**
   * Peer connections run on bounded threads. A popular search brings thousands of connection
   * requests in seconds; they get their own slots, so they can never take the ones a download
   * needs for its peer and file connections.
   */
  private val searchSlots = Semaphore(32)
  private val downloadSlots = Semaphore(16)
  private val sockets = ConcurrentHashMap.newKeySet<Socket>()
  private val searches = ConcurrentHashMap<Long, CopyOnWriteArrayList<SoulseekCandidate>>()
  private val addressRequests = ConcurrentHashMap<String, java.util.concurrent.CompletableFuture<InetSocketAddress>>()
  private val indirect = ConcurrentHashMap<Long, Pair<String, String>>()
  private class Pending(
    val id: String,
    val candidate: SoulseekCandidate,
    val part: File,
    val expectedDurationMs: Long,
    val progress: (Long, Long) -> Unit,
    val queued: (Long) -> Unit,
  ) {
    val finished = CompletableFuture<VerifiedMp3>()
    @Volatile var socket: Socket? = null
    @Volatile var transferToken: Long? = null
  }
  private val downloads = ConcurrentHashMap<String, Pending>()
  private val transfers = ConcurrentHashMap<Pair<String, Long>, Pending>()

  fun session(): Map<String, Any?> = mapOf(
    "status" to if (!on || credentials == null) "off" else if (server?.isClosed == false) "connected" else "disconnected",
    "username" to credentials?.username,
  )

  /**
   * Turns Download in best quality on: connects the phone's Soulseek account, making one when it
   * has none. Signed in to a Wave account, the Wave account's comes first: the phone uses it
   * instead of its own or a new one, and one the Wave account lacks (or Soulseek rejected) goes
   * up at once. When Wave's server can't be asked, the phone goes on as signed out, and the next
   * pull settles it ([followWaveAccount]).
   */
  @Synchronized fun turnOn(): Map<String, Any?> {
    val kept = askWaveAccount()
    kept?.account?.let { if (!it.sameAs(credentials)) adopt(it) }
    connectAccount()
    val connected = credentials
    if (kept != null && connected != null && !connected.sameAs(kept.account)) keepOnWaveAccount(connected)
    turn(true)
    return session()
  }

  /**
   * Follows the Wave account's Soulseek account, at sign-in and each pull while signed in: when
   * it has one and the phone's is different, the phone switches to it and forgets its own; when
   * it has none, the phone's goes up. Signed out, it does nothing. Throws when Wave's server
   * can't be asked; nothing changes then.
   */
  @Synchronized fun followWaveAccount(): Map<String, Any?> {
    if (!waveAccount.signedIn()) return session()
    val kept = waveAccount.read()
    val own = credentials
    if (kept != null && !kept.sameAs(own)) adopt(kept)
    else if (kept == null && own != null) waveAccount.keep(own)
    return session()
  }

  /** What the Wave account keeps ([account], null for none); null when signed out or it can't be asked. */
  private class Kept(val account: SoulseekCredentials?)

  private fun askWaveAccount(): Kept? =
    if (!waveAccount.signedIn()) null else runCatching { Kept(waveAccount.read()) }.getOrNull()

  /** Sends [account] up as the Wave account's while signed in. A failure waits for the next pull. */
  private fun keepOnWaveAccount(account: SoulseekCredentials) {
    if (waveAccount.signedIn()) runCatching { waveAccount.keep(account) }
  }

  /**
   * The Wave account's Soulseek account becomes the phone's, which is forgotten. Downloads running
   * on a connection with the old one finish on it; the next search or download with none running
   * connects with [account] ([ensureConnected]).
   */
  private fun adopt(account: SoulseekCredentials) {
    try { credentialsStore.save(account) }
    catch (e: Exception) { throw SoulseekException(SoulseekFailure.STORAGE, cause = e) }
    credentials = account
    if (server != null && downloads.isEmpty()) close()
  }

  /**
   * Connects the account downloads use. The one place that picks it: the phone's own, else a new
   * one with random credentials, drawn again while Soulseek says a name is taken (a taken name
   * and a wrong password look the same to it). An account of its own that Soulseek rejects is
   * forgotten, and a new one made.
   */
  private fun connectAccount() {
    credentials?.let { saved ->
      try { return login(saved) }
      catch (e: SoulseekException) { if (e.failure == SoulseekFailure.AUTH) forget() else throw e }
    }
    repeat(ACCOUNT_DRAWS) {
      try { return login(SoulseekAccounts.draw()) }
      catch (e: SoulseekException) { if (e.failure != SoulseekFailure.AUTH) throw e }
    }
    throw SoulseekException(SoulseekFailure.NO_ACCOUNT)
  }

  /**
   * Connects [username]'s account and downloads use it, with Download in best quality on. Signed
   * in, it goes up as the Wave account's. The app never calls it (it has no Soulseek sign-in);
   * scripts/music-folder's PC bridge (PcSoulseek.kt) logs in with it.
   */
  @Synchronized fun connect(username: String, password: String): Map<String, Any?> {
    val account = SoulseekCredentials(username, password)
    login(account)
    keepOnWaveAccount(account)
    turn(true)
    return session()
  }

  /** Turns Download in best quality off. The account stays on the phone for the next time. */
  @Synchronized fun turnOff(): Map<String, Any?> {
    turn(false)
    close()
    return session()
  }

  private fun turn(on: Boolean) {
    try { switch.save(on) }
    catch (e: Exception) { throw SoulseekException(SoulseekFailure.STORAGE, cause = e) }
    this.on = on
  }

  /** Logs in to Soulseek's server as [account] and keeps it as the phone's account. */
  private fun login(account: SoulseekCredentials) {
    val username = account.username
    val password = account.password
    if (username.isBlank() || username.length > 30 || username.trim() != username || username.any { it.code !in 32..126 } || password.isEmpty() || password.length > 1024) {
      throw SoulseekException(SoulseekFailure.AUTH)
    }
    close()
    val socket = Socket()
    try {
      socket.connect(InetSocketAddress(host, port), 10_000)
      socket.soTimeout = 15_000
      socket.keepAlive = true
      val hash = MessageDigest.getInstance("MD5").digest((username + password).toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it.toInt() and 255) }
      SoulseekWire.write(socket.getOutputStream(), 1) { string(username); string(password); uint(177); string(hash); uint(1) }
      var answer = SoulseekWire.read(socket.getInputStream())
      while (answer.code != 1) answer = SoulseekWire.read(socket.getInputStream())
      if (SoulseekWire.reader(answer.payload).byte() != 1) throw SoulseekException(SoulseekFailure.AUTH)
      val incoming = ServerSocket(0)
      listener = incoming
      SoulseekWire.write(socket.getOutputStream(), 2) { uint(incoming.localPort.toLong()) }
      SoulseekWire.write(socket.getOutputStream(), 35) { uint(0); uint(0) }
      val authenticated = SoulseekCredentials(username, password)
      try { credentialsStore.save(authenticated) }
      catch (e: Exception) { throw SoulseekException(SoulseekFailure.STORAGE, cause = e) }
      credentials = authenticated
      connectedAs = authenticated
      socket.soTimeout = 0
      server = socket
      startReaders(socket, incoming)
    } catch (e: Exception) {
      socket.close()
      listener?.close()
      listener = null
      if (e is SoulseekException) throw e
      throw unreachable(e)
    }
  }

  /** Search decisions belong in Core; this method only collects bounded, untrusted peer reports. */
  fun search(query: String, timeoutMs: Long = 8000): List<SoulseekCandidate> {
    ensureConnected()
    if (query.isBlank() || query.length > 256) throw SoulseekException(SoulseekFailure.PROTOCOL)
    val id = token.incrementAndGet().toLong()
    val results = CopyOnWriteArrayList<SoulseekCandidate>()
    searches[id] = results
    try {
      sendServer(26) { uint(id); string(query) }
      val end = System.nanoTime() + timeoutMs.coerceIn(100, 15_000) * 1_000_000
      while (System.nanoTime() < end) {
        if (server == null) throw connectionLost()
        Thread.sleep(25)
      }
      return results.distinctBy { it.username to it.filename }
    } finally { searches.remove(id) }
  }

  /**
   * Gets one selected recording, preserving its bytes. Failed and cancelled attempts leave no part file.
   * It waits (in the peer's queue, then for the transfer) until [isCancelled] says to stop: the
   * download journal's start, queue and stall rules decide how long a peer may take, not a flat limit.
   */
  fun download(
    id: String,
    candidate: SoulseekCandidate,
    part: File,
    expectedDurationMs: Long,
    onProgress: (Long, Long) -> Unit = { _, _ -> },
    onQueued: (Long) -> Unit = {},
    isCancelled: () -> Boolean,
  ): VerifiedMp3 {
    ensureConnected()
    if (candidate.bytes !in 1..SoulseekCandidate.MAX_AUDIO_BYTES || !candidate.filename.endsWith(".mp3", true)) {
      throw SoulseekException(SoulseekFailure.INVALID_AUDIO)
    }
    val pending = Pending(id, candidate, part, expectedDurationMs, onProgress, onQueued)
    if (downloads.putIfAbsent(id, pending) != null) throw SoulseekException(SoulseekFailure.PEER, "This download is already running")
    try {
      part.parentFile?.let { if (!it.isDirectory && !it.mkdirs() && !it.isDirectory) throw SoulseekException(SoulseekFailure.STORAGE) }
      // Restart from zero because Soulseek has no chunk hashes to prove a resumed payload's identity.
      FileOutputStream(part).use {}
      val peer = peer(candidate.username)
      SoulseekWire.write(peer.getOutputStream(), 43) { string(candidate.filename) }
      SoulseekWire.write(peer.getOutputStream(), 51) { string(candidate.filename) }
      while (true) {
        try { return pending.finished.get(CANCEL_POLL_MS, TimeUnit.MILLISECONDS) }
        catch (_: TimeoutException) { if (isCancelled()) throw SoulseekException(SoulseekFailure.CANCELLED) }
      }
    } catch (e: Exception) {
      part.delete()
      val cause = if (e is ExecutionException) e.cause ?: e else e
      if (cause is SoulseekException) throw cause
      throw SoulseekException(SoulseekFailure.PEER, cause = cause)
    } finally {
      downloads.remove(id, pending)
      pending.transferToken?.let { transfers.remove(candidate.username to it, pending) }
      pending.socket?.close()
    }
  }

  fun cancel(id: String) {
    downloads[id]?.let { pending ->
      pending.finished.completeExceptionally(SoulseekException(SoulseekFailure.CANCELLED))
      pending.socket?.close()
    }
  }

  /**
   * Several songs download at once, so two can want the same peer together: one connects while the
   * other waits for it and shares its connection (each address lookup would void the one before).
   */
  private fun peer(user: String): Socket = synchronized(peerLocks.computeIfAbsent(user) { Any() }) { connectPeer(user) }

  private fun connectPeer(user: String): Socket {
    peers[user]?.takeUnless { it.isClosed }?.let { it.soTimeout = 180_000; return it }
    val future = CompletableFuture<InetSocketAddress>()
    addressRequests.put(user, future)?.completeExceptionally(SoulseekException(SoulseekFailure.PEER))
    sendServer(3) { string(user) }
    val remoteAddress = try { future.get(12, TimeUnit.SECONDS) } finally { addressRequests.remove(user, future) }
    try {
      val remote = open(remoteAddress)
      val us = connectedAs ?: throw connectionLost()
      SoulseekWire.write(remote.getOutputStream(), 1, true) { string(us.username); string("P"); uint(0) }
      peers[user] = remote
      launchPeer(remote, forDownload = true) { handlePeer(user, "P", remote) }
      return remote
    } catch (_: IOException) {
      val id = token.incrementAndGet().toLong()
      indirect[id] = user to "P"
      try {
        sendServer(18) { uint(id); string(user); string("P") }
        val end = System.nanoTime() + 15_000_000_000L
        while (System.nanoTime() < end) {
          peers[user]?.takeUnless { it.isClosed }?.let { return it }
          Thread.sleep(25)
        }
        throw SoulseekException(SoulseekFailure.PEER)
      } finally { indirect.remove(id) }
    }
  }

  @Synchronized private fun ensureConnected() {
    // Off, downloads don't use Soulseek, though the phone keeps its account.
    if (!on) throw SoulseekException(SoulseekFailure.SIGNED_OUT)
    // After a switch to the Wave account's, the old connection serves the downloads running on it.
    if (server?.isClosed == false && (credentials?.sameAs(connectedAs) != false || downloads.isNotEmpty())) return
    val saved = credentials ?: throw SoulseekException(SoulseekFailure.SIGNED_OUT)
    try { login(saved) }
    catch (e: SoulseekException) {
      // Turning the switch on again makes a new account.
      if (e.failure == SoulseekFailure.AUTH) { forget(); turn(false) }
      throw e
    }
  }

  /** Connecting to the server failed: offline when the phone is, else the server is unreachable. */
  private fun unreachable(cause: Throwable? = null) =
    SoulseekException(if (online()) SoulseekFailure.UNREACHABLE else SoulseekFailure.OFFLINE, cause = cause)

  /**
   * The server connection dropped or was closed (a reconnect, a sign-out): never the server being
   * unreachable. A network handover drops it while the phone is online; connecting again tells.
   */
  private fun connectionLost() = SoulseekException(SoulseekFailure.OFFLINE)

  private fun sendServer(code: Int, body: SoulseekWire.Writer.() -> Unit = {}) {
    val socket = server ?: throw connectionLost()
    SoulseekWire.write(socket.getOutputStream(), code, body = body)
  }

  private fun startReaders(socket: Socket, incoming: ServerSocket) {
    thread(isDaemon = true, name = "Wave Soulseek server") {
      try {
        while (!socket.isClosed) {
          val message = SoulseekWire.read(socket.getInputStream())
          val fields = SoulseekWire.reader(message.payload)
          when (message.code) {
            3 -> {
              val user = fields.string()
              val ip = fields.uint()
              val port = fields.uint()
              val pending = addressRequests.remove(user)
              if (ip == 0L || port !in 1..65535) pending?.completeExceptionally(SoulseekException(SoulseekFailure.PEER))
              else pending?.complete(address(ip, port))
            }
            18 -> {
              val user = fields.string()
              val type = fields.string()
              val ip = fields.uint()
              val port = fields.uint()
              val connectToken = fields.uint()
              if (type == "P" && searches.isEmpty() && !peers.containsKey(user) && downloads.values.none { it.candidate.username == user }) continue
              if (type == "F" && transfers.keys.none { it.first == user }) continue
              if (type !in setOf("P", "F") || ip == 0L || port !in 1..65535) continue
              launchPeer(forDownload = type == "F" || downloads.values.any { it.candidate.username == user }) {
                val remote = open(address(ip, port))
                try {
                  SoulseekWire.write(remote.getOutputStream(), 0, true) { uint(connectToken) }
                  handlePeer(user, type, remote)
                } finally { sockets.remove(remote); remote.close() }
              }
            }
            41 -> throw SoulseekException(SoulseekFailure.AUTH, "The account connected from another client")
            22 -> sendServer(23) { uint(fields.uint()) }
          }
        }
      } catch (_: Throwable) {
        if (server === socket) {
          server = null
          socket.close()
          addressRequests.values.forEach { it.completeExceptionally(connectionLost()) }
          addressRequests.clear()
        }
      }
    }
    thread(isDaemon = true, name = "Wave Soulseek listener") {
      while (!incoming.isClosed) {
        val remote = try { incoming.accept() } catch (_: Exception) { break }
        // Who connected is only known once it says; while a download runs, it may be its peer.
        launchPeer(remote, forDownload = downloads.isNotEmpty()) {
          remote.soTimeout = 15_000
          val init = SoulseekWire.read(remote.getInputStream(), true)
          val fields = SoulseekWire.reader(init.payload)
          val identity = when (init.code) {
            1 -> fields.string() to fields.string()
            0 -> indirect.remove(fields.uint())
            else -> null
          } ?: throw SoulseekException(SoulseekFailure.PROTOCOL)
          handlePeer(identity.first, identity.second, remote)
        }
      }
    }
  }

  /** Anything uncaught on these threads would close Wave, Errors included: one peer only loses its connection. */
  private fun launchPeer(remote: Socket? = null, forDownload: Boolean, work: () -> Unit) {
    val slots = if (forDownload) downloadSlots else searchSlots
    if (!slots.tryAcquire()) { remote?.close(); return }
    val run = Runnable { try { work() } catch (_: Throwable) { remote?.close() } finally { slots.release() } }
    // A search's peers answer the owner waiting on Search: they keep their priority.
    if (forDownload) downloadPeers.newThread(run).start()
    else thread(isDaemon = true, name = "Wave Soulseek peer") { run.run() }
  }

  private fun open(address: InetSocketAddress): Socket {
    val remote = Socket()
    try {
      remote.connect(address, 10_000)
      remote.soTimeout = 60_000
      sockets.add(remote)
      return remote
    } catch (e: Exception) { remote.close(); throw e }
  }

  private fun handlePeer(user: String, type: String, remote: Socket) {
    if (type == "F") { receiveFile(user, remote); return }
    if (type != "P") { remote.close(); return }
    peers.put(user, remote)?.takeUnless { it === remote }?.close()
    sockets.add(remote)
    // A peer only sending search results does so at once; a download's peer may wait to answer.
    remote.soTimeout = if (downloads.values.any { it.candidate.username == user }) 180_000 else 20_000
    try {
      while (!remote.isClosed) {
        val message = SoulseekWire.read(remote.getInputStream())
        if (message.code == 9) {
          receiveSearch(user, message.payload)
          // Results are retained, sockets aren't. Otherwise the first 32 results would occupy
          // every reader and prevent later peers and the selected file connection from arriving.
          if (downloads.values.none { it.candidate.username == user }) remote.close()
        }
        // A download-only client never exposes a scanner, local path or upload resolver.
        if (message.code == 4) SoulseekWire.write(remote.getOutputStream(), 5) {
          bytes(SoulseekWire.deflate(SoulseekWire.Writer().apply { uint(0) }.result()))
        }
        if (message.code == 43) SoulseekWire.write(remote.getOutputStream(), 50) {
          string(SoulseekWire.reader(message.payload).string()); string("File not shared.")
        }
        if (message.code == 40) receiveRequest(user, remote, message.payload)
        if (message.code in setOf(44, 46, 50)) {
          val fields = SoulseekWire.reader(message.payload)
          val filename = fields.string()
          val pending = downloads.values.firstOrNull { it.candidate.username == user && it.candidate.filename == filename }
          when (message.code) {
            44 -> pending?.queued?.invoke(fields.uint())
            46, 50 -> pending?.finished?.completeExceptionally(SoulseekException(SoulseekFailure.PEER))
          }
        }
      }
    } finally {
      if (peers.remove(user, remote)) {
        downloads.values.filter { it.candidate.username == user && it.transferToken == null }.forEach {
          it.finished.completeExceptionally(SoulseekException(SoulseekFailure.PEER))
        }
      }
      sockets.remove(remote)
      remote.close()
    }
  }

  private fun receiveRequest(user: String, remote: Socket, payload: ByteArray) {
    val fields = SoulseekWire.reader(payload)
    val direction = fields.uint()
    val id = fields.uint()
    val filename = fields.string()
    val pending = downloads.values.firstOrNull {
      it.candidate.username == user && it.candidate.filename == filename && !it.finished.isDone && it.transferToken == null
    }
    val size = if (direction == 1L) fields.ulong() else 0
    if (direction != 1L || pending == null || size != pending.candidate.bytes) {
      SoulseekWire.write(remote.getOutputStream(), 41) { uint(id); byte(0); string("File not shared.") }
      if (pending != null && direction == 1L) pending.finished.completeExceptionally(SoulseekException(SoulseekFailure.INVALID_AUDIO))
      return
    }
    pending.transferToken = id
    if (transfers.putIfAbsent(user to id, pending) != null) throw SoulseekException(SoulseekFailure.PROTOCOL)
    SoulseekWire.write(remote.getOutputStream(), 41) { uint(id); byte(1) }
  }

  private fun receiveFile(user: String, remote: Socket) {
    sockets.add(remote)
    remote.soTimeout = 30_000
    var pending: Pending? = null
    try {
      val id = SoulseekWire.Reader(remote.getInputStream()).uint()
      val transfer = transfers.remove(user to id) ?: throw SoulseekException(SoulseekFailure.PROTOCOL)
      pending = transfer
      if (transfer.finished.isDone) return
      transfer.socket = remote
      remote.getOutputStream().write(SoulseekWire.Writer().apply { ulong(0) }.result())
      remote.getOutputStream().flush()
      val input = remote.getInputStream()
      val buffer = ByteArray(64 * 1024)
      var received = 0L
      FileOutputStream(transfer.part, false).use { output ->
        while (received < transfer.candidate.bytes) {
          if (transfer.finished.isDone) throw SoulseekException(SoulseekFailure.CANCELLED)
          val count = input.read(buffer, 0, minOf(buffer.size.toLong(), transfer.candidate.bytes - received).toInt())
          if (count < 0) throw SoulseekException(SoulseekFailure.PEER, "The peer disconnected before the file was complete")
          output.write(buffer, 0, count)
          received += count
          transfer.progress(received, transfer.candidate.bytes)
        }
        output.fd.sync()
      }
      remote.close()
      transfer.finished.complete(Mp3Validation.validate(transfer.part, transfer.candidate.bytes, transfer.expectedDurationMs))
    } catch (e: Throwable) {
      // Fails this download (the next peer is tried) instead of leaving it waiting for its queue timeout.
      pending?.finished?.completeExceptionally(e)
    } finally {
      sockets.remove(remote)
      remote.close()
    }
  }

  private fun receiveSearch(user: String, payload: ByteArray) {
    val fields = SoulseekWire.reader(SoulseekWire.inflate(payload))
    if (fields.string() != user) return
    val results = searches[fields.uint()] ?: return
    val count = fields.uint()
    if (count > 10_000) throw SoulseekException(SoulseekFailure.PROTOCOL)
    val files = ArrayList<SoulseekCandidate>()
    repeat(count.toInt()) {
      fields.byte()
      val filename = fields.string()
      val bytes = fields.ulong()
      fields.string()
      val attributeCount = fields.uint()
      if (attributeCount > 64) throw SoulseekException(SoulseekFailure.PROTOCOL)
      val attributes = HashMap<Long, Long>()
      repeat(attributeCount.toInt()) { attributes[fields.uint()] = fields.uint() }
      if (filename.endsWith(".mp3", true) && bytes in 1..SoulseekCandidate.MAX_AUDIO_BYTES) {
        files.add(SoulseekCandidate(user, filename, bytes, attributes[0]?.toInt(), attributes[1]?.times(1000), false, 0, 0))
      }
    }
    val free = fields.byte() != 0
    val speed = fields.uint()
    val queue = fields.uint()
    synchronized(results) {
      files.take((1000 - results.size).coerceAtLeast(0)).forEach {
        results.add(it.copy(freeSlot = free, uploadSpeed = speed, queueLength = queue))
      }
    }
  }

  /** The server sends a peer's IP reversed: its last wire byte is the first octet, as Nicotine+ and Soulseek.NET read it. */
  private fun address(ip: Long, port: Long) = InetSocketAddress(
    InetAddress.getByAddress(ByteArray(4) { (ip ushr ((3 - it) * 8)).toByte() }), port.toInt(),
  )

  /** Forgets an account Soulseek rejected. */
  private fun forget() {
    credentials = null
    credentialsStore.save(null)
  }

  @Synchronized override fun close() {
    // Waiting downloads lose the connection before their peer sockets close: a peer thread that
    // sees its socket go must not fail them as the peer's fault.
    downloads.values.forEach { it.finished.completeExceptionally(connectionLost()) }
    server?.close()
    server = null
    connectedAs = null
    listener?.close()
    listener = null
    sockets.forEach { runCatching { it.close() } }
    sockets.clear()
    peers.clear()
    searches.clear()
    indirect.clear()
    downloads.values.forEach { it.finished.completeExceptionally(connectionLost()); it.socket?.close() }
    downloads.clear()
    transfers.clear()
    addressRequests.values.forEach { it.completeExceptionally(connectionLost()) }
    addressRequests.clear()
  }
}

/** How many usernames turning Download in best quality on draws before it gives up. */
private const val ACCOUNT_DRAWS = 5

/** How often a waiting download asks whether it is still wanted. */
private const val CANCEL_POLL_MS = 250L
