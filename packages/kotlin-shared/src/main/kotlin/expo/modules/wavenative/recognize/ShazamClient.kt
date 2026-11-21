package expo.modules.wavenative.recognize

import java.io.IOException
import java.text.Normalizer
import java.util.Locale
import java.util.UUID
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject

/** The song Shazam named, read into plain fields: nothing else of its answer reaches JS. */
data class RecognizedSong(
  val title: String,
  /** The artist credit as Shazam shows it ("Artist feat. Other"). */
  val artist: String,
  val album: String?,
  val coverUrl: String?,
  val isrc: String?,
  val releaseYear: Int?,
)

/** Why a recognition request didn't get an answer. None of them means "no match". */
enum class RecognizeFailure(val code: String) {
  /** The request didn't complete: no connection, a timeout, a dropped socket. */
  NETWORK("network"),
  /** Shazam answered with an HTTP error. */
  REFUSED("refused"),
  /** Shazam answered something that isn't a match or a no-match it describes. */
  UNREADABLE("unreadable"),
}

sealed interface RecognizeOutcome {
  data class Match(val song: RecognizedSong) : RecognizeOutcome
  data object NoMatch : RecognizeOutcome
  /** [status] is the HTTP status of a [RecognizeFailure.REFUSED] request (429 when Shazam rate-limits). */
  data class Failed(val failure: RecognizeFailure, val status: Int? = null) : RecognizeOutcome

  /** The outcome as JS receives it: `kind` is `match`, `noMatch` or `failed`. */
  fun toMap(): Map<String, Any?> = when (this) {
    is Match -> mapOf(
      "kind" to "match",
      "song" to mapOf(
        "title" to song.title,
        "artist" to song.artist,
        "album" to song.album,
        "coverUrl" to song.coverUrl,
        "isrc" to song.isrc,
        "releaseYear" to song.releaseYear,
      ),
    )
    NoMatch -> mapOf("kind" to "noMatch")
    is Failed -> mapOf("kind" to "failed", "failure" to failure.code, "status" to status)
  }
}

/** One POST to Shazam. */
data class ShazamRequest(val url: String, val headers: Map<String, String>, val body: String)

data class ShazamResponse(val status: Int, val body: String)

/** Sends a request and answers its status and body; throws [IOException] when there's no answer. Blocking. */
fun interface ShazamHttp {
  fun post(request: ShazamRequest): ShazamResponse
}

/**
 * Asks Shazam's discovery endpoint what a signature is, the way shazamio does: as the
 * iPhone app, under this install's random id with a new tag id per request, in the
 * phone's language and country, with its time zone and the signature's length.
 */
class ShazamClient(
  private val http: ShazamHttp,
  private val installId: String,
  private val locale: Locale,
  private val timeZone: String,
  private val clock: () -> Long = System::currentTimeMillis,
  private val newTagId: () -> String = { UUID.randomUUID().toString().uppercase(Locale.ROOT) },
) {
  /** Blocking: call it off the main thread. */
  fun recognize(signature: ShazamSignature): RecognizeOutcome {
    val language = locale.toLanguageTag().takeUnless { it == "und" } ?: "en-US"
    val country = locale.country.takeIf { it.isNotEmpty() } ?: "US"
    val url = "https://amp.shazam.com/discovery/v5/$language/$country/iphone/-/tag/$installId/${newTagId()}" +
      "?sync=true&webv3=true&sampling=true&connected=&shazamapiversion=v3&sharehub=true" +
      "&hubv5minorversion=v5.1&hidelb=true&video=v3"
    val body = buildJsonObject {
      put("timezone", timeZone)
      putJsonObject("signature") {
        put("uri", signature.uri)
        put("samplems", signature.sampleMs)
      }
      put("timestamp", clock())
      putJsonObject("context") {}
      putJsonObject("geolocation") {}
    }
    val headers = mapOf(
      "X-Shazam-Platform" to "IPHONE",
      "X-Shazam-AppVersion" to "14.1.0",
      "Accept" to "*/*",
      "Accept-Language" to language,
      "Content-Type" to "application/json",
      "User-Agent" to USER_AGENT,
    )
    val response = try {
      http.post(ShazamRequest(url, headers, body.toString()))
    } catch (_: IOException) {
      return RecognizeOutcome.Failed(RecognizeFailure.NETWORK)
    }
    if (response.status !in 200..299) return RecognizeOutcome.Failed(RecognizeFailure.REFUSED, response.status)
    return readAnswer(response.body)
  }

  private companion object {
    // An app agent from shazamio's list: Shazam answers a browser one with its website.
    const val USER_AGENT = "Dalvik/2.1.0 (Linux; U; Android 6.0.1; SM-G920F Build/MMB29K)"
    val YEAR = Regex("""(?<!\d)(1\d{3}|2\d{3})(?!\d)""")
    // The SONG section's "Album" heading, which Shazam translates, as Wave has seen it.
    val ALBUM_HEADINGS = setOf("album", "アルバム", "앨범", "专辑", "專輯", "альбом", "ألبوم", "אלבום", "άλμπουμ")

    fun readAnswer(text: String): RecognizeOutcome {
      val unreadable = RecognizeOutcome.Failed(RecognizeFailure.UNREADABLE)
      val answer = runCatching { Json.parseToJsonElement(text) }.getOrNull() as? JsonObject ?: return unreadable
      val matches = answer["matches"] as? JsonArray
      val track = answer["track"]
      if (track == null) return if (matches != null && matches.isEmpty()) RecognizeOutcome.NoMatch else unreadable
      return readSong(track as? JsonObject ?: return unreadable)?.let(RecognizeOutcome::Match) ?: unreadable
    }

    fun readSong(track: JsonObject): RecognizedSong? {
      val title = track.text("title") ?: return null
      val artist = track.text("subtitle") ?: return null
      val images = track["images"] as? JsonObject
      val metadata = (track["sections"] as? JsonArray).orEmpty()
        .filterIsInstance<JsonObject>()
        .firstOrNull { it.text("type") == "SONG" }
        ?.let { it["metadata"] as? JsonArray }.orEmpty()
        .filterIsInstance<JsonObject>()
        .filter { it.text("text") != null }
      // Shazam lists the album, the label and the release, in that order, under headings in
      //  the request's language. A heading Wave doesn't know still reads as the album when
      //  Shazam names an Apple Music album for the track.
      val album = metadata.firstOrNull { heading(it) in ALBUM_HEADINGS }
        ?: metadata.firstOrNull()?.takeIf { track.text("albumadamid") != null && metadata.size > 1 }
      val released = metadata.lastOrNull()?.takeIf { it !== album }
      return RecognizedSong(
        title = title,
        artist = artist,
        album = album?.text("text"),
        coverUrl = images?.text("coverarthq") ?: images?.text("coverart"),
        isrc = track.text("isrc"),
        releaseYear = released?.text("text")?.let { YEAR.find(it) }?.value?.toInt(),
      )
    }

    fun heading(entry: JsonObject): String {
      val title = entry.text("title") ?: return ""
      return Normalizer.normalize(title.lowercase(Locale.ROOT), Normalizer.Form.NFD)
        .replace(Regex("\\p{Mn}+"), "")
        .trim()
        .trimEnd(':')
    }

    fun JsonObject.text(key: String): String? =
      (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content?.trim()?.takeIf(String::isNotEmpty)

    fun JsonArray?.orEmpty(): List<JsonElement> = this ?: emptyList()
  }
}
