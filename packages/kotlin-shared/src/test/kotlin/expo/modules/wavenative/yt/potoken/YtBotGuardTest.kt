package expo.modules.wavenative.yt.potoken

import java.util.Base64
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

class YtBotGuardTest {
  /** A challenge as BotGuard's Create endpoint describes it (the fields Wave reads). */
  private val challenge =
    """["msg-1",[null,"(function(){vm()})()"],null,"hash-9","program-bytes","globalVm",null,"blob-3"]"""

  private fun check(raw: String) {
    val parsed = Json.parseToJsonElement(YtBotGuard.challengeJson(raw)).jsonObject
    assertEquals("msg-1", parsed["messageId"]?.jsonPrimitive?.content)
    assertEquals("hash-9", parsed["interpreterHash"]?.jsonPrimitive?.content)
    assertEquals("program-bytes", parsed["program"]?.jsonPrimitive?.content)
    assertEquals("globalVm", parsed["globalName"]?.jsonPrimitive?.content)
    assertEquals("blob-3", parsed["clientExperimentsStateBlob"]?.jsonPrimitive?.content)
    val interpreter = parsed["interpreterJavascript"]!!.jsonObject
    assertEquals(
      "(function(){vm()})()",
      interpreter["privateDoNotAccessOrElseSafeScriptWrappedValue"]?.jsonPrimitive?.content,
    )
    assertEquals(JsonNull, interpreter["privateDoNotAccessOrElseTrustedResourceUrlWrappedValue"])
  }

  @Test
  fun readsAPlainChallenge() = check("[$challenge]")

  @Test
  fun readsAScrambledChallenge() {
    // Scrambled: every byte lowered by 97, then base64 (URL-safe, as YouTube sends it).
    val scrambled = challenge.toByteArray().map { (it - 97).toByte() }.toByteArray()
    val encoded = Base64.getUrlEncoder().withoutPadding().encodeToString(scrambled)
    check("""[null,"$encoded"]""")
  }

  @Test
  fun aTokenTheMinterReturnsIsBase64UrlEncoded() {
    // `Uint8Array.toString()` in the page: the bytes as numbers, comma-separated.
    assertEquals("YWJj_-8=", YtBotGuard.tokenFromBytes("97,98,99,255,239"))
  }

  @Test
  fun theIntegrityTokenGoesToThePageAsBytesAndLastsAsLongAsBotGuardSays() {
    val (token, lifetimeSeconds) = YtBotGuard.integrityToken("""["AAEC_w",43200,"x"]""")
    assertEquals("new Uint8Array([0,1,2,255])", token)
    assertEquals(43200L, lifetimeSeconds)
  }

  @Test
  fun anIdentifierIsPassedToThePageAsBytes() {
    assertEquals("new Uint8Array([118,49,95])", YtBotGuard.bytesOf("v1_"))
  }
}
