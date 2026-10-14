package expo.modules.wavenative.soulseek

import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.CopyOnWriteArrayList
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.concurrent.thread

/** Download in best quality: the switch that gives the phone a Soulseek account nobody has to type. */
class SoulseekBestQualityTest {
  @Test fun `turning it on with no account makes a random one and connects it`() {
    FakeServer().use { server ->
      val store = MemoryCredentials()
      val client = SoulseekClient(store, "127.0.0.1", server.port, switch = MemorySwitch())
      try {
        assertEquals("off", client.session()["status"])
        val session = client.turnOn()
        assertEquals("connected", session["status"])
        val made = store.load()!!
        assertEquals(listOf(made.username), server.logins.map { it.username })
        assertEquals(made.username, session["username"])
        assertReadsLikeAnyUser(made.username)
        assertTrue(made.password.length >= 20)
      } finally { client.close() }
    }
  }

  @Test fun `a username someone already has is drawn again with a new one`() {
    val tried = CopyOnWriteArrayList<String>()
    // Soulseek turns down a taken name as a wrong password: the first two drawn are taken.
    FakeServer(taken = { tried.add(it); tried.size <= 2 }).use { server ->
      val store = MemoryCredentials()
      val client = SoulseekClient(store, "127.0.0.1", server.port, switch = MemorySwitch())
      try {
        assertEquals("connected", client.turnOn()["status"])
        val names = server.logins.map { it.username }
        assertEquals(3, names.size)
        assertEquals(3, names.toSet().size)
        assertEquals(names.last(), store.load()!!.username)
      } finally { client.close() }
    }
  }

  @Test fun `when every name drawn is taken, it says it couldn't make an account and stays off`() {
    FakeServer(taken = { true }).use { server ->
      val store = MemoryCredentials()
      val switch = MemorySwitch()
      val client = SoulseekClient(store, "127.0.0.1", server.port, switch = switch)
      try {
        val error = assertThrows(SoulseekException::class.java) { client.turnOn() }
        assertEquals(SoulseekFailure.NO_ACCOUNT, error.failure)
        assertEquals("ERR_SLSK_NO_ACCOUNT", error.failure.code)
        assertEquals(5, server.logins.size)
        assertNull(store.load())
        assertNotEquals(true, switch.load())
        assertEquals("off", client.session()["status"])
      } finally { client.close() }
    }
  }

  @Test fun `turning it off keeps the account for the next time it's turned on`() {
    FakeServer().use { server ->
      val switch = MemorySwitch()
      val client = SoulseekClient(MemoryCredentials(), "127.0.0.1", server.port, switch = switch)
      try {
        val made = client.turnOn()["username"]
        val off = client.turnOff()
        assertEquals("off", off["status"])
        assertEquals(false, switch.load())
        // Off, downloads don't use Soulseek: it doesn't log in again for them.
        val error = assertThrows(SoulseekException::class.java) { client.search("Fixture Title", 100) }
        assertEquals(SoulseekFailure.SIGNED_OUT, error.failure)
        assertEquals(1, server.logins.size)
        val again = client.turnOn()
        assertEquals("connected", again["status"])
        assertEquals(made, again["username"])
        assertEquals(listOf(made, made), server.logins.map { it.username })
      } finally { client.close() }
    }
  }

  @Test fun `a phone connected to its own account before the switch keeps it, with the switch on`() {
    FakeServer().use { server ->
      val owners = MemoryCredentials(SoulseekCredentials("owner", "owner-secret"))
      val client = SoulseekClient(owners, "127.0.0.1", server.port, switch = MemorySwitch(null))
      try {
        assertEquals(mapOf("status" to "disconnected", "username" to "owner"), client.session())
        // A download reconnects the owner's account.
        assertEquals(emptyList<SoulseekCandidate>(), client.search("Fixture Title", 100))
        assertEquals(listOf("owner"), server.logins.map { it.username })
        assertEquals("owner-secret", server.logins.single().password)
      } finally { client.close() }
    }
  }

