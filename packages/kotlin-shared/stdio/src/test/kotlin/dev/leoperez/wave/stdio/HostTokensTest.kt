package dev.leoperez.wave.stdio

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The desktop's proof-of-origin tokens: minted by the host, in its browser window, when asked. */
class HostTokensTest {
  @Test
  fun asksTheHostForAVideosTokens() = withHost({ _, _ -> JsonPrimitive(true) }) { host ->
    val tokens = HostTokens(host.lines)
    val minted = async(Dispatchers.Default) { tokens.getPoToken("video1", "visitor1", null) }
    val request = host.next()
    assertEquals("poToken", request["method"]!!.jsonPrimitive.content)
    assertEquals(
      listOf("visitor1", "video1"),
      request["params"]!!.jsonObject["identifiers"]!!.jsonArray.map { it.jsonPrimitive.content },
    )
    host.write("""{"id":${request["id"]},"result":{"tokens":["player","streaming"]}}""")
    val result = minted.await()!!
    assertEquals("player", result.playerRequestToken)
    assertEquals("streaming", result.streamingDataToken)
    assertEquals("visitor1", result.visitorData)
  }

  @Test
  fun goesOnWithoutATokenWhenTheHostHasNone() = withHost({ _, _ -> JsonPrimitive(true) }) { host ->
    val tokens = HostTokens(host.lines)
    val minted = async(Dispatchers.Default) { tokens.getPoToken("video1", "visitor1", null) }
    val request = host.next()
    host.write("""{"id":${request["id"]},"error":{"code":"ERR_NO_TOKEN","message":"no window"}}""")
    assertNull(minted.await())
  }
}
