package expo.modules.wavenative.soulseek

import java.net.ServerSocket
import java.net.Socket
import java.io.File
import java.nio.file.Files
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.concurrent.thread

class SoulseekClientTest {
  @Test fun `search keeps collecting results after more peers respond than the retained connection limit`() {
    ServerSocket(0).use { server ->
      ServerSocket(0).use { peer ->
        val ended = CompletableFuture<Unit>()
        val connections = mutableListOf<Socket>()
        thread(isDaemon = true) {
          try {
            server.accept().use { socket ->
              login(socket)
              val token = SoulseekWire.reader(SoulseekWire.read(socket.getInputStream()).payload).uint()
              repeat(34) { index ->
                SoulseekWire.write(socket.getOutputStream(), 18) { string("fixture-peer-$index"); string("P"); uint(LOCALHOST); uint(peer.localPort.toLong()); uint(index.toLong() + 1); byte(0) }
                val connection = peer.accept()
                connections.add(connection)
                SoulseekWire.read(connection.getInputStream(), true)
                val result = SoulseekWire.Writer().apply {
                  string("fixture-peer-$index"); uint(token); uint(1); byte(1); string("Music\\Fixture Title.mp3"); ulong(61_648); string("")
                  uint(2); uint(0); uint(320); uint(1); uint(2); byte(1); uint(100_000); uint(0)
                }.result()
                SoulseekWire.write(connection.getOutputStream(), 9) { bytes(SoulseekWire.deflate(result)) }
              }
              ended.get(3, TimeUnit.SECONDS)
            }
          } catch (_: java.net.SocketException) {
            // Closing the test listeners also unblocks accept after a failed assertion.
          } finally { connections.forEach { it.close() } }
        }
        val client = SoulseekClient(MemoryCredentials(), "127.0.0.1", server.localPort)
        try {
          client.connect("wave-fixture", "fixture-secret")
          assertEquals(34, client.search("Fixture Title", 1500).size)
        } finally { ended.complete(Unit); client.close() }
      }
    }
  }

  @Test fun `cancelling a queued recording stops waiting and deletes its part file`() {
    ServerSocket(0).use { server ->
      ServerSocket(0).use { peer ->
        val verified = CompletableFuture<Unit>()
        val ended = CompletableFuture<Unit>()
        thread {
          try {
            server.accept().use { socket ->
              login(socket)
              assertEquals(3, SoulseekWire.read(socket.getInputStream()).code)
              SoulseekWire.write(socket.getOutputStream(), 3) { string("fixture-peer"); uint(LOCALHOST); uint(peer.localPort.toLong()) }
              peer.accept().use { connection ->
                SoulseekWire.read(connection.getInputStream(), true)
                val filename = SoulseekWire.reader(SoulseekWire.read(connection.getInputStream()).payload).string()
                assertEquals(51, SoulseekWire.read(connection.getInputStream()).code)
                SoulseekWire.write(connection.getOutputStream(), 44) { string(filename); uint(8) }
                verified.complete(Unit)
                ended.get(2, TimeUnit.SECONDS)
              }
            }
          } catch (e: Throwable) { verified.completeExceptionally(e) }
        }
        val client = SoulseekClient(MemoryCredentials(), "127.0.0.1", server.localPort)
        val part = Files.createTempFile("wave-cancelled", ".mp3").toFile()
        try {
          client.connect("wave-fixture", "fixture-secret")
          val candidate = SoulseekCandidate("fixture-peer", "Fixture.mp3", 1000, 320, 1500, false, 0, 8)
          val failure = assertThrows(SoulseekException::class.java) {
            client.download("cancelled", candidate, part, 1500, onQueued = { client.cancel("cancelled") }, isCancelled = giveUpAfterSeconds(5))
          }
          verified.get(2, TimeUnit.SECONDS)
          assertEquals(SoulseekFailure.CANCELLED, failure.failure)
          assertFalse(part.exists())
        } finally { ended.complete(Unit); client.close(); part.delete() }
      }
    }
  }

