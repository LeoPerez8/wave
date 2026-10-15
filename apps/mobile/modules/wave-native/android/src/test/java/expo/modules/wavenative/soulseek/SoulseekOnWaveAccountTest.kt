package expo.modules.wavenative.soulseek

import expo.modules.wavenative.account.FakeWaveService
import expo.modules.wavenative.account.Received
import expo.modules.wavenative.account.Reply
import expo.modules.wavenative.account.TestCipher
import expo.modules.wavenative.account.WaveAccountClient
import expo.modules.wavenative.account.WaveAccountInfo
import expo.modules.wavenative.account.WaveAccountStore
import expo.modules.wavenative.account.WaveSessionState
import java.io.File
import java.net.ServerSocket
import java.net.Socket
import java.nio.file.Files
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The Soulseek account Download in best quality uses belongs to the Wave account while the phone
 * is signed in (docs/spec.md, "The Soulseek account"): the native module asks the sync service
 * for it and sends it up, with the Wave session it holds.
 */
class SoulseekOnWaveAccountTest {
  private val folder: File = Files.createTempDirectory("wave-soulseek").toFile()
  private val sessionFile = folder.resolve("wave-account-session")
  private val ana = WaveAccountInfo("ana@example.com", "Ana Lima", null)

  @After fun cleanUp() { folder.deleteRecursively() }

  /** The sync service's Soulseek routes, keeping one account's Soulseek account in memory. */
  private class SoulseekRoutes(@Volatile var kept: SoulseekCredentials? = null) {
    @Volatile var failing = false

    fun respond(request: Received): Reply = when {
      failing -> Reply(500, """{"error":"internal"}""")
      request.headers["authorization"] != "Bearer fixture-session-token" -> Reply(401, """{"error":"unauthorized"}""")
      request.method == "GET" && request.path == "/v1/soulseek" -> Reply(200, buildJsonObject {
        val account = kept
        if (account == null) put("account", null as String?)
        else put("account", buildJsonObject { put("username", account.username); put("password", account.password) })
      }.toString())
      request.method == "PUT" && request.path == "/v1/soulseek" -> {
        val body = Json.parseToJsonElement(request.body) as JsonObject
        kept = SoulseekCredentials(body.text("username"), body.text("password"))
        Reply(204)
      }
      else -> Reply(404, """{"error":"not_found"}""")
    }

    private fun JsonObject.text(key: String) = (this[key] as JsonPrimitive).content
  }

  private fun waveAccount(service: FakeWaveService?, signedIn: Boolean = true): WaveAccountClient {
    val store = WaveAccountStore(sessionFile, TestCipher.sameKey)
    store.save(if (signedIn && service != null) WaveSessionState.SignedIn(service.url, "fixture-session-token", ana) else WaveSessionState.SignedOut)
    return WaveAccountClient(store, online = { true }, timeoutMs = 2_000)
  }

  private fun soulseek(
    server: FakeServer,
    phone: MemoryCredentials,
    wave: WaveAccountClient,
    switch: MemorySwitch = MemorySwitch(),
  ) = SoulseekClient(phone, "127.0.0.1", server.port, switch = switch, waveAccount = SyncServiceSoulseek(wave))

  private fun FakeWaveService.soulseekRequests() = received.filter { it.path == "/v1/soulseek" }.map { it.method }

  private fun same(a: SoulseekCredentials?, b: SoulseekCredentials?) =
    a?.username == b?.username && a?.password == b?.password

  @Test fun `turning it on while signed in makes an account and sends it up at once`() {
    val routes = SoulseekRoutes()
    FakeWaveService(routes::respond).use { service ->
      FakeServer().use { server ->
        val phone = MemoryCredentials()
        val client = soulseek(server, phone, waveAccount(service))
        try {
          assertEquals("connected", client.turnOn()["status"])
          val made = phone.load()!!
          assertTrue(same(made, routes.kept))
          assertEquals(listOf("GET", "PUT"), service.soulseekRequests())
        } finally { client.close() }
      }
    }
  }

  @Test fun `a fresh phone signed in to the same Wave account downloads with its account, without making one`() {
    val routes = SoulseekRoutes(SoulseekCredentials("quietfern42", "fixture-soulseek-password"))
    FakeWaveService(routes::respond).use { service ->
      FakeServer().use { server ->
        val phone = MemoryCredentials()
        val client = soulseek(server, phone, waveAccount(service))
        try {
          val session = client.turnOn()
          assertEquals(mapOf("status" to "connected", "username" to "quietfern42"), session)
          assertEquals(listOf("quietfern42"), server.logins.map { it.username })
          assertEquals("fixture-soulseek-password", server.logins.single().password)
          assertTrue(same(phone.load(), routes.kept))
          // Nothing new goes up.
          assertEquals(listOf("GET"), service.soulseekRequests())
        } finally { client.close() }
      }
    }
  }