  @Test fun `offline, or with Soulseek's server down, the switch stays off`() {
    // A port nothing listens on: the connection is refused at once.
    val port = ServerSocket(0).use { it.localPort }
    for ((online, failure) in listOf(true to SoulseekFailure.UNREACHABLE, false to SoulseekFailure.OFFLINE)) {
      val switch = MemorySwitch()
      val client = SoulseekClient(MemoryCredentials(), "127.0.0.1", port, online = { online }, switch = switch)
      try {
        assertEquals(failure, assertThrows(SoulseekException::class.java) { client.turnOn() }.failure)
        assertEquals("off", client.session()["status"])
        assertNotEquals(true, switch.load())
      } finally { client.close() }
    }
  }

  @Test fun `turning it on with an account Soulseek rejects makes a new one`() {
    FakeServer(taken = { it == "owner" }).use { server ->
      val store = MemoryCredentials(SoulseekCredentials("owner", "changed-elsewhere"))
      val client = SoulseekClient(store, "127.0.0.1", server.port, switch = MemorySwitch(false))
      try {
        assertEquals("connected", client.turnOn()["status"])
        assertEquals("owner", server.logins.first().username)
        assertEquals(server.logins.last().username, store.load()!!.username)
        assertNotEquals("owner", store.load()!!.username)
      } finally { client.close() }
    }
  }

  @Test fun `an account Soulseek rejects while reconnecting for a download is forgotten and the switch goes off`() {
    FakeServer(taken = { it == "owner" }).use { server ->
      val store = MemoryCredentials(SoulseekCredentials("owner", "changed-elsewhere"))
      val switch = MemorySwitch(true)
      val client = SoulseekClient(store, "127.0.0.1", server.port, switch = switch)
      try {
        val error = assertThrows(SoulseekException::class.java) { client.search("Fixture Title", 100) }
        assertEquals(SoulseekFailure.AUTH, error.failure)
        assertNull(store.load())
        assertEquals(false, switch.load())
        assertEquals("off", client.session()["status"])
      } finally { client.close() }
    }
  }

  /** Letters and digits within Soulseek's limit, naming nothing a peer could block every Wave user by. */
  private fun assertReadsLikeAnyUser(username: String) {
    assertTrue(username, username.matches(Regex("[a-z]+[0-9]*")))
    assertTrue(username, username.length in 6..30)
    assertFalse(username, username.contains("wave"))
  }
}

/** Soulseek's server as far as logging in goes: [taken] names are turned down, any other is accepted. */
internal class FakeServer(private val taken: (String) -> Boolean = { false }) : AutoCloseable {
  class Login(val username: String, val password: String)

  private val socket = ServerSocket(0)
  private val open = CopyOnWriteArrayList<Socket>()
  val port = socket.localPort
  val logins = CopyOnWriteArrayList<Login>()

  init {
    thread(isDaemon = true) {
      try {
        while (true) {
          val connection = socket.accept()
          open.add(connection)
          val fields = SoulseekWire.reader(SoulseekWire.read(connection.getInputStream()).payload)
          val login = Login(fields.string(), fields.string())
          logins.add(login)
          if (taken(login.username)) {
            SoulseekWire.write(connection.getOutputStream(), 1) { byte(0); string("INVALIDPASS") }
            connection.close()
            continue
          }
          SoulseekWire.write(connection.getOutputStream(), 1) { byte(1); string("Welcome"); uint(0); string(""); byte(0) }
          // The listening port and the shared counts follow; the connection then stays open.
          SoulseekWire.read(connection.getInputStream())
          SoulseekWire.read(connection.getInputStream())
        }
      } catch (_: Exception) {
        // Closing the fixture ends the accept loop.
      }
    }
  }

  override fun close() {
    socket.close()
    open.forEach { runCatching { it.close() } }
  }
}

internal class MemoryCredentials(private var credentials: SoulseekCredentials? = null) : SoulseekCredentialsStore {
  override fun load() = credentials
  override fun save(value: SoulseekCredentials?) { credentials = value }
}

internal class MemorySwitch(private var on: Boolean? = null) : SoulseekSwitchStore {
  override fun load() = on
  override fun save(on: Boolean) { this.on = on }
}