  /** The download journal decides how long a peer may take (start, queue, stall); the client has no flat limit of its own. */
  @Test fun `a download waits for as long as its caller wants it and stops when it no longer does`() {
    ServerSocket(0).use { server ->
      ServerSocket(0).use { peer ->
        val ended = CompletableFuture<Unit>()
        thread(isDaemon = true) {
          try {
            server.accept().use { socket ->
              login(socket)
              SoulseekWire.read(socket.getInputStream())
              SoulseekWire.write(socket.getOutputStream(), 3) { string("fixture-peer"); uint(LOCALHOST); uint(peer.localPort.toLong()) }
              peer.accept().use { connection ->
                SoulseekWire.read(connection.getInputStream(), true)
                val filename = SoulseekWire.reader(SoulseekWire.read(connection.getInputStream()).payload).string()
                SoulseekWire.read(connection.getInputStream())
                SoulseekWire.write(connection.getOutputStream(), 44) { string(filename); uint(8) }
                ended.get(5, TimeUnit.SECONDS)
              }
            }
          } catch (_: Exception) {
            // The client closing its sockets ends the fixture.
          }
        }
        val client = SoulseekClient(MemoryCredentials(), "127.0.0.1", server.localPort)
        val part = Files.createTempFile("wave-unwanted", ".mp3").toFile()
        try {
          client.connect("wave-fixture", "fixture-secret")
          val candidate = SoulseekCandidate("fixture-peer", "Fixture.mp3", 1000, 320, 1500, false, 0, 8)
          var queuedAt = 0L
          val failure = assertThrows(SoulseekException::class.java) {
            client.download("unwanted", candidate, part, 1500, onQueued = { queuedAt = System.nanoTime() },
              isCancelled = { queuedAt != 0L && System.nanoTime() - queuedAt > 300_000_000L })
          }
          assertEquals(SoulseekFailure.CANCELLED, failure.failure)
          assertTrue((System.nanoTime() - queuedAt) < 2_000_000_000L)
          assertFalse(part.exists())
        } finally { ended.complete(Unit); client.close(); part.delete() }
      }
    }
  }

  @Test fun `an incoming peer cannot browse the Library or ask Wave to upload or accept an unsolicited file`() {
    ServerSocket(0).use { server ->
      val verified = CompletableFuture<Unit>()
      val ended = CompletableFuture<Unit>()
      thread {
        try {
          server.accept().use { socket ->
            assertEquals(1, SoulseekWire.read(socket.getInputStream()).code)
            SoulseekWire.write(socket.getOutputStream(), 1) { byte(1); string("Welcome"); uint(0); string(""); byte(0) }
            val port = SoulseekWire.reader(SoulseekWire.read(socket.getInputStream()).payload).uint().toInt()
            assertEquals(35, SoulseekWire.read(socket.getInputStream()).code)
            Socket("127.0.0.1", port).use { peer ->
              peer.soTimeout = 2000
              SoulseekWire.write(peer.getOutputStream(), 1, true) { string("untrusted-peer"); string("P"); uint(0) }
              SoulseekWire.write(peer.getOutputStream(), 4)
              val list = SoulseekWire.read(peer.getInputStream())
              assertEquals(5, list.code)
              assertEquals(0L, SoulseekWire.reader(SoulseekWire.inflate(list.payload)).uint())
              SoulseekWire.write(peer.getOutputStream(), 43) { string("/storage/emulated/0/Music/private.mp3") }
              assertEquals(50, SoulseekWire.read(peer.getInputStream()).code)
              for (direction in listOf(0L, 1L)) {
                SoulseekWire.write(peer.getOutputStream(), 40) { uint(direction); uint(99); string("private.mp3"); if (direction == 1L) ulong(1000) }
                val response = SoulseekWire.read(peer.getInputStream())
                assertEquals(41, response.code)
                val fields = SoulseekWire.reader(response.payload)
                assertEquals(99L, fields.uint())
                assertEquals(0, fields.byte())
              }
            }
            verified.complete(Unit)
            ended.get(2, TimeUnit.SECONDS)
          }
        } catch (e: Throwable) { verified.completeExceptionally(e) }
      }
      val client = SoulseekClient(MemoryCredentials(), "127.0.0.1", server.localPort)
      try {
        client.connect("wave-fixture", "fixture-secret")
        verified.get(2, TimeUnit.SECONDS)
      } finally { ended.complete(Unit); client.close() }
    }
  }