  @Test fun `at a pull, a phone with its own account switches to the Wave account's and forgets its own`() {
    val theirs = SoulseekCredentials("quietfern42", "fixture-soulseek-password")
    val routes = SoulseekRoutes(theirs)
    FakeWaveService(routes::respond).use { service ->
      FakeServer().use { server ->
        val phone = MemoryCredentials(SoulseekCredentials("amberkite7", "phone-made-password"))
        val client = soulseek(server, phone, waveAccount(service), MemorySwitch(true))
        try {
          // Connected with its own account, made while signed out.
          client.search("Fixture Title", 100)
          assertEquals(listOf("amberkite7"), server.logins.map { it.username })

          assertEquals("quietfern42", client.followWaveAccount()["username"])
          assertTrue(same(theirs, phone.load()))
          // The next download connects with the Wave account's.
          client.search("Fixture Title", 100)
          assertEquals(listOf("amberkite7", "quietfern42"), server.logins.map { it.username })
          assertEquals("fixture-soulseek-password", server.logins.last().password)
          assertEquals(listOf("GET"), service.soulseekRequests())
        } finally { client.close() }
      }
    }
  }

  @Test fun `at a pull, the Wave account's comes to a phone with the switch off, for when it's turned on`() {
    val theirs = SoulseekCredentials("quietfern42", "fixture-soulseek-password")
    FakeWaveService(SoulseekRoutes(theirs)::respond).use { service ->
      FakeServer().use { server ->
        val phone = MemoryCredentials()
        val client = soulseek(server, phone, waveAccount(service), MemorySwitch(false))
        try {
          assertEquals(mapOf("status" to "off", "username" to "quietfern42"), client.followWaveAccount())
          assertTrue(same(theirs, phone.load()))
          // Off, nothing connects.
          assertEquals(0, server.logins.size)
        } finally { client.close() }
      }
    }
  }

  @Test fun `at a pull, a Wave account without one gets the phone's`() {
    val routes = SoulseekRoutes()
    FakeWaveService(routes::respond).use { service ->
      FakeServer().use { server ->
        val own = SoulseekCredentials("amberkite7", "phone-made-password")
        val phone = MemoryCredentials(own)
        val client = soulseek(server, phone, waveAccount(service), MemorySwitch(false))
        try {
          assertEquals("amberkite7", client.followWaveAccount()["username"])
          assertTrue(same(own, routes.kept))
          assertTrue(same(own, phone.load()))
          // Once it has it, a pull changes nothing.
          client.followWaveAccount()
          assertEquals(listOf("GET", "PUT", "GET"), service.soulseekRequests())
        } finally { client.close() }
      }
    }
  }

  @Test fun `a phone without an account and a Wave account without one leave each other alone`() {
    val routes = SoulseekRoutes()
    FakeWaveService(routes::respond).use { service ->
      FakeServer().use { server ->
        val phone = MemoryCredentials()
        val client = soulseek(server, phone, waveAccount(service))
        try {
          assertEquals(mapOf("status" to "off", "username" to null), client.followWaveAccount())
          assertNull(routes.kept)
          assertEquals(listOf("GET"), service.soulseekRequests())
        } finally { client.close() }
      }
    }
  }

  @Test fun `signed out, the phone keeps its own and nothing goes to Wave's server`() {
    val routes = SoulseekRoutes(SoulseekCredentials("quietfern42", "fixture-soulseek-password"))
    FakeWaveService(routes::respond).use { service ->
      FakeServer().use { server ->
        val phone = MemoryCredentials()
        val client = soulseek(server, phone, waveAccount(service, signedIn = false))
        try {
          assertEquals("connected", client.turnOn()["status"])
          val made = phone.load()!!.username
          assertNotEquals("quietfern42", made)
          assertEquals(made, client.followWaveAccount()["username"])
          assertEquals(emptyList<Received>(), service.received)
        } finally { client.close() }
      }
    }
  }

  @Test fun `when Wave's server can't be asked, turning it on uses the phone's way and sends nothing up`() {
    val routes = SoulseekRoutes().apply { failing = true }
    FakeWaveService(routes::respond).use { service ->
      FakeServer().use { server ->
        val phone = MemoryCredentials()
        val client = soulseek(server, phone, waveAccount(service))
        try {
          assertEquals("connected", client.turnOn()["status"])
          assertEquals(1, server.logins.size)
          // The next pull settles it: the Wave account has none, so the phone's goes up then.
          assertEquals(listOf("GET"), service.soulseekRequests())
        } finally { client.close() }
      }
    }
  }

