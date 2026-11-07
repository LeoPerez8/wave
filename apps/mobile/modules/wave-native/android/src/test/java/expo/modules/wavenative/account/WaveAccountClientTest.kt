package expo.modules.wavenative.account

import java.io.File
import java.nio.file.Files
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class WaveAccountClientTest {
  private val folder: File = Files.createTempDirectory("wave-account").toFile()
  private val file = folder.resolve("wave-account-session")
  private var online = true
  private val ana = GoogleIdentity("fixture-id-token", "ana@example.com", "Ana Lima", "https://lh3.googleusercontent.com/a/ana")
  private val anaAccount = WaveAccountInfo("ana@example.com", "Ana Lima", "https://lh3.googleusercontent.com/a/ana")

  private fun client() = WaveAccountClient(WaveAccountStore(file, TestCipher.sameKey), online = { online }, timeoutMs = 2_000)

  private fun signedIn(service: FakeWaveService): WaveAccountClient {
    WaveAccountStore(file, TestCipher.sameKey).save(WaveSessionState.SignedIn(service.url, "fixture-session-token", anaAccount))
    return client()
  }

  private fun failure(block: () -> Unit): WaveAccountFailure =
    assertThrows(WaveAccountException::class.java) { block() }.failure

  @After fun cleanUp() { folder.deleteRecursively() }

  @Test fun `signing in sends the ID token once and keeps the session it answers`() {
    FakeWaveService { Reply(200, """{"sessionToken":"fixture-session-token","email":"ana@example.com"}""") }.use { service ->
      val session = client().signIn(service.url, ana)
      assertEquals(WaveSessionState.SignedIn(service.url, "fixture-session-token", anaAccount), session)
      assertEquals(1, service.received.size)
      val request = service.received.single()
      assertEquals("POST" to "/v1/session", request.method to request.path)
      assertEquals("""{"idToken":"fixture-id-token"}""", request.body)
      assertEquals(session, client().session())
    }
  }

  @Test fun `what JS sees of a session never has the token`() {
    val state = WaveSessionState.SignedIn("https://sync.example", "fixture-session-token", anaAccount)
    assertEquals(mapOf("status" to "signedIn", "account" to anaAccount.toMap()), state.toMap())
    assertFalse(state.toString().contains("fixture-session-token"))
  }

  @Test fun `the email the service answers is the account's`() {
    FakeWaveService { Reply(200, """{"sessionToken":"fixture-session-token","email":"ana@service.example"}""") }.use { service ->
      val session = client().signIn(service.url, ana.copy(email = null))
      assertEquals("ana@service.example", (session as WaveSessionState.SignedIn).account.email)
    }
  }

  @Test fun `an ID token the service turns down leaves the phone as it was`() {
    FakeWaveService { Reply(401, """{"error":"invalid_id_token"}""") }.use { service ->
      WaveAccountStore(file, TestCipher.sameKey).save(WaveSessionState.Ended(anaAccount))
      assertEquals(WaveAccountFailure.REJECTED, failure { client().signIn(service.url, ana) })
      assertEquals(WaveSessionState.Ended(anaAccount), client().session())
    }
  }

  @Test fun `an account the allowlist leaves out is told so`() {
    FakeWaveService { Reply(403, """{"error":"not_allowed"}""") }.use { service ->
      assertEquals(WaveAccountFailure.NOT_ALLOWED, failure { client().signIn(service.url, ana) })
      assertEquals(WaveSessionState.SignedOut, client().session())
    }
  }

  @Test fun `the service's account limits each say which, and leave the phone as it was`() {
    val limits = listOf(
      Reply(403, """{"error":"limit","limit":"maxAccounts"}""") to WaveAccountFailure.ACCOUNTS_FULL,
      Reply(429, """{"error":"limit","limit":"maxNewAccountsPerDay"}""") to WaveAccountFailure.NEW_ACCOUNTS_PAUSED,
      Reply(429, """{"error":"limit","limit":"maxSignInsPerMinute"}""") to WaveAccountFailure.REJECTED,
    )
    for ((reply, expected) in limits) {
      FakeWaveService { reply }.use { service ->
        assertEquals(expected, failure { client().signIn(service.url, ana) })
        assertEquals(WaveSessionState.SignedOut, client().session())
      }
    }
  }

  @Test fun `signing in offline says so, and a service that doesn't answer online says that`() {
    val nowhere = FakeWaveService.closedUrl()
    online = false
    assertEquals(WaveAccountFailure.OFFLINE, failure { client().signIn(nowhere, ana) })
    online = true
    assertEquals(WaveAccountFailure.UNREACHABLE, failure { client().signIn(nowhere, ana) })
    assertEquals(WaveSessionState.SignedOut, client().session())
  }

  @Test fun `a server error at sign-in is the service failing`() {
    FakeWaveService { Reply(500, """{"error":"internal"}""") }.use { service ->
      assertEquals(WaveAccountFailure.UNREACHABLE, failure { client().signIn(service.url, ana) })
    }
  }

  @Test fun `signed out, a request sends nothing`() {
    FakeWaveService().use { service ->
      assertEquals(WaveAccountFailure.SIGNED_OUT, failure { client().request("GET", "/v1/pull", null) })
      WaveAccountStore(file, TestCipher.sameKey).save(WaveSessionState.Ended(anaAccount))
      assertEquals(WaveAccountFailure.SIGNED_OUT, failure { client().request("GET", "/v1/pull", null) })
      assertEquals(WaveAccountFailure.SIGNED_OUT, failure { client().deleteAccount(ana) })
      assertTrue(service.received.isEmpty())
    }
  }

  @Test fun `a request goes with the session token and comes back as the service answered`() {
    FakeWaveService { Reply(200, """{"accepted":{"songs":1}}""") }.use { service ->
      val response = signedIn(service).request("POST", "/v1/push", """{"songs":[]}""")
      assertEquals(WaveResponse(200, """{"accepted":{"songs":1}}"""), response)
      val request = service.received.single()
      assertEquals("POST" to "/v1/push", request.method to request.path)
      assertEquals("Bearer fixture-session-token", request.headers["authorization"])
      assertEquals("application/json", request.headers["content-type"])
      assertEquals("""{"songs":[]}""", request.body)
    }
  }

  @Test fun `a pull keeps its cursor`() {
    FakeWaveService { Reply(200, """{"cursor":"7","more":false}""") }.use { service ->
      signedIn(service).request("GET", "/v1/pull?since=6", null)
      assertEquals("/v1/pull?since=6", service.received.single().path)
    }
  }

  @Test fun `JS can't ask for the Soulseek account, a session or anything but push and pull`() {
    FakeWaveService().use { service ->
      val client = signedIn(service)
      for ((method, path) in listOf("GET" to "/v1/soulseek", "POST" to "/v1/session", "DELETE" to "/v1/account", "DELETE" to "/v1/sessions", "GET" to "https://elsewhere.example/v1/pull", "GET" to "/v1/pull/../soulseek", "PUT" to "/v1/push"))
        assertEquals("$method $path", WaveAccountFailure.FORBIDDEN_REQUEST, failure { client.request(method, path, null) })
      assertTrue(service.received.isEmpty())
    }
  }

  @Test fun `JS can ask the Genius routes the Lyrics view uses, and nothing else of them`() {
    FakeWaveService { Reply(200, """{"meta":{"status":200}}""") }.use { service ->
      val client = signedIn(service)
      val allowed = listOf(
        "/v1/genius/search?q=Bohemian%20Rhapsody%20Queen",
        "/v1/genius/search?q=%C3%81guas%20de%20Mar%C3%A7o%20Elis%20%26%20Tom",
        "/v1/genius/search?q=What%3F%2F%231%20%2B%20AC%2FDC!'()*",
        "/v1/genius/song?id=1063",
        "/v1/genius/referents?song=1063&page=1",
        "/v1/genius/referents?song=1063&page=20",
      )
      for (path in allowed) assertEquals(path, 200, client.request("GET", path, null).status)
      assertEquals(allowed, service.received.map { it.path })
      for ((method, path) in listOf(
        "POST" to "/v1/genius/search?q=a",
        "GET" to "/v1/genius/search?q=",
        "GET" to "/v1/genius/search?q=a&page=2",
        "GET" to "/v1/genius/search?q=a b",
        "GET" to "/v1/genius/search?q=a#x",
        "GET" to "/v1/genius/song?id=0",
        "GET" to "/v1/genius/song?id=1&text_format=html",
        "GET" to "/v1/genius/song?id=1/../../soulseek",
        "GET" to "/v1/genius/referents?song=1&page=21",
        "GET" to "/v1/genius/referents?song=1",
        "GET" to "/v1/genius/artists?id=1",
      ))
        assertEquals("$method $path", WaveAccountFailure.FORBIDDEN_REQUEST, failure { client.request(method, path, null) })
      assertEquals(allowed.size, service.received.size)
    }
  }

  @Test fun `native callers can reach the Soulseek route with the session`() {
    FakeWaveService { Reply(200, """{"username":"fixture"}""") }.use { service ->
      assertEquals(200, signedIn(service).send("GET", "/v1/soulseek", null).status)
      assertEquals("Bearer fixture-session-token", service.received.single().headers["authorization"])
    }
  }

  @Test fun `a session the service ended signs the app out, says so, and sends nothing more`() {
    FakeWaveService { Reply(401, """{"error":"unauthorized"}""") }.use { service ->
      val client = signedIn(service)
      val heard = mutableListOf<WaveSessionState>()
      client.subscribe { heard.add(it) }
      assertEquals(WaveAccountFailure.SESSION_ENDED, failure { client.request("GET", "/v1/pull", null) })
      assertEquals(listOf<WaveSessionState>(WaveSessionState.Ended(anaAccount)), heard)
      assertEquals(WaveSessionState.Ended(anaAccount), client().session())
      assertEquals(WaveAccountFailure.SIGNED_OUT, failure { client.request("GET", "/v1/pull", null) })
      assertEquals(1, service.received.size)
    }
  }

  @Test fun `other refusals come back to the caller and keep the session`() {
    FakeWaveService { Reply(413, """{"error":"limit","limit":"maxSongs"}""") }.use { service ->
      val client = signedIn(service)
      assertEquals(413, client.request("POST", "/v1/push", "{}").status)
      assertTrue(client.session() is WaveSessionState.SignedIn)
    }
  }

  @Test fun `a request offline says so and keeps the session`() {
    val client = WaveAccountStore(file, TestCipher.sameKey).run {
      save(WaveSessionState.SignedIn(FakeWaveService.closedUrl(), "fixture-session-token", anaAccount))
      client()
    }
    online = false
    assertEquals(WaveAccountFailure.OFFLINE, failure { client.request("GET", "/v1/pull", null) })
    assertTrue(client.session() is WaveSessionState.SignedIn)
  }

  @Test fun `signing out ends the session on the service and forgets it`() {
    FakeWaveService { Reply(204) }.use { service ->
      val client = signedIn(service)
      val heard = mutableListOf<WaveSessionState>()
      client.subscribe { heard.add(it) }
      assertEquals(WaveSessionState.SignedOut, client.signOut())
      val request = service.received.single()
      assertEquals("DELETE" to "/v1/session", request.method to request.path)
      assertEquals("Bearer fixture-session-token", request.headers["authorization"])
      assertEquals(WaveSessionState.SignedOut, client().session())
      assertEquals(listOf<WaveSessionState>(WaveSessionState.SignedOut), heard)
      assertFalse(file.exists())
    }
  }

  @Test fun `signing out offline still forgets the session on the phone`() {
    WaveAccountStore(file, TestCipher.sameKey).save(WaveSessionState.SignedIn(FakeWaveService.closedUrl(), "fixture-session-token", anaAccount))
    online = false
    assertEquals(WaveSessionState.SignedOut, client().signOut())
    assertFalse(file.exists())
  }

  @Test fun `signing out of an ended session sends nothing`() {
    FakeWaveService().use { service ->
      WaveAccountStore(file, TestCipher.sameKey).save(WaveSessionState.Ended(anaAccount))
      assertEquals(WaveSessionState.SignedOut, client().signOut())
      assertTrue(service.received.isEmpty())
    }
  }

  @Test fun `deleting the account asks the service and signs out`() {
    FakeWaveService { Reply(204) }.use { service ->
      assertEquals(WaveSessionState.SignedOut, signedIn(service).deleteAccount(ana))
      val request = service.received.single()
      assertEquals("DELETE" to "/v1/account", request.method to request.path)
      assertEquals("Bearer fixture-session-token", request.headers["authorization"])
      assertEquals("""{"idToken":"fixture-id-token"}""", request.body)
      assertEquals(WaveSessionState.SignedOut, client().session())
    }
  }

  @Test fun `a delete Google's sign-in didn't confirm keeps the account and the session`() {
    for (error in listOf("invalid_id_token", "id_token_required"))
      FakeWaveService { Reply(401, """{"error":"$error"}""") }.use { service ->
        val client = signedIn(service)
        val heard = mutableListOf<WaveSessionState>()
        client.subscribe { heard.add(it) }
        assertEquals(error, WaveAccountFailure.GOOGLE_NOT_CONFIRMED, failure { client.deleteAccount(ana) })
        assertTrue(error, client().session() is WaveSessionState.SignedIn)
        assertTrue(error, heard.isEmpty())
      }
  }

  @Test fun `signing out on all phones asks the service and signs this one out`() {
    FakeWaveService { Reply(204) }.use { service ->
      val client = signedIn(service)
      val heard = mutableListOf<WaveSessionState>()
      client.subscribe { heard.add(it) }
      assertEquals(WaveSessionState.SignedOut, client.signOutEverywhere())
      val request = service.received.single()
      assertEquals("DELETE" to "/v1/sessions", request.method to request.path)
      assertEquals("Bearer fixture-session-token", request.headers["authorization"])
      assertEquals(WaveSessionState.SignedOut, client().session())
      assertEquals(listOf<WaveSessionState>(WaveSessionState.SignedOut), heard)
    }
  }

  @Test fun `signing out on all phones offline or refused keeps the session`() {
    WaveAccountStore(file, TestCipher.sameKey).save(WaveSessionState.SignedIn(FakeWaveService.closedUrl(), "fixture-session-token", anaAccount))
    online = false
    assertEquals(WaveAccountFailure.OFFLINE, failure { client().signOutEverywhere() })
    assertTrue(client().session() is WaveSessionState.SignedIn)
    online = true
    FakeWaveService { Reply(500, """{"error":"internal"}""") }.use { service ->
      assertEquals(WaveAccountFailure.UNREACHABLE, failure { signedIn(service).signOutEverywhere() })
      assertTrue(client().session() is WaveSessionState.SignedIn)
    }
  }

  @Test fun `signing out on all phones with a session the service already ended shows it ended`() {
    FakeWaveService { Reply(401, """{"error":"unauthorized"}""") }.use { service ->
      assertEquals(WaveSessionState.Ended(anaAccount), signedIn(service).signOutEverywhere())
    }
  }

  @Test fun `deleting offline keeps the account and the session`() {
    WaveAccountStore(file, TestCipher.sameKey).save(WaveSessionState.SignedIn(FakeWaveService.closedUrl(), "fixture-session-token", anaAccount))
    online = false
    assertEquals(WaveAccountFailure.OFFLINE, failure { client().deleteAccount(ana) })
    assertTrue(client().session() is WaveSessionState.SignedIn)
  }

  @Test fun `deleting with a session the service already ended shows it ended`() {
    FakeWaveService { Reply(401, """{"error":"unauthorized"}""") }.use { service ->
      assertEquals(WaveSessionState.Ended(anaAccount), signedIn(service).deleteAccount(ana))
    }
  }

  @Test fun `a 401 for a session signed out meanwhile doesn't end the new one`() {
    FakeWaveService().use { service ->
      val client = signedIn(service)
      service.respond = {
        // While this request is out, the phone signs out and in again.
        WaveAccountStore(file, TestCipher.sameKey).save(WaveSessionState.SignedIn(service.url, "fixture-newer-token", anaAccount))
        Reply(401, """{"error":"unauthorized"}""")
      }
      assertEquals(WaveAccountFailure.SESSION_ENDED, failure { client.request("GET", "/v1/pull", null) })
      assertEquals(WaveSessionState.SignedIn(service.url, "fixture-newer-token", anaAccount), client().session())
    }
  }
}