  @Test fun `a disconnected peer fails without leaving a partial file`() {
    ServerSocket(0).use { server ->
      val verified = CompletableFuture<Unit>()
      val ended = CompletableFuture<Unit>()
      thread {
        try {
          server.accept().use { socket ->
            login(socket)
            assertEquals(3, SoulseekWire.read(socket.getInputStream()).code)
            SoulseekWire.write(socket.getOutputStream(), 3) { string("offline-peer"); uint(0); uint(0) }
            verified.complete(Unit)
            ended.get(2, TimeUnit.SECONDS)
          }
        } catch (e: Throwable) { verified.completeExceptionally(e) }
      }
      val client = SoulseekClient(MemoryCredentials(), "127.0.0.1", server.localPort)
      val part = Files.createTempFile("wave-offline-peer", ".mp3").toFile()
      try {
        client.connect("wave-fixture", "fixture-secret")
        val candidate = SoulseekCandidate("offline-peer", "Fixture.mp3", 1000, 320, 1500, false, 0, 0)
        val failure = assertThrows(SoulseekException::class.java) { client.download("unavailable", candidate, part, 1500, isCancelled = giveUpAfterSeconds(5)) }
        verified.get(2, TimeUnit.SECONDS)
        assertEquals(SoulseekFailure.PEER, failure.failure)
        assertFalse(part.exists())
      } finally { ended.complete(Unit); client.close(); part.delete() }
    }
  }

  @Test fun `one requested file waits in a peer queue then downloads through an indirect F connection`() {
    ServerSocket(0).use { server ->
      ServerSocket(0).use { peer ->
        val verified = CompletableFuture<Unit>()
        val fixture = File(javaClass.getResource("/fixtures/soulseek-320.mp3")!!.toURI()).readBytes()
        val queued = mutableListOf<Long>()
        thread {
          try {
            server.accept().use { socket ->
              login(socket)
              // Download asks the server where the peer is when a search connection has gone away.
              val lookup = SoulseekWire.read(socket.getInputStream())
              assertEquals(3, lookup.code)
              SoulseekWire.write(socket.getOutputStream(), 3) { string("fixture-peer"); uint(LOCALHOST); uint(peer.localPort.toLong()) }
              peer.accept().use { connection ->
                assertEquals(1, SoulseekWire.read(connection.getInputStream(), true).code)
                val queue = SoulseekWire.read(connection.getInputStream())
                assertEquals(43, queue.code)
                val filename = SoulseekWire.reader(queue.payload).string()
                assertEquals(51, SoulseekWire.read(connection.getInputStream()).code)
                SoulseekWire.write(connection.getOutputStream(), 44) { string(filename); uint(3) }
                Thread.sleep(50)
                SoulseekWire.write(connection.getOutputStream(), 40) { uint(1); uint(1234); string(filename); ulong(fixture.size.toLong()) }
                val allowed = SoulseekWire.reader(SoulseekWire.read(connection.getInputStream()).payload)
                assertEquals(1234L, allowed.uint())
                assertEquals(1, allowed.byte())
                SoulseekWire.write(socket.getOutputStream(), 18) { string("fixture-peer"); string("F"); uint(LOCALHOST); uint(peer.localPort.toLong()); uint(56); byte(0) }
                peer.accept().use { transfer ->
                  assertEquals(0, SoulseekWire.read(transfer.getInputStream(), true).code)
                  transfer.getOutputStream().write(SoulseekWire.Writer().apply { uint(1234) }.result())
                  transfer.getOutputStream().flush()
                  assertEquals(0L, SoulseekWire.Reader(transfer.getInputStream()).ulong())
                  transfer.getOutputStream().write(fixture)
                  transfer.getOutputStream().flush()
                  verified.complete(Unit)
                  Thread.sleep(100)
                }
              }
            }
          } catch (e: Throwable) { verified.completeExceptionally(e) }
        }
        val client = SoulseekClient(MemoryCredentials(), "127.0.0.1", server.localPort)
        val part = Files.createTempFile("wave-soulseek", ".mp3").toFile()
        try {
          client.connect("wave-fixture", "fixture-secret")
          val candidate = SoulseekCandidate("fixture-peer", "Music\\Fixture Artist\\Fixture Title.mp3", fixture.size.toLong(), 320, 1500, false, 100000, 3)
          val result = client.download("recording", candidate, part, 1500, onQueued = { queued.add(it) }, isCancelled = giveUpAfterSeconds(5))
          verified.get(2, TimeUnit.SECONDS)
          assertEquals(listOf(3L), queued)
          assertEquals(fixture.size.toLong(), result.bytes)
          assertEquals(fixture.toList(), part.readBytes().toList())
        } finally { client.close(); part.delete() }
      }
    }
  }

