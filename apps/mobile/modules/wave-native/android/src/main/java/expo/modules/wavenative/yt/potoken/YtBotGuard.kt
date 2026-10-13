package expo.modules.wavenative.yt.potoken

import java.util.Base64
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long

/**
 * Reads what BotGuard's endpoints answer and writes what the token page
 * ([YtPoTokenWebView]) needs, as JavaScript literals. Ported from Metrolist's
 * `utils/potoken/JavaScriptUtil.kt` (GPL-3.0), itself from NewPipe.
 */
object YtBotGuard {
  /**
   * The challenge from the `Create` endpoint ([raw]) as the object the page's
   * `runBotGuard` takes. YouTube may send it scrambled: base64, every byte
   * lowered by 97.
   */
  fun challengeJson(raw: String): String {
    val outer = Json.parseToJsonElement(raw).jsonArray
    val scrambled = outer.getOrNull(1)
    val challenge =
      if (scrambled is JsonPrimitive && scrambled.isString) {
        val bytes = decodeBase64(scrambled.content).map { (it + 97).toByte() }.toByteArray()
        Json.parseToJsonElement(bytes.decodeToString()).jsonArray
      } else {
        outer[0].jsonArray
      }
    val result = JsonObject(
      mapOf(
        "messageId" to JsonPrimitive(challenge[0].jsonPrimitive.content),
        "interpreterJavascript" to JsonObject(
          mapOf(
            "privateDoNotAccessOrElseSafeScriptWrappedValue" to firstString(challenge[1]),
            "privateDoNotAccessOrElseTrustedResourceUrlWrappedValue" to firstString(challenge[2]),
          ),
        ),
        "interpreterHash" to JsonPrimitive(challenge[3].jsonPrimitive.content),
        "program" to JsonPrimitive(challenge[4].jsonPrimitive.content),
        "globalName" to JsonPrimitive(challenge[5].jsonPrimitive.content),
        "clientExperimentsStateBlob" to JsonPrimitive(challenge[7].jsonPrimitive.content),
      ),
    )
    return Json.encodeToString(JsonObject.serializer(), result)
  }

  /**
   * The integrity token from the `GenerateIT` endpoint ([raw]) as a JavaScript
   * `Uint8Array`, and how many seconds it lasts.
   */
  fun integrityToken(raw: String): Pair<String, Long> {
    val data = Json.parseToJsonElement(raw).jsonArray
    return uint8Array(decodeBase64(data[0].jsonPrimitive.content)) to data[1].jsonPrimitive.long
  }

  /** [identifier] (a visitor data or video id) as the JavaScript `Uint8Array` the minter takes. */
  fun bytesOf(identifier: String): String = uint8Array(identifier.toByteArray())

  /**
   * A token the minter returned, as `Uint8Array.toString()` writes it
   * ("97,98,99"), in the base64 YouTube expects (URL-safe, padded).
   */
  fun tokenFromBytes(bytes: String): String {
    val decoded = bytes.split(',').map { it.trim().toInt().toByte() }.toByteArray()
    return Base64.getUrlEncoder().encodeToString(decoded)
  }

  private fun firstString(element: JsonElement): JsonElement =
    (element as? JsonArray)?.firstOrNull { it is JsonPrimitive && it.isString } ?: JsonNull

  private fun uint8Array(bytes: ByteArray): String =
    bytes.joinToString(",", prefix = "new Uint8Array([", postfix = "])") { (it.toInt() and 0xff).toString() }

  /** YouTube's base64: either alphabet, `.` for padding, padding optional. */
  private fun decodeBase64(text: String): ByteArray {
    val standard = text.replace('-', '+').replace('_', '/').replace('.', '=').trimEnd('=')
    return Base64.getDecoder().decode(standard + "=".repeat((4 - standard.length % 4) % 4))
  }
}