  @Test fun `a Wave account's account Soulseek rejects is replaced by the new one the switch makes`() {
    val routes = SoulseekRoutes(SoulseekCredentials("quietfern42", "changed-elsewhere"))
    FakeWaveService(routes::respond).use { service ->
      FakeServer(taken = { it == "quietfern42" }).use { server ->
        val phone = MemoryCredentials()
        val client = soulseek(server, phone, waveAccount(service))
        try {
          assertEquals("connected", client.turnOn()["status"])
          val made = phone.load()!!
          assertNotEquals("quietfern42", made.username)
          assertTrue(same(made, routes.kept))
          assertEquals(listOf("GET", "PUT"), service.soulseekRequests())
        } finally { client.close() }
      }
    }
  }

  /** A Wave account that keeps [kept], with no sync service in between. */
  private class KeptOnWaveAccount(@Volatile var kept: SoulseekCredentials?) : WaveAccountSoulseek {
    override fun signedIn() = true
    override fun read() = kept
    override fun keep(account: SoulseekCredentials) { kept = account }
  }

  @Test fun `switching to the Wave account's account at a pull lets a running download finish, then connects with it`() {
    val fixture = File(javaClass.getResource("/fixtures/soulseek-320.mp3")!!.toURI()).readBytes()
    val theirs = SoulseekCredentials("quietfern42", "fixture-soulseek-password")
    val logins = CopyOnWriteArrayList<String>()
    val switched = CompletableFuture<Unit>()
    val ended = CompletableFuture<Unit>()
    ServerSocket(0).use { server ->
      ServerSocket(0).use { peer ->
        thread(isDaemon = true) {
          try {
            server.accept().use { socket ->
              logins.add(login(socket))
              assertEquals(3, SoulseekWire.read(socket.getInputStream()).code)
              SoulseekWire.write(socket.getOutputStream(), 3) { string("fixture-peer"); uint(LOCALHOST); uint(peer.localPort.toLong()) }
              peer.accept().use { connection ->
                SoulseekWire.read(connection.getInputStream(), true)
                val filename = SoulseekWire.reader(SoulseekWire.read(connection.getInputStream()).payload).string()
                SoulseekWire.read(connection.getInputStream())
                SoulseekWire.write(connection.getOutputStream(), 44) { string(filename); uint(3) }
                // The peer only sends the file once the phone has switched accounts.
                switched.get(5, TimeUnit.SECONDS)
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
                  // The next download logs in again, with the old connection still open.
                  server.accept().use { again -> logins.add(login(again)); ended.get(5, TimeUnit.SECONDS) }
                }
              }
            }
          } catch (_: Exception) {
            // The client closing its sockets ends the fixture.
          }
        }
        val phone = MemoryCredentials(SoulseekCredentials("amberkite7", "phone-made-password"))
        val client = SoulseekClient(phone, "127.0.0.1", server.localPort, switch = MemorySwitch(true), waveAccount = KeptOnWaveAccount(theirs))
        val part = Files.createTempFile("wave-switched", ".mp3").toFile()
        try {
          val candidate = SoulseekCandidate("fixture-peer", "Music\\Fixture Title.mp3", fixture.size.toLong(), 320, 1500, false, 100000, 3)
          val result = client.download("recording", candidate, part, 1500,
            onQueued = { thread { client.followWaveAccount(); switched.complete(Unit) } },
            isCancelled = { ended.isDone })
          assertEquals(fixture.toList(), part.readBytes().toList())
          assertEquals(fixture.size.toLong(), result.bytes)
          assertTrue(same(theirs, phone.load()))

          client.search("Fixture Title", 100)
          assertEquals(listOf("amberkite7", "quietfern42"), logins.toList())
        } finally { ended.complete(Unit); client.close(); part.delete() }
      }
    }
  }

  /** Answers a login like Soulseek's server; returns the username. */
  private fun login(socket: Socket): String {
    val login = SoulseekWire.read(socket.getInputStream())
    assertEquals(1, login.code)
    val username = SoulseekWire.reader(login.payload).string()
    SoulseekWire.write(socket.getOutputStream(), 1) { byte(1); string("Welcome"); uint(0); string(""); byte(0) }
    assertEquals(2, SoulseekWire.read(socket.getInputStream()).code)
    assertEquals(35, SoulseekWire.read(socket.getInputStream()).code)
    return username
  }

  @Test fun `credentials given instead go up while signed in`() {
    val routes = SoulseekRoutes(SoulseekCredentials("quietfern42", "fixture-soulseek-password"))
    FakeWaveService(routes::respond).use { service ->
      FakeServer().use { server ->
        val client = soulseek(server, MemoryCredentials(), waveAccount(service))
        try {
          client.connect("owner", "owner-secret")
          assertTrue(same(SoulseekCredentials("owner", "owner-secret"), routes.kept))
        } finally { client.close() }
      }
    }
  }
}

/** 127.0.0.1 as the Soulseek server sends an IP: reversed, so the first octet is the high byte. */
private const val LOCALHOST = 0x7f000001L