  /**
   * Peers are served on plain threads, where anything uncaught closes Wave. #119's crash was an
   * Error (NoClassDefFoundError), not an Exception, so receiving has to contain both.
   */
  @Test fun `an error while receiving fails the download and never escapes the peer thread`() {
    ServerSocket(0).use { server ->
      ServerSocket(0).use { peer ->
        val fixture = File(javaClass.getResource("/fixtures/soulseek-320.mp3")!!.toURI()).readBytes()
        val ended = CompletableFuture<Unit>()
        thread(isDaemon = true) {
          try {
            server.accept().use { socket ->
              login(socket)
              SoulseekWire.read(socket.getInputStream())
              SoulseekWire.write(socket.getOutputStream(), 3) { string("fixture-peer"); uint(LOCALHOST); uint(peer.localPort.toLong()) }
              peer.accept().use { connection ->
                SoulseekWire.read(connection.getInputStream(), true)
                val filename = SoulseekWire.reader(SoulseekWire.read(connection.getInputStream()).payload).string()
                SoulseekWire.read(connection.getInputStream())
                SoulseekWire.write(connection.getOutputStream(), 40) { uint(1); uint(1234); string(filename); ulong(fixture.size.toLong()) }
                SoulseekWire.read(connection.getInputStream())
                SoulseekWire.write(socket.getOutputStream(), 18) { string("fixture-peer"); string("F"); uint(LOCALHOST); uint(peer.localPort.toLong()); uint(56); byte(0) }
                peer.accept().use { transfer ->
                  SoulseekWire.read(transfer.getInputStream(), true)
                  transfer.getOutputStream().write(SoulseekWire.Writer().apply { uint(1234) }.result())
                  transfer.getOutputStream().flush()
                  SoulseekWire.Reader(transfer.getInputStream()).ulong()
                  transfer.getOutputStream().write(fixture)
                  transfer.getOutputStream().flush()
                  ended.get(5, TimeUnit.SECONDS)
                }
              }
            }
          } catch (_: Exception) {
            // The client closing its sockets ends the fixture.
          }
        }
        val uncaught = CopyOnWriteArrayList<Throwable>()
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { _, error -> uncaught.add(error) }
        val client = SoulseekClient(MemoryCredentials(), "127.0.0.1", server.localPort)
        val part = Files.createTempFile("wave-soulseek-error", ".mp3").toFile()
        try {
          client.connect("wave-fixture", "fixture-secret")
          val candidate = SoulseekCandidate("fixture-peer", "Music\\Fixture Title.mp3", fixture.size.toLong(), 320, 1500, false, 100000, 0)
          val started = System.nanoTime()
          val failure = assertThrows(SoulseekException::class.java) {
            client.download("recording", candidate, part, 1500, onProgress = { _, _ -> throw OutOfMemoryError("fixture") }, isCancelled = { System.nanoTime() - started > 4_000_000_000L })
          }
          assertEquals(SoulseekFailure.PEER, failure.failure)
          assertFalse(part.exists())
          Thread.sleep(200)
          assertEquals(emptyList<Throwable>(), uncaught.toList())
        } finally {
          Thread.setDefaultUncaughtExceptionHandler(previous)
          ended.complete(Unit); client.close(); part.delete()
        }
      }
    }
  }

  @Test fun `search results reach a phone through an indirect peer connection and keep queue information`() {
    ServerSocket(0).use { server ->
      ServerSocket(0).use { peer ->
        val verified = CompletableFuture<Unit>()
        thread {
          try {
            server.accept().use { socket ->
              login(socket)
              var search = SoulseekWire.read(socket.getInputStream())
              while (search.code != 26) search = SoulseekWire.read(socket.getInputStream())
              val fields = SoulseekWire.reader(search.payload)
              val token = fields.uint()
              assertEquals("Fixture Artist Fixture Title", fields.string())
              SoulseekWire.write(socket.getOutputStream(), 18) {
                string("fixture-peer"); string("P"); uint(LOCALHOST); uint(peer.localPort.toLong()); uint(55); byte(0)
              }
              peer.accept().use { connection ->
                assertEquals(0, SoulseekWire.read(connection.getInputStream(), true).code)
                val result = SoulseekWire.Writer().apply {
                  string("fixture-peer"); uint(token); uint(1); byte(1)
                  string("Music\\Fixture Artist\\Fixture Title.mp3"); ulong(61_648); string("")
                  uint(2); uint(0); uint(320); uint(1); uint(2)
                  byte(0); uint(100_000); uint(3)
                }.result()
                SoulseekWire.write(connection.getOutputStream(), 9) { bytes(SoulseekWire.deflate(result)) }
                verified.complete(Unit)
                Thread.sleep(500)
              }
            }
          } catch (e: Throwable) { verified.completeExceptionally(e) }
        }
        val client = SoulseekClient(MemoryCredentials(), "127.0.0.1", server.localPort)
        try {
          client.connect("wave-fixture", "fixture-secret")
          val candidates = client.search("Fixture Artist Fixture Title", 300)
          verified.get(2, TimeUnit.SECONDS)
          assertEquals(1, candidates.size)
          assertEquals("fixture-peer", candidates.single().username)
          assertEquals(320, candidates.single().bitrateKbps)
          assertEquals(3L, candidates.single().queueLength)
        } finally { client.close() }
      }
    }
  }

  private fun login(socket: Socket) {
    assertEquals(1, SoulseekWire.read(socket.getInputStream()).code)
    SoulseekWire.write(socket.getOutputStream(), 1) { byte(1); string("Welcome"); uint(0); string(""); byte(0) }
    assertEquals(2, SoulseekWire.read(socket.getInputStream()).code)
    assertEquals(35, SoulseekWire.read(socket.getInputStream()).code)
  }
  @Test fun `a free account authenticates and reconnects with its saved credentials without sharing files`() {
    ServerSocket(0).use { server ->
      val remote = thread {
        server.accept().use { socket ->
          // Wire fixture from Nicotine+ protocol: username, password, major, MD5, minor.
          val login = SoulseekWire.read(socket.getInputStream())
          assertEquals(1, login.code)
          val fields = SoulseekWire.reader(login.payload)
          assertEquals("wave-fixture", fields.string())
          assertEquals("fixture-secret", fields.string())
          assertEquals(177L, fields.uint())
          SoulseekWire.write(socket.getOutputStream(), 1) { byte(1); string("Welcome"); uint(0); string(""); byte(0) }
          assertEquals(2, SoulseekWire.read(socket.getInputStream()).code)
          val shares = SoulseekWire.reader(SoulseekWire.read(socket.getInputStream()).payload)
          assertEquals(0L, shares.uint())
          assertEquals(0L, shares.uint())
          Thread.sleep(500)
        }
      }
      val store = MemoryCredentials()
      val client = SoulseekClient(store, "127.0.0.1", server.localPort)
      try {
        assertEquals("signedOut", client.session()["status"])
        assertEquals("connected", client.connect("wave-fixture", "fixture-secret")["status"])
        assertEquals("wave-fixture", store.load()!!.username)
        remote.join(2000)
      } finally { client.close() }
    }
  }

  @Test fun `a server that doesn't answer while the phone is online is unreachable, not offline`() {
    // A port nothing listens on: the connection is refused at once.
    val port = ServerSocket(0).use { it.localPort }
    for ((online, failure) in listOf(true to SoulseekFailure.UNREACHABLE, false to SoulseekFailure.OFFLINE)) {
      val client = SoulseekClient(MemoryCredentials(), "127.0.0.1", port, online = { online })
      try {
        val error = assertThrows(SoulseekException::class.java) { client.connect("wave-fixture", "fixture-secret") }
        assertEquals(failure, error.failure)
      } finally { client.close() }
    }
  }

  /** A Wi-Fi to mobile data handover drops the connection while the phone is online: it's reconnected, not unreachable. */
  @Test fun `a server connection that drops during a search is a lost connection, not an unreachable server`() {
    ServerSocket(0).use { server ->
      thread(isDaemon = true) {
        try {
          server.accept().use { socket ->
            login(socket)
            assertEquals(26, SoulseekWire.read(socket.getInputStream()).code)
          }
        } catch (_: Exception) {}
      }
      val client = SoulseekClient(MemoryCredentials(), "127.0.0.1", server.localPort, online = { true })
      try {
        client.connect("wave-fixture", "fixture-secret")
        val error = assertThrows(SoulseekException::class.java) { client.search("Fixture Title", 5_000) }
        assertEquals(SoulseekFailure.OFFLINE, error.failure)
      } finally { client.close() }
    }
  }

  @Test fun `reconnecting or signing out while a download waits never counts as an unreachable server`() {
    for (end in listOf<(SoulseekClient) -> Unit>({ it.connect("wave-fixture", "fixture-secret") }, { it.disconnect() })) {
      ServerSocket(0).use { server ->
        ServerSocket(0).use { peer ->
          val ended = CompletableFuture<Unit>()
          thread(isDaemon = true) {
            try {
              server.accept().use { socket ->
                login(socket)
                SoulseekWire.read(socket.getInputStream())
                SoulseekWire.write(socket.getOutputStream(), 3) { string("fixture-peer"); uint(LOCALHOST); uint(peer.localPort.toLong()) }
                peer.accept().use { connection ->
                  SoulseekWire.read(connection.getInputStream(), true)
                  val filename = SoulseekWire.reader(SoulseekWire.read(connection.getInputStream()).payload).string()
                  SoulseekWire.read(connection.getInputStream())
                  SoulseekWire.write(connection.getOutputStream(), 44) { string(filename); uint(8) }
                  // The reconnection logs in again.
                  server.accept().use { again -> login(again); ended.get(5, TimeUnit.SECONDS) }
                }
              }
            } catch (_: Exception) {}
          }
          val client = SoulseekClient(MemoryCredentials(), "127.0.0.1", server.localPort, online = { true })
          val part = Files.createTempFile("wave-reconnected", ".mp3").toFile()
          try {
            client.connect("wave-fixture", "fixture-secret")
            val candidate = SoulseekCandidate("fixture-peer", "Fixture.mp3", 1000, 320, 1500, false, 0, 8)
            val failure = assertThrows(SoulseekException::class.java) {
              client.download("waiting", candidate, part, 1500, onQueued = { thread { end(client) } }, isCancelled = giveUpAfterSeconds(5))
            }
            assertEquals(SoulseekFailure.OFFLINE, failure.failure)
            assertFalse(part.exists())
          } finally { ended.complete(Unit); client.close(); part.delete() }
        }
      }
    }
  }

  private class MemoryCredentials : SoulseekCredentialsStore {
    private var credentials: SoulseekCredentials? = null
    override fun load() = credentials
    override fun save(value: SoulseekCredentials?) { credentials = value }
  }

  /** Keeps a broken fixture from hanging the test run. */
  private fun giveUpAfterSeconds(seconds: Long): () -> Boolean {
    val end = System.nanoTime() + seconds * 1_000_000_000L
    return { System.nanoTime() > end }
  }
}

/** 127.0.0.1 as the Soulseek server sends an IP: reversed, so the first octet is the high byte. */
private const val LOCALHOST = 0x7f000001L
